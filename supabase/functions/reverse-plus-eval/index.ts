// supabase/functions/reverse-plus-eval/index.ts
//
// Reverse Signal Plus — independent evaluator (analysis + PAPER trading). NO order execution.
//
// PUBLIC / CENTRAL model: one run evaluates every reverse signal ONCE with the reference configuration
// (table reverse_plus_public_config) and stores rows with user_id = NULL that every signed-in user can read.
// It does NOT depend on any user's reverse_plus_settings.enabled (that column is legacy).
//   1. SIGNAL_TIME evaluation : once per existing reverse signal, from candles closed at the signal candle.
//   2. PAPER trade            : only for signals issued at/after public_since (historical signals never get one),
//                               then advanced from closed candles AFTER the signal.
//   3. LIVE evaluation        : the same analysis on the latest closed candle for signals that are still relevant.
//
// Independence guarantees:
//   * It only READS signal_outcomes-derived data from `reverse_signal_outcomes` (select). It never writes there.
//   * It writes ONLY to reverse_plus_evaluations / reverse_plus_trades.
//   * It does not import or modify scheduled-scan / track-signal and has its OWN schedule (reverse_plus_cron_setup.sql).
//   * Idempotent: unique indexes + upserts, so running it twice never duplicates an evaluation or trade.
//   * Nothing is processed when the global switch REVERSE_PLUS_ENABLED=false.
//
// Auth: header x-cron-secret: <CRON_SECRET>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { closedCandles, EXPIRY_BARS, quoteOf, timeframeMs, type Candle } from "../_shared/engine.ts";
import {
  BACKTEST_ENGINE_VERSION, D, PUBLIC_OWNER, UNKNOWN_CONTRACT, backtestSignal, buildPlusAnalysis, isHistoricalSignal, jsonSafe, mayCreatePaperTrade, simulatePaper, toString,
  type BtCandle,
  type ContractSpec, type Dec, type PlusAnalysis, type PlusSettings, type Side,
} from "../_shared/reversePlus/index.ts";

const BINANCE_BASE = "https://data-api.binance.vision";
const BINANCE_FUTURES = "https://fapi.binance.com";
const BUDGET_MS = 100_000;
<<<<<<< HEAD
const MAX_SIGNALS = 3000; // newest first, read in pages of 1000 (backlog of historical signals is processed over several runs)
=======
const MAX_SIGNALS = 500;
const CENTRAL_OWNER_KEY = "8f7a2b6e-4c91-4d35-a8e2-6b1f9c3d7e50";
>>>>>>> c3df976 (Centralize Reverse Plus evaluations and paper trades)
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
  userId: string | null, rev: Row, kind: "SIGNAL_TIME" | "LIVE", asOfMs: number, price: Dec, a: PlusAnalysis,
  s: PlusSettings, contractKnown: boolean,
): Row {
  const e = a.entry;
  const t = a.plan?.totals ?? null;
  return {
    user_id: userId, owner_key: CENTRAL_OWNER_KEY, source: "CENTRAL", reverse_outcome_id: rev.id, origin_outcome_id: rev.origin_outcome_id, symbol: rev.symbol,
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

  // Global kill switch
  if ((Deno.env.get("REVERSE_PLUS_ENABLED") ?? "true").trim().toLowerCase() === "false") {
    return json({ ok: true, skipped: "REVERSE_PLUS_ENABLED=false" });
  }

  // Trigger requests target one signal; cron requests without an ID reconcile the queue.
  let requestedId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body && typeof body.reverse_outcome_id === "string" && body.reverse_outcome_id.trim()) {
        requestedId = body.reverse_outcome_id.trim();
      }
    } catch {
      // Empty body is valid for the scheduled reconciliation run.
    }
  }

  const t0 = Date.now();
<<<<<<< HEAD
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const stats = { users: 0, signals: 0, evalCreated: 0, liveUpserted: 0, tradesCreated: 0, tradesUpdated: 0, backtests: 0, btRetry: 0, skippedBudget: 0, errors: [] as string[] };
  const err = (m: string) => { if (stats.errors.length < 10) stats.errors.push(m); };

  try {
    // ---- central reference configuration (one row, shared by everybody) -----------------------
    const { data: cfg, error: cfgErr } = await supabase.from("reverse_plus_public_config").select("*").eq("id", true).maybeSingle();
    if (cfgErr) throw new Error(`public config: ${cfgErr.message}`);
    if (!cfg) throw new Error("reverse_plus_public_config is empty - apply migration 20261109000000_reverse_plus_public.sql");
    const publicSince = String(cfg.public_since);
    const s = toSettings(cfg as Row);
    stats.users = 1; // the single central owner (user_id = NULL)

    // ---- existing reverse signals (READ ONLY) ----------------------------------------------
    const REV_COLS = "id, origin_outcome_id, symbol, timeframe, signal_type, price_at_signal, entry_low, entry_high, stop_loss, target1, signal_at, candle_close_time, status";
    const revRows: Row[] = [];
    for (let from = 0; from < MAX_SIGNALS; from += 1000) {
      const { data, error: revErr } = await supabase
        .from("reverse_signal_outcomes").select(REV_COLS)
        .neq("status", "CANCELLED").not("candle_close_time", "is", null)
        .order("signal_at", { ascending: false }).range(from, from + 999);
      if (revErr) throw new Error(`reverse signals: ${revErr.message}`);
      revRows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    const revById = new Map<string, Row>((revRows ?? []).map((r: Row) => [String(r.id), r]));

    // open central paper trades may belong to older signals than the window above
    const { data: openTrades } = await supabase
      .from("reverse_plus_trades").select("*").eq("mode", "PAPER").in("outcome", ["PENDING", "OPEN"]).is("user_id", null);
    const missingIds = (openTrades ?? []).map((t: Row) => String(t.reverse_outcome_id)).filter((id: string) => !revById.has(id));
    for (let i = 0; i < missingIds.length; i += 100) {
      const { data } = await supabase.from("reverse_signal_outcomes").select(REV_COLS).in("id", missingIds.slice(i, i + 100));
      for (const r of data ?? []) revById.set(String(r.id), r as Row);
=======
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const stats = {
    users: 1, signals: 0, evalCreated: 0, liveUpserted: 0,
    tradesCreated: 0, tradesUpdated: 0, skippedBudget: 0, errors: [] as string[],
  };
  const err = (m: string) => {
    if (stats.errors.length < 10) stats.errors.push(m);
  };

  try {
    // Shared public configuration; personal settings do not gate central evaluation.
    const { data: publicConfig, error: configErr } = await supabase
      .from("reverse_plus_public_config")
      .select("*")
      .eq("id", true)
      .single();

    if (configErr || !publicConfig) {
      throw new Error(`public config: ${configErr?.message ?? "configuration row not found"}`);
    }

    const settings = toSettings(publicConfig);
    const REV_COLS =
      "id, origin_outcome_id, symbol, timeframe, signal_type, price_at_signal, entry_low, entry_high, stop_loss, target1, signal_at, candle_close_time, status";

    const revById = new Map<string, Row>();

    if (requestedId) {
      const { data: target, error: targetErr } = await supabase
        .from("reverse_signal_outcomes")
        .select(REV_COLS)
        .eq("id", requestedId)
        .neq("status", "CANCELLED")
        .not("candle_close_time", "is", null)
        .maybeSingle();

      if (targetErr) throw new Error(`target signal: ${targetErr.message}`);
      if (!target) {
        return json({
          ok: true,
          skipped: "signal not found or not eligible",
          reverse_outcome_id: requestedId,
          ...stats,
        });
      }
      revById.set(String(target.id), target as Row);
    } else {
      // Backup/reconciliation run: retain older signals that still have open central PAPER trades.
      const { data: openTrades, error: openErr } = await supabase
        .from("reverse_plus_trades")
        .select("reverse_outcome_id")
        .is("user_id", null)
        .eq("owner_key", CENTRAL_OWNER_KEY)
        .eq("mode", "PAPER")
        .in("outcome", ["PENDING", "OPEN"]);

      if (openErr) throw new Error(`open paper trades: ${openErr.message}`);

      const { data: revRows, error: revErr } = await supabase
        .from("reverse_signal_outcomes")
        .select(REV_COLS)
        .neq("status", "CANCELLED")
        .not("candle_close_time", "is", null)
        .order("signal_at", { ascending: false })
        .limit(MAX_SIGNALS);

      if (revErr) throw new Error(`reverse signals: ${revErr.message}`);
      for (const r of revRows ?? []) revById.set(String(r.id), r as Row);

      const missingIds = [...new Set((openTrades ?? [])
        .map((t: Row) => String(t.reverse_outcome_id))
        .filter((id: string) => !revById.has(id)))];

      for (let i = 0; i < missingIds.length; i += 100) {
        const { data, error } = await supabase
          .from("reverse_signal_outcomes")
          .select(REV_COLS)
          .in("id", missingIds.slice(i, i + 100));

        if (error) throw new Error(`older open signals: ${error.message}`);
        for (const r of data ?? []) revById.set(String(r.id), r as Row);
      }
>>>>>>> c3df976 (Centralize Reverse Plus evaluations and paper trades)
    }

    const revIds = [...revById.keys()];
    const evalKey = new Set<string>();
    const evalInfo = new Map<string, { entry: string | null; status: string }>();
    const btDone = new Set<string>();
    const tradeByKey = new Map<string, Row>();

    // Load central SIGNAL_TIME evaluations and all central PAPER trades for idempotency.
    for (let i = 0; i < revIds.length; i += 100) {
      const chunk = revIds.slice(i, i + 100);
<<<<<<< HEAD
      const { data: ev } = await supabase.from("reverse_plus_evaluations").select("user_id, reverse_outcome_id, eval_kind, recommended_entry, entry_status").eq("eval_kind", "SIGNAL_TIME").in("reverse_outcome_id", chunk).is("user_id", null);
      for (const e of ev ?? []) {
        evalKey.add(`${PUBLIC_OWNER}|${e.reverse_outcome_id}`);
        evalInfo.set(String(e.reverse_outcome_id), { entry: e.recommended_entry === null ? null : String(e.recommended_entry), status: String(e.entry_status) });
      }
      const { data: bts } = await supabase.from("reverse_plus_backtests").select("reverse_outcome_id").eq("engine_version", BACKTEST_ENGINE_VERSION).in("reverse_outcome_id", chunk);
      for (const b of bts ?? []) btDone.add(String(b.reverse_outcome_id));
      const { data: tr } = await supabase.from("reverse_plus_trades").select("*").eq("mode", "PAPER").in("reverse_outcome_id", chunk).is("user_id", null);
      for (const t of tr ?? []) tradeByKey.set(`${PUBLIC_OWNER}|${t.reverse_outcome_id}`, t as Row);
=======

      const { data: ev, error: evErr } = await supabase
        .from("reverse_plus_evaluations")
        .select("reverse_outcome_id")
        .is("user_id", null)
        .eq("owner_key", CENTRAL_OWNER_KEY)
        .eq("source", "CENTRAL")
        .eq("eval_kind", "SIGNAL_TIME")
        .in("reverse_outcome_id", chunk);

      if (evErr) throw new Error(`central evaluations: ${evErr.message}`);
      for (const e of ev ?? []) evalKey.add(String(e.reverse_outcome_id));

      const { data: trades, error: tradesErr } = await supabase
        .from("reverse_plus_trades")
        .select("*")
        .is("user_id", null)
        .eq("owner_key", CENTRAL_OWNER_KEY)
        .eq("mode", "PAPER")
        .in("reverse_outcome_id", chunk);

      if (tradesErr) throw new Error(`central paper trades: ${tradesErr.message}`);
      for (const t of trades ?? []) tradeByKey.set(String(t.reverse_outcome_id), t as Row);
>>>>>>> c3df976 (Centralize Reverse Plus evaluations and paper trades)
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
        const rows = (await fetchJson(
          `${BINANCE_BASE}/api/v3/klines?symbol=${rev.symbol}&interval=${tf}&endTime=${closeMs}&limit=${BEFORE_LIMIT}`,
        )) as unknown[][];
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
        const rows = (await fetchJson(
          `${BINANCE_BASE}/api/v3/klines?symbol=${rev.symbol}&interval=${tf}&startTime=${closeMs + 1}&limit=${limit}`,
        )) as unknown[][];
        afterCache.set(key, closedCandles(parseKlines(rows), now).filter((c) => c.closeTime > closeMs));
      }
      return afterCache.get(key)!;
    };

    // lower timeframe used ONLY to order TP/SL inside one ambiguous candle
    const LOWER_TF: Record<string, string> = { "5m": "1m", "15m": "1m", "30m": "1m", "1h": "1m", "4h": "5m", "1d": "15m", "1w": "1h" };
    const runHistoricalBacktest = async (rev: Row, entryStr: string, aft: Candle[]) => {
      const tf = normTf(String(rev.timeframe));
      const lowTf = LOWER_TF[tf];
      const subCache = new Map<number, BtCandle[]>();
      const toBt = (c: Candle): BtCandle => ({ openTime: c.openTime, closeTime: c.closeTime, open: c.open, high: c.high, low: c.low, close: c.close });
      const need = new Set<number>();
      const params = () => ({
        side: rev.signal_type as Side, entry: D(entryStr), stop: decOrThrow(rev.stop_loss), target: decOrThrow(rev.target1),
        signalCloseTime: Date.parse(String(rev.candle_close_time)), candles: aft.map(toBt),
        entryWindowBars: EXPIRY_BARS[tf] ?? 48, maxHoldBars: EXPIRY_BARS[tf] ?? 48,
        lowerTf: (c: BtCandle) => { if (!lowTf) return null; const hit = subCache.get(c.openTime); if (!hit) { need.add(c.openTime); return null; } return hit.length ? hit : null; },
      });
      let res = backtestSignal(params());
      for (let round = 0; round < 3 && res.outcome === "AMBIGUOUS" && need.size > 0 && lowTf; round++) {
        for (const openTime of [...need].slice(0, 5)) {
          const c = aft.find((x) => x.openTime === openTime);
          if (!c) { subCache.set(openTime, []); continue; }
          try {
            const rows = (await fetchJson(`${BINANCE_BASE}/api/v3/klines?symbol=${rev.symbol}&interval=${lowTf}&startTime=${c.openTime}&endTime=${c.closeTime}&limit=1000`)) as unknown[][];
            subCache.set(openTime, parseKlines(rows).filter((x) => x.openTime >= c.openTime && x.closeTime <= c.closeTime + 1));
          } catch { subCache.set(openTime, []); }
        }
        need.clear();
        res = backtestSignal(params());
      }
      return res;
    };

    const contractFor = (symbol: string): { contract: ContractSpec; available: boolean } => {
      if (quoteOf(symbol) !== "USDT") return { contract: UNKNOWN_CONTRACT, available: false };
      if (!futures) return { contract: UNKNOWN_CONTRACT, available: true };
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
        side, timeframe: tf, zoneLow: dec(rev.entry_low), zoneHigh: dec(rev.entry_high),
        refEntry: decOrThrow(rev.price_at_signal), stop, target, currentPrice: price,
        candles: [...candles, ...used], asOfCloseTime: asOfMs, ageBars,
        expiryBars: EXPIRY_BARS[tf] ?? 48, stopTouched, targetTouched,
        settings: s, contract, futuresAvailable: available,
      });
      return { a, price, contractKnown: contract.known };
    };

    const signals = [...revById.values()].sort(
      (x, y) => String(y.signal_at).localeCompare(String(x.signal_at)),
    );

    for (const rev of signals) {
      if (Date.now() - t0 > BUDGET_MS) {
        stats.skippedBudget++;
        continue;
      }

      stats.signals++;
      const tf = normTf(String(rev.timeframe));
      const tfMs = timeframeMs(tf);
      const closeMs = Date.parse(String(rev.candle_close_time));
      const expiryBars = EXPIRY_BARS[tf] ?? 48;
      const ageNow = Math.floor((now - closeMs) / tfMs);
      const key = String(rev.id);

<<<<<<< HEAD
      { // single central owner (user_id = NULL); `continue` below moves on to the next signal
        const uid = PUBLIC_OWNER;
        const key = `${uid}|${rev.id}`;
        try {
          const trade = tradeByKey.get(key);
          // BOUNDARY: signals issued before public_since are HISTORICAL (SIGNAL_TIME snapshot + backtest only).
          // LIVE evaluation and PAPER trades exist only for signals issued at/after public_since.
          const historical = isHistoricalSignal(String(rev.signal_at), publicSince);
          const needLive = !historical && ageNow < expiryBars * 2;
          const needSim = trade && (trade.outcome === "PENDING" || trade.outcome === "OPEN");
          const needFirst = !evalKey.has(key);
          const needBt = historical && !btDone.has(String(rev.id));
          if (!needFirst && !needLive && !needSim && !needBt) continue;

          const before = (needFirst || needLive) ? await getBefore(rev) : [];
          if ((needFirst || needLive) && before.length < 50) { err(`${rev.symbol} ${tf}: only ${before.length} candles before the signal`); continue; }

          // 1. SIGNAL_TIME evaluation (once) + PAPER trade creation --------------------------------
          if (needFirst) {
            const { a, price, contractKnown } = analyse(rev, s, before, closeMs, [], 0);
            const row = evaluationRow(null, rev, "SIGNAL_TIME", closeMs, price, a, s, contractKnown);
            const { data: ins, error } = await supabase.from("reverse_plus_evaluations")
              .upsert(row, { onConflict: "owner_key,reverse_outcome_id,eval_kind", ignoreDuplicates: true }).select("id");
            if (error) throw new Error(`eval insert: ${error.message}`);
            evalKey.add(key);
            evalInfo.set(String(rev.id), { entry: str(a.entry.recommendedEntry), status: a.status });
            if (ins && ins.length) stats.evalCreated++;

            // historical signals (issued before public_since) only get the SIGNAL_TIME snapshot - never a PAPER trade
            if (mayCreatePaperTrade(String(rev.signal_at), publicSince) && a.plan?.ok && a.status !== "INVALID" && a.status !== "EXPIRED" && !tradeByKey.has(key)) {
              const steps = a.plan.steps;
              const tradeRow: Row = {
                user_id: null, mode: "PAPER", reverse_outcome_id: rev.id, origin_outcome_id: rev.origin_outcome_id,
                evaluation_id: ins && ins.length ? ins[0].id : null, symbol: rev.symbol, timeframe: rev.timeframe, side: rev.signal_type,
                quality_score: a.quality.score, recommended_entry: str(a.entry.recommendedEntry), stop_loss: str(dec(rev.stop_loss)),
                take_profit: str(dec(rev.target1)), leverage: str(s.leverage), margin_used: str(a.plan.totals?.margin ?? null),
                entries_planned: steps.length, entries_filled: 0, plan: planJson(a), outcome: "PENDING", signal_at: rev.signal_at,
              };
              const { data: created, error: tErr } = await supabase.from("reverse_plus_trades")
                .upsert(tradeRow, { onConflict: "owner_key,mode,reverse_outcome_id", ignoreDuplicates: true }).select("*");
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

          // 2b. historical backtest (real closed candles, chronological, no hindsight) ----------------
          if (needBt) {
            const info = evalInfo.get(String(rev.id));
            const entryStr = info?.entry ?? null;
            if (entryStr) {
              const aft = await getAfter(rev);
              const res = await runHistoricalBacktest(rev, entryStr, aft);
              const ageBars = Math.floor((now - closeMs) / tfMs);
              // an UNKNOWN caused by "not enough candles yet" is retried on the next run instead of being stored
              if (res.outcome !== "UNKNOWN" || ageBars > expiryBars * 2 + 2) {
                const { error } = await supabase.from("reverse_plus_backtests").upsert({
                  reverse_outcome_id: rev.id, origin_outcome_id: rev.origin_outcome_id, symbol: rev.symbol, timeframe: rev.timeframe,
                  side: rev.signal_type, signal_at: rev.signal_at, signal_close_time: rev.candle_close_time, entry_level: entryStr,
                  stop_loss: str(dec(rev.stop_loss)), take_profit: str(dec(rev.target1)), strategy_status: info?.status ?? null,
                  outcome: res.outcome, reason: res.reason,
                  entry_time: res.entryTime ? new Date(res.entryTime).toISOString() : null, entry_price: str(res.entryPrice),
                  exit_time: res.exitTime ? new Date(res.exitTime).toISOString() : null, exit_price: str(res.exitPrice), exit_reason: res.exitReason,
                  bars_to_entry: res.barsToEntry, bars_held: res.barsHeld, worst_price: str(res.worstPrice), best_price: str(res.bestPrice),
                  candles_used: res.candlesUsed, lower_tf_used: res.lowerTfUsed, engine_version: BACKTEST_ENGINE_VERSION,
                  assumptions: { entry: "limit at recommended entry (SIGNAL_TIME evaluation)", fillRule: "candle range must reach the limit", stopGap: "exit at open",
                    targetGap: "exit at target", fundingIncluded: false, entryWindowBars: expiryBars, maxHoldBars: expiryBars },
                }, { onConflict: "reverse_outcome_id,engine_version", ignoreDuplicates: true });
                if (error) throw new Error(`backtest insert: ${error.message}`);
                btDone.add(String(rev.id));
                stats.backtests++;
              } else stats.btRetry++;
            }
          }

          // 3. LIVE evaluation -----------------------------------------------------------------------
          if (needLive) {
            const ageBars = Math.max(0, Math.floor((asOf - closeMs) / tfMs));
            const { a, price, contractKnown } = analyse(rev, s, before, asOf, after, ageBars);
            const row = evaluationRow(null, rev, "LIVE", asOf, price, a, s, contractKnown);
            const { error } = await supabase.from("reverse_plus_evaluations")
              .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "owner_key,reverse_outcome_id,eval_kind" });
            if (error) throw new Error(`live upsert: ${error.message}`);
            stats.liveUpserted++;
          }
        } catch (e) {
          err(`${rev.symbol} ${tf} ${uid}: ${e instanceof Error ? e.message : String(e)}`);
=======
      try {
        let current = tradeByKey.get(key);
        const needFirst = !evalKey.has(key);
        const needLive = ageNow < expiryBars * 2;
        const needSim = !!current && (current.outcome === "PENDING" || current.outcome === "OPEN");

        const needPaper = !current && evalKey.has(key);
        if (!needFirst && !needLive && !needSim && !needPaper) continue;

        const before = await getBefore(rev);
        if (before.length < 50) {
          err(`${rev.symbol} ${tf}: only ${before.length} candles before the signal`);
          continue;
>>>>>>> c3df976 (Centralize Reverse Plus evaluations and paper trades)
        }

        // Analyse once for evaluation and PAPER creation.
        const { a, price, contractKnown } = analyse(rev, settings, before, closeMs, [], 0);

        // 1. Shared SIGNAL_TIME evaluation, created once.
        if (needFirst) {
          const row = evaluationRow(null, rev, "SIGNAL_TIME", closeMs, price, a, settings, contractKnown);

          const { data: inserted, error: insertErr } = await supabase
            .from("reverse_plus_evaluations")
            .upsert(row, {
              onConflict: "owner_key,reverse_outcome_id,eval_kind",
              ignoreDuplicates: true,
            })
            .select("id");

          if (insertErr) throw new Error(`SIGNAL_TIME insert: ${insertErr.message}`);
          evalKey.add(key);
          if (inserted?.length) stats.evalCreated++;
        }

        // 2. Create a shared PAPER trade even when SIGNAL_TIME already exists.
        if (
          a.plan?.ok &&
          a.status !== "INVALID" &&
          a.status !== "EXPIRED" &&
          !tradeByKey.has(key)
        ) {
          const { data: evaluation, error: evaluationErr } = await supabase
            .from("reverse_plus_evaluations")
            .select("id")
            .is("user_id", null)
            .eq("owner_key", CENTRAL_OWNER_KEY)
            .eq("reverse_outcome_id", rev.id)
            .eq("eval_kind", "SIGNAL_TIME")
            .maybeSingle();

          if (evaluationErr) throw new Error(`PAPER evaluation lookup: ${evaluationErr.message}`);

          const tradeRow: Row = {
            user_id: null,
            owner_key: CENTRAL_OWNER_KEY,
            mode: "PAPER",
            reverse_outcome_id: rev.id,
            origin_outcome_id: rev.origin_outcome_id,
            evaluation_id: evaluation?.id ?? null,
            symbol: rev.symbol,
            timeframe: rev.timeframe,
            side: rev.signal_type,
            quality_score: a.quality.score,
            recommended_entry: str(a.entry.recommendedEntry),
            stop_loss: str(dec(rev.stop_loss)),
            take_profit: str(dec(rev.target1)),
            leverage: str(settings.leverage),
            margin_used: str(a.plan.totals?.margin ?? null),
            entries_planned: a.plan.steps.length,
            entries_filled: 0,
            plan: planJson(a),
            outcome: "PENDING",
            signal_at: rev.signal_at,
          };

          const { data: created, error: tradeErr } = await supabase
            .from("reverse_plus_trades")
            .upsert(tradeRow, {
              onConflict: "owner_key,mode,reverse_outcome_id",
              ignoreDuplicates: true,
            })
            .select("*");

          if (tradeErr) throw new Error(`PAPER trade insert: ${tradeErr.message}`);

          let savedTrade = created?.[0] as Row | undefined;

          if (!savedTrade) {
            const { data: existingTrade, error: existingTradeErr } = await supabase
              .from("reverse_plus_trades")
              .select("*")
              .is("user_id", null)
              .eq("owner_key", CENTRAL_OWNER_KEY)
              .eq("mode", "PAPER")
              .eq("reverse_outcome_id", rev.id)
              .maybeSingle();

            if (existingTradeErr) throw new Error(`existing PAPER trade: ${existingTradeErr.message}`);
            savedTrade = existingTrade as Row | undefined;
          }

          if (savedTrade) {
            tradeByKey.set(key, savedTrade);
            if (created?.length) stats.tradesCreated++;
          }
        }

        // 3. Advance only the shared PAPER trade using candles after the signal.
        current = tradeByKey.get(key);
        const isOpen = !!current && (current.outcome === "PENDING" || current.outcome === "OPEN");
        const after = (needLive || isOpen) ? await getAfter(rev) : [];
        const asOf = after.length ? after[after.length - 1].closeTime : closeMs;

        if (current && (current.outcome === "PENDING" || current.outcome === "OPEN")) {
          if (rev.status === "CANCELLED" && current.outcome === "PENDING") {
            const { error: cancelErr } = await supabase
              .from("reverse_plus_trades")
              .update({ outcome: "CANCELLED", updated_at: new Date().toISOString() })
              .eq("id", current.id)
              .in("outcome", ["PENDING", "OPEN"]);

            if (cancelErr) throw new Error(`PAPER cancellation: ${cancelErr.message}`);
            stats.tradesUpdated++;
            tradeByKey.set(key, { ...current, outcome: "CANCELLED" });
          } else {
            const plan = (current.plan as { steps?: { entry: string; qty: string }[] } | null) ?? {};
            const steps = (plan.steps ?? []).map((x) => ({ price: D(x.entry), qty: D(x.qty) }));
            const sim = simulatePaper({
              side: rev.signal_type as Side,
              steps,
              stop: decOrThrow(rev.stop_loss),
              target: decOrThrow(rev.target1),
              cost: { feePct: settings.feePct, slippagePct: settings.slippagePct },
              candlesAfter: after,
              asOfCloseTime: asOf,
              maxFillBars: expiryBars,
              maxHoldBars: expiryBars,
            });

            const fillsJson = jsonSafe(sim.fills.map((f) => ({
              price: f.price,
              qty: f.qty,
              time: new Date(f.time).toISOString(),
            })));
            const changed =
              sim.status !== current.outcome ||
              sim.fills.length !== Number(current.entries_filled ?? 0);

            if (changed) {
              const closed = sim.status !== "PENDING" && sim.status !== "OPEN";
              const { error: updateErr } = await supabase
                .from("reverse_plus_trades")
                .update({
                  outcome: sim.status,
                  entries_filled: sim.fills.length,
                  fills: fillsJson,
                  qty_total: str(sim.qtyFilled),
                  avg_entry: str(sim.avgEntry),
                  exit_price: str(sim.exitPrice),
                  exit_at: sim.exitTime ? new Date(sim.exitTime).toISOString() : null,
                  gross_pnl: str(sim.grossPnl),
                  fees: str(sim.fees),
                  slippage_cost: str(sim.slippageCost),
                  net_pnl: str(sim.netPnl),
                  risk_at_stop: str(sim.riskAtStop),
                  final_r: str(sim.finalR),
                  opened_at: sim.fills.length ? new Date(sim.fills[0].time).toISOString() : null,
                  notes: sim.notes.join(","),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", current.id)
                .in("outcome", ["PENDING", "OPEN"]);

              if (updateErr) throw new Error(`PAPER trade update: ${updateErr.message}`);
              stats.tradesUpdated++;
              tradeByKey.set(key, { ...current, outcome: sim.status });
            }
          }
        }

        // 4. Shared LIVE evaluation.
        if (needLive) {
          const ageBars = Math.max(0, Math.floor((asOf - closeMs) / tfMs));
          const { a, price, contractKnown } = analyse(
            rev, settings, before, asOf, after, ageBars,
          );
          const row = evaluationRow(null, rev, "LIVE", asOf, price, a, settings, contractKnown);

          const { error: liveErr } = await supabase
            .from("reverse_plus_evaluations")
            .upsert(
              { ...row, updated_at: new Date().toISOString() },
              { onConflict: "owner_key,reverse_outcome_id,eval_kind" },
            );

          if (liveErr) throw new Error(`LIVE upsert: ${liveErr.message}`);
          stats.liveUpserted++;
        }
      } catch (e) {
        err(`${rev.symbol} ${tf}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return json({
      ok: true,
      mode: requestedId ? "IMMEDIATE_SINGLE_SIGNAL" : "SCHEDULED_RECONCILIATION",
      reverse_outcome_id: requestedId,
      duration_ms: Date.now() - t0,
      futures_info: futures ? "ok" : "unavailable (sizes flagged as estimates)",
      ...stats,
    });
  } catch (e) {
    return json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ...stats,
    }, 500);
  }
});
