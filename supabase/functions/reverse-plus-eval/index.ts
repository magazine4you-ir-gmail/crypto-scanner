// supabase/functions/reverse-plus-eval/index.ts
//
// Reverse Signal Plus — independent evaluator (analysis + PAPER trading). NO order execution.
//
// What one run does (only for users who switched Reverse Signal Plus ON):
//   1. SIGNAL_TIME evaluation : once per (user, existing reverse signal), from candles closed at the signal candle.
//   2. PAPER trade            : created once from a valid plan, then advanced from closed candles AFTER the signal.
//   3. LIVE evaluation        : the same analysis on the latest closed candle for signals that are still relevant.
//
// Independence guarantees:
//   * It only READS signal_outcomes-derived data from `reverse_signal_outcomes` (select). It never writes there.
//   * It writes ONLY to reverse_plus_evaluations / reverse_plus_trades.
//   * It does not import or modify scheduled-scan / track-signal and has its OWN schedule (reverse_plus_cron_setup.sql).
//   * Idempotent: unique indexes + upserts, so running it twice never duplicates an evaluation or trade.
//   * Nothing is processed when the global switch REVERSE_PLUS_ENABLED=false or no user has the module enabled.
//
// Auth: header x-cron-secret: <CRON_SECRET>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { closedCandles, EXPIRY_BARS, quoteOf, timeframeMs, type Candle } from "../_shared/engine.ts";
import {
  D, UNKNOWN_CONTRACT, buildPlusAnalysis, jsonSafe, simulatePaper, toString,
  type ContractSpec, type Dec, type PlusAnalysis, type PlusSettings, type Side,
} from "../_shared/reversePlus/index.ts";

const BINANCE_BASE = "https://data-api.binance.vision";
const BINANCE_FUTURES = "https://fapi.binance.com";
const BUDGET_MS = 100_000;
const MAX_SIGNALS = 500;
const BEFORE_LIMIT = 300;

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function fetchJson(url: string, tries = 3): Promise<unknown> {
  let last: Error = new Error("request failed");
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
      if (res.status === 451 || res.status === 403) break; // geo-blocked: retrying will not help
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw last;
}

/** The scan stores minute timeframes like "15M"; Binance / the engine use lower-case minutes. */
const normTf = (tf: string) => (/^\d+M$/.test(tf) && Number(tf.slice(0, -1)) <= 30 ? tf.toLowerCase() : tf);

function parseKlines(rows: unknown[][]): Candle[] {
  return rows
    .map((r) => ({
      openTime: r[0] as number, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]),
      close: Number(r[4]), volume: Number(r[5]), closeTime: r[6] as number,
    }))
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low));
}

const dec = (v: unknown): Dec | null =>
  v === null || v === undefined || v === "" ? null : D(typeof v === "string" ? v : Number(v));
const decOrThrow = (v: unknown): Dec => {
  const d = dec(v);
  if (d === null) throw new Error("missing numeric value");
  return d;
};
const str = (v: Dec | null | undefined): string | null => (v === null || v === undefined ? null : toString(v));

function toSettings(r: Row): PlusSettings {
  return {
    accountBalance: decOrThrow(r.account_balance), riskPct: decOrThrow(r.risk_pct),
    maxRiskPerTrade: decOrThrow(r.max_risk_per_trade), leverage: decOrThrow(r.leverage),
    marginMode: r.margin_mode === "CROSS" ? "CROSS" : "ISOLATED", feePct: decOrThrow(r.fee_pct),
    slippagePct: decOrThrow(r.slippage_pct), maxEntries: Number(r.max_entries),
    maxMarginPct: decOrThrow(r.max_margin_pct), minRr: decOrThrow(r.min_rr),
    assumedMmrPct: decOrThrow(r.assumed_mmr_pct), liqSafetyFactor: decOrThrow(r.liq_safety_factor),
    approachPct: decOrThrow(r.approach_pct),
  };
}

// ---------------------------------------------------------------------------------------------
// futures contract filters (stepSize / minQty / minNotional / tickSize) — best effort
// ---------------------------------------------------------------------------------------------
interface FuturesInfo {
  perps: Set<string>;
  specs: Map<string, ContractSpec>;
}

async function loadFuturesInfo(): Promise<FuturesInfo | null> {
  try {
    const data = (await fetchJson(`${BINANCE_FUTURES}/fapi/v1/exchangeInfo`, 1)) as { symbols?: Row[] };
    const perps = new Set<string>();
    const specs = new Map<string, ContractSpec>();
    for (const s of data.symbols ?? []) {
      if (s.contractType !== "PERPETUAL" || s.status !== "TRADING" || s.quoteAsset !== "USDT") continue;
      const symbol = String(s.symbol);
      perps.add(symbol);
      const filters = (s.filters as Row[] | undefined) ?? [];
      const f = (t: string) => filters.find((x) => x.filterType === t);
      const lot = f("LOT_SIZE");
      const price = f("PRICE_FILTER");
      const notional = f("MIN_NOTIONAL");
      if (lot && price) {
        specs.set(symbol, {
          tickSize: dec(price.tickSize), stepSize: dec(lot.stepSize), minQty: dec(lot.minQty),
          minNotional: notional ? dec(notional.notional) : null,
          maxLeverage: null, // not in the public exchangeInfo (needs the signed leverageBracket endpoint)
          known: true,
        });
      }
    }
    return perps.size > 0 ? { perps, specs } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// row builders
// ---------------------------------------------------------------------------------------------
function planJson(a: PlusAnalysis): unknown {
  if (!a.plan) return null;
  const p = a.plan;
  return jsonSafe({
    ok: p.ok, issues: p.issues, riskBudget: p.riskBudget, estimated: p.estimated, leverage: p.leverage,
    maxSafeLeverage: p.maxSafeLeverage, liq: p.liq, totals: p.totals,
    steps: p.steps.map((s) => ({ order: s.order, entry: s.entry, qty: s.qty, notional: s.notional, margin: s.margin, netRisk: s.netRisk })),
  });
}

function evaluationRow(
  userId: string, rev: Row, kind: "SIGNAL_TIME" | "LIVE", asOfMs: number, price: Dec, a: PlusAnalysis,
  s: PlusSettings, contractKnown: boolean,
): Row {
  const e = a.entry;
  const t = a.plan?.totals ?? null;
  return {
    user_id: userId, reverse_outcome_id: rev.id, origin_outcome_id: rev.origin_outcome_id, symbol: rev.symbol,
    timeframe: rev.timeframe, side: rev.signal_type, eval_kind: kind, as_of_close_time: new Date(asOfMs).toISOString(),
    current_price: str(price), zone_low: str(e.zoneLow), zone_high: str(e.zoneHigh),
    reverse_entry: str(dec(rev.price_at_signal)), stop_loss: str(dec(rev.stop_loss)), take_profit: str(dec(rev.target1)),
    recommended_entry: str(e.recommendedEntry), entry_range_low: str(e.entryRangeLow), entry_range_high: str(e.entryRangeHigh),
    distance_to_entry_pct: str(e.distanceToEntryPct), risk_distance: str(e.riskDistance), reward_distance: str(e.rewardDistance),
    rr_gross: str(e.rrGross), rr_net: str(e.rrNet), rr_basis: e.rrBasis, min_rr_used: str(s.minRr),
    entry_status: a.status, status_reasons: a.reasons,
    quality_score: a.quality.score, quality_grade: a.quality.grade, quality_version: a.quality.version,
    quality_coverage: a.quality.coverage, quality_factors: jsonSafe(a.quality.factors),
    leverage: str(s.leverage), risk_amount: str(a.plan?.riskBudget ?? null), total_notional: str(t?.notional ?? null),
    total_margin: str(t?.margin ?? null), avg_entry: str(t?.avgEntry ?? null), entries_count: a.plan?.steps.length ?? null,
    max_safe_leverage: str(a.plan?.maxSafeLeverage ?? null), liq_estimate: str(a.plan?.liq?.liqPrice ?? null),
    plan: planJson(a), plan_issues: a.plan?.issues ?? [], contract_known: contractKnown,
    settings_snapshot: jsonSafe(s), signal_at: rev.signal_at,
  };
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const provided = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || !safeEqual(provided, expected)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method not allowed" }, 405);

  // global kill switch: no database access, no network, nothing
  if ((Deno.env.get("REVERSE_PLUS_ENABLED") ?? "true").trim().toLowerCase() === "false") {
    return json({ ok: true, skipped: "REVERSE_PLUS_ENABLED=false" });
  }

  const t0 = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const stats = { users: 0, signals: 0, evalCreated: 0, liveUpserted: 0, tradesCreated: 0, tradesUpdated: 0, skippedBudget: 0, errors: [] as string[] };
  const err = (m: string) => { if (stats.errors.length < 10) stats.errors.push(m); };

  try {
    // ---- users with the module ON --------------------------------------------------------
    const { data: setRows, error: setErr } = await supabase.from("reverse_plus_settings").select("*").eq("enabled", true);
    if (setErr) throw new Error(`settings: ${setErr.message}`);
    const users = (setRows ?? []).filter((r: Row) => r.enabled_at);
    stats.users = users.length;
    if (users.length === 0) return json({ ok: true, skipped: "no user has Reverse Signal Plus enabled", ...stats });

    const minEnabledAt = users.map((u: Row) => String(u.enabled_at)).sort()[0];

    // ---- existing reverse signals (READ ONLY) ----------------------------------------------
    const REV_COLS = "id, origin_outcome_id, symbol, timeframe, signal_type, price_at_signal, entry_low, entry_high, stop_loss, target1, signal_at, candle_close_time, status";
    const { data: revRows, error: revErr } = await supabase
      .from("reverse_signal_outcomes").select(REV_COLS)
      .neq("status", "CANCELLED").not("candle_close_time", "is", null)
      .order("signal_at", { ascending: false }).limit(MAX_SIGNALS);
    if (revErr) throw new Error(`reverse signals: ${revErr.message}`);
    const revById = new Map<string, Row>((revRows ?? []).map((r: Row) => [String(r.id), r]));

    // open paper trades may belong to older signals than the window above
    const userIds = users.map((u: Row) => String(u.user_id));
    const { data: openTrades } = await supabase
      .from("reverse_plus_trades").select("*").eq("mode", "PAPER").in("outcome", ["PENDING", "OPEN"]).in("user_id", userIds);
    const missingIds = (openTrades ?? []).map((t: Row) => String(t.reverse_outcome_id)).filter((id: string) => !revById.has(id));
    for (let i = 0; i < missingIds.length; i += 100) {
      const { data } = await supabase.from("reverse_signal_outcomes").select(REV_COLS).in("id", missingIds.slice(i, i + 100));
      for (const r of data ?? []) revById.set(String(r.id), r as Row);
    }

    // existing evaluations / trades for idempotency
    const revIds = [...revById.keys()];
    const evalKey = new Set<string>();
    const tradeByKey = new Map<string, Row>();
    for (let i = 0; i < revIds.length; i += 100) {
      const chunk = revIds.slice(i, i + 100);
      const { data: ev } = await supabase.from("reverse_plus_evaluations").select("user_id, reverse_outcome_id, eval_kind").eq("eval_kind", "SIGNAL_TIME").in("reverse_outcome_id", chunk).in("user_id", userIds);
      for (const e of ev ?? []) evalKey.add(`${e.user_id}|${e.reverse_outcome_id}`);
      const { data: tr } = await supabase.from("reverse_plus_trades").select("*").eq("mode", "PAPER").in("reverse_outcome_id", chunk).in("user_id", userIds);
      for (const t of tr ?? []) tradeByKey.set(`${t.user_id}|${t.reverse_outcome_id}`, t as Row);
    }

    const futures = await loadFuturesInfo();
    const beforeCache = new Map<string, Candle[]>();
    const afterCache = new Map<string, Candle[]>();
    const now = Date.now();

    const getBefore = async (rev: Row): Promise<Candle[]> => {
      const tf = normTf(String(rev.timeframe));
      const closeMs = Date.parse(String(rev.candle_close_time));
      const key = `${rev.symbol}|${tf}|${closeMs}`;
      if (!beforeCache.has(key)) {
        const rows = (await fetchJson(`${BINANCE_BASE}/api/v3/klines?symbol=${rev.symbol}&interval=${tf}&endTime=${closeMs}&limit=${BEFORE_LIMIT}`)) as unknown[][];
        beforeCache.set(key, parseKlines(rows).filter((c) => c.closeTime <= closeMs));
      }
      return beforeCache.get(key)!;
    };
    const getAfter = async (rev: Row): Promise<Candle[]> => {
      const tf = normTf(String(rev.timeframe));
      const closeMs = Date.parse(String(rev.candle_close_time));
      const key = `${rev.symbol}|${tf}|${closeMs}`;
      if (!afterCache.has(key)) {
        const limit = Math.min(1000, (EXPIRY_BARS[tf] ?? 48) * 2 + 5);
        const rows = (await fetchJson(`${BINANCE_BASE}/api/v3/klines?symbol=${rev.symbol}&interval=${tf}&startTime=${closeMs + 1}&limit=${limit}`)) as unknown[][];
        afterCache.set(key, closedCandles(parseKlines(rows), now).filter((c) => c.closeTime > closeMs));
      }
      return afterCache.get(key)!;
    };

    const contractFor = (symbol: string): { contract: ContractSpec; available: boolean } => {
      if (quoteOf(symbol) !== "USDT") return { contract: UNKNOWN_CONTRACT, available: false };
      if (!futures) return { contract: UNKNOWN_CONTRACT, available: true }; // cannot verify -> estimate, flagged
      return { contract: futures.specs.get(symbol) ?? UNKNOWN_CONTRACT, available: futures.perps.has(symbol) };
    };

    const analyse = (
      rev: Row, s: PlusSettings, candles: Candle[], asOfMs: number, after: Candle[], ageBars: number,
    ): { a: PlusAnalysis; price: Dec; contractKnown: boolean } => {
      const tf = normTf(String(rev.timeframe));
      const side = rev.signal_type as Side;
      const stop = decOrThrow(rev.stop_loss);
      const target = decOrThrow(rev.target1);
      const used = after.filter((c) => c.closeTime <= asOfMs);
      const last = used.length ? used[used.length - 1] : candles[candles.length - 1];
      const price = D(last.close);
      const high = used.length ? Math.max(...used.map((c) => c.high)) : 0;
      const low = used.length ? Math.min(...used.map((c) => c.low)) : Infinity;
      const stopTouched = used.length ? (side === "SELL" ? D(high) >= stop : D(low) <= stop) : false;
      const targetTouched = used.length ? (side === "SELL" ? D(low) <= target : D(high) >= target) : false;
      const { contract, available } = contractFor(String(rev.symbol));
      const a = buildPlusAnalysis({
        side, timeframe: tf, zoneLow: dec(rev.entry_low), zoneHigh: dec(rev.entry_high), refEntry: decOrThrow(rev.price_at_signal),
        stop, target, currentPrice: price, candles: [...candles, ...used], asOfCloseTime: asOfMs, ageBars,
        expiryBars: EXPIRY_BARS[tf] ?? 48, stopTouched, targetTouched, settings: s, contract, futuresAvailable: available,
      });
      return { a, price, contractKnown: contract.known };
    };

    // ---- per signal ---------------------------------------------------------------------------
    const signals = [...revById.values()].sort((x, y) => String(y.signal_at).localeCompare(String(x.signal_at)));
    for (const rev of signals) {
      if (Date.now() - t0 > BUDGET_MS) { stats.skippedBudget++; continue; }
      stats.signals++;
      const tf = normTf(String(rev.timeframe));
      const tfMs = timeframeMs(tf);
      const closeMs = Date.parse(String(rev.candle_close_time));
      const expiryBars = EXPIRY_BARS[tf] ?? 48;
      const ageNow = Math.floor((now - closeMs) / tfMs);

      for (const u of users) {
        const uid = String(u.user_id);
         // forward testing only
        const s = toSettings(u);
        const key = `${uid}|${rev.id}`;
        try {
          const trade = tradeByKey.get(key);
          const needLive = ageNow < expiryBars * 2;
          const needSim = trade && (trade.outcome === "PENDING" || trade.outcome === "OPEN");
          const needFirst = !evalKey.has(key);
          if (!needFirst && !needLive && !needSim) continue;

          const before = await getBefore(rev);
          if (before.length < 50) { err(`${rev.symbol} ${tf}: only ${before.length} candles before the signal`); continue; }

          // 1. SIGNAL_TIME evaluation (once) + PAPER trade creation --------------------------------
          if (needFirst) {
            const { a, price, contractKnown } = analyse(rev, s, before, closeMs, [], 0);
            const row = evaluationRow(uid, rev, "SIGNAL_TIME", closeMs, price, a, s, contractKnown);
            const { data: ins, error } = await supabase.from("reverse_plus_evaluations")
              .upsert(row, { onConflict: "user_id,reverse_outcome_id,eval_kind", ignoreDuplicates: true }).select("id");
            if (error) throw new Error(`eval insert: ${error.message}`);
            evalKey.add(key);
            if (ins && ins.length) stats.evalCreated++;

            if (a.plan?.ok && a.status !== "INVALID" && a.status !== "EXPIRED" && !tradeByKey.has(key)) {
              const steps = a.plan.steps;
              const tradeRow: Row = {
                user_id: uid, mode: "PAPER", reverse_outcome_id: rev.id, origin_outcome_id: rev.origin_outcome_id,
                evaluation_id: ins && ins.length ? ins[0].id : null, symbol: rev.symbol, timeframe: rev.timeframe, side: rev.signal_type,
                quality_score: a.quality.score, recommended_entry: str(a.entry.recommendedEntry), stop_loss: str(dec(rev.stop_loss)),
                take_profit: str(dec(rev.target1)), leverage: str(s.leverage), margin_used: str(a.plan.totals?.margin ?? null),
                entries_planned: steps.length, entries_filled: 0, plan: planJson(a), outcome: "PENDING", signal_at: rev.signal_at,
              };
              const { data: created, error: tErr } = await supabase.from("reverse_plus_trades")
                .upsert(tradeRow, { onConflict: "user_id,mode,reverse_outcome_id", ignoreDuplicates: true }).select("*");
              if (tErr) throw new Error(`paper trade insert: ${tErr.message}`);
              if (created && created.length) { tradeByKey.set(key, created[0] as Row); stats.tradesCreated++; }
            }
          }

          // 2. advance the PAPER trade (closed candles AFTER the signal only) ---------------------
          const current = tradeByKey.get(key);
          const after = (needLive || (current && (current.outcome === "PENDING" || current.outcome === "OPEN"))) ? await getAfter(rev) : [];
          const asOf = after.length ? after[after.length - 1].closeTime : closeMs;

          if (current && (current.outcome === "PENDING" || current.outcome === "OPEN")) {
            if (rev.status === "CANCELLED" && current.outcome === "PENDING") {
              await supabase.from("reverse_plus_trades").update({ outcome: "CANCELLED", updated_at: new Date().toISOString() }).eq("id", current.id);
              stats.tradesUpdated++;
            } else {
              const plan = (current.plan as { steps?: { entry: string; qty: string }[] } | null) ?? {};
              const steps = (plan.steps ?? []).map((x) => ({ price: D(x.entry), qty: D(x.qty) }));
              const sim = simulatePaper({
                side: rev.signal_type as Side, steps, stop: decOrThrow(rev.stop_loss), target: decOrThrow(rev.target1),
                cost: { feePct: s.feePct, slippagePct: s.slippagePct }, candlesAfter: after, asOfCloseTime: asOf,
                maxFillBars: expiryBars, maxHoldBars: expiryBars,
              });
              const fillsJson = jsonSafe(sim.fills.map((f) => ({ price: f.price, qty: f.qty, time: new Date(f.time).toISOString() })));
              const changed = sim.status !== current.outcome || sim.fills.length !== Number(current.entries_filled ?? 0);
              if (changed) {
                const closed = sim.status !== "PENDING" && sim.status !== "OPEN";
                const { error } = await supabase.from("reverse_plus_trades").update({
                  outcome: sim.status, entries_filled: sim.fills.length, fills: fillsJson, qty_total: str(sim.qtyFilled),
                  avg_entry: str(sim.avgEntry), exit_price: str(sim.exitPrice), exit_at: sim.exitTime ? new Date(sim.exitTime).toISOString() : null,
                  gross_pnl: str(sim.grossPnl), fees: str(sim.fees), slippage_cost: str(sim.slippageCost), net_pnl: str(sim.netPnl),
                  risk_at_stop: str(sim.riskAtStop), final_r: str(sim.finalR),
                  opened_at: sim.fills.length ? new Date(sim.fills[0].time).toISOString() : null,
                  notes: sim.notes.join(","), updated_at: new Date().toISOString(),
                }).eq("id", current.id).in("outcome", ["PENDING", "OPEN"]); // never rewrites a closed trade
                if (error) throw new Error(`paper trade update: ${error.message}`);
                stats.tradesUpdated++;
                if (closed) tradeByKey.set(key, { ...current, outcome: sim.status });
              }
            }
          }

          // 3. LIVE evaluation -----------------------------------------------------------------------
          if (needLive) {
            const ageBars = Math.max(0, Math.floor((asOf - closeMs) / tfMs));
            const { a, price, contractKnown } = analyse(rev, s, before, asOf, after, ageBars);
            const row = evaluationRow(uid, rev, "LIVE", asOf, price, a, s, contractKnown);
            const { error } = await supabase.from("reverse_plus_evaluations")
              .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,reverse_outcome_id,eval_kind" });
            if (error) throw new Error(`live upsert: ${error.message}`);
            stats.liveUpserted++;
          }
        } catch (e) {
          err(`${rev.symbol} ${tf} ${uid.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return json({ ok: true, duration_ms: Date.now() - t0, futures_info: futures ? "ok" : "unavailable (sizes flagged as estimates)", ...stats });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e), ...stats }, 500);
  }
});
