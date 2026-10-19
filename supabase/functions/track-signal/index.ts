// supabase/functions/track-signal/index.ts
//
// ردیابی دستی سیگنال برای همه کاربران.
// Registers a paper trade for the signed-in user. The client only sends { symbol, timeframe };
// the analysis (entry / stop / targets) is recomputed HERE from the latest closed candle with the default
// settings, so Signal Lab statistics cannot be forged.
//
// POST  Authorization: Bearer <user access token>   body: { "symbol": "SOLUSDT" | "SOLBTC", "timeframe": "1h" }
// Deploy with --no-verify-jwt (the token is verified inside, see below).
//
// Reverse Signal Lab: right after the manual signal is registered, its mirrored trade (direction flipped,
// stop <-> target swapped) is registered too. This is best effort: if it fails, the hourly `scheduled-scan`
// back-fills the missing mirror, so a manual track never fails because of the reverse lab.
// Even when the signal already exists (already: true), we still ensure the reverse mirror row exists.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  analyzeCore,
  buildReverseOutcomeRow,
  closedCandles,
  lastBoundary,
  normalizeSymbol,
  splitSymbol,
  type Candle,
  type OriginOutcome,
} from "../_shared/engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BINANCE_BASE = "https://data-api.binance.vision";
const ALLOWED_TF = new Set(["15m", "30m", "1h", "4h", "1d"]);
const SYMBOL_RE = /^[A-Z0-9]{2,15}(USDT|BTC)$/;
const MAX_OPEN_PER_USER = 20;
const MAX_PER_DAY = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function fetchCandles(symbol: string, interval: string): Promise<Candle[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(
      `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown[][];
    return closedCandles(
      rows
        .map((row) => ({
          openTime: row[0] as number,
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
          closeTime: row[6] as number,
        }))
        .filter((c) => Number.isFinite(c.close)),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>;

/** Best-effort: create/ensure reverse_signal_outcomes row for this origin. Never throws to the caller. */
async function ensureReverseMirror(supabase: SupabaseClient, origin: OriginOutcome): Promise<void> {
  try {
    const mirror = buildReverseOutcomeRow(origin);
    if (!mirror) return;
    const { error: mirrorError } = await supabase
      .from("reverse_signal_outcomes")
      .upsert(mirror, { onConflict: "origin_outcome_id", ignoreDuplicates: true });
    if (mirrorError) console.error("reverse mirror:", mirrorError.message);
  } catch (e) {
    console.error("reverse mirror:", e instanceof Error ? e.message : String(e));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, reason: "unauthorized" }, 401);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return json({ ok: false, reason: "unauthorized" }, 401);
  const userId = authData.user.id;

  let body: { symbol?: unknown; timeframe?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  const symbol = normalizeSymbol(String(body.symbol ?? ""));
  const timeframe = String(body.timeframe ?? "");
  if (!SYMBOL_RE.test(symbol) || !ALLOWED_TF.has(timeframe)) {
    return json({ ok: false, reason: "bad_request" }, 400);
  }

  const candles = await fetchCandles(symbol, timeframe);
  if (!candles || candles.length < 50) return json({ ok: false, reason: "unknown_symbol" }, 400);
  const last = candles[candles.length - 1];
  if (last.closeTime < lastBoundary(timeframe) - 1) {
    return json({ ok: false, reason: "data_not_ready" }, 503);
  }

  const a = analyzeCore(candles, { timeframe });
  if (!a || (a.signalType !== "BUY" && a.signalType !== "SELL") || !a.risk) {
    return json({
      ok: false,
      reason: "not_actionable",
      signal_type: a?.signalType ?? "NO_TRADE",
      score: a?.score ?? 0,
    });
  }

  const closeIso = new Date(a.candleCloseTime).toISOString();

  // --- same signal candle already tracked? ---
  const { data: existing } = await supabase
    .from("signal_outcomes")
    .select("id, status, source")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .eq("signal_type", a.signalType)
    .eq("candle_close_time", closeIso)
    .maybeSingle();

  if (existing) {
    // ensure reverse mirror even when already registered
    const { data: full } = await supabase
      .from("signal_outcomes")
      .select(
        "id, symbol, base_asset, timeframe, signal_type, score, price_at_signal, entry_low, entry_high, stop_loss, target1, signal_at, candle_close_time, source, tracked_by",
      )
      .eq("id", existing.id)
      .maybeSingle();

    if (full) {
      await ensureReverseMirror(supabase, {
        id: full.id as string,
        symbol: full.symbol as string,
        base_asset: full.base_asset as string,
        timeframe: full.timeframe as string,
        signal_type: full.signal_type as "BUY" | "SELL",
        score: Number(full.score),
        price_at_signal: Number(full.price_at_signal),
        entry_low: full.entry_low != null ? Number(full.entry_low) : null,
        entry_high: full.entry_high != null ? Number(full.entry_high) : null,
        stop_loss: Number(full.stop_loss),
        target1: Number(full.target1),
        signal_at: full.signal_at as string,
        candle_close_time: (full.candle_close_time as string) ?? null,
        source: (full.source as string) ?? "manual_track",
        tracked_by: (full.tracked_by as string) ?? null,
      });
    }

    return json({
      ok: true,
      already: true,
      id: existing.id,
      status: existing.status,
      signal_type: a.signalType,
      score: a.score,
    });
  }

  // --- per-user limits ---
  const { count: openCount } = await supabase
    .from("signal_outcomes")
    .select("id", { count: "exact", head: true })
    .eq("tracked_by", userId)
    .eq("status", "OPEN");
  if ((openCount ?? 0) >= MAX_OPEN_PER_USER) {
    return json({ ok: false, reason: "limit_open", limit: MAX_OPEN_PER_USER });
  }

  const { count: dayCount } = await supabase
    .from("signal_outcomes")
    .select("id", { count: "exact", head: true })
    .eq("tracked_by", userId)
    .gte("signal_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((dayCount ?? 0) >= MAX_PER_DAY) {
    return json({ ok: false, reason: "limit_day", limit: MAX_PER_DAY });
  }

  // --- register ---
  const p = a.risk;
  const signalAtIso = new Date().toISOString();
  const baseAsset = splitSymbol(symbol)?.base ?? symbol;

  const { data: inserted, error } = await supabase
    .from("signal_outcomes")
    .insert({
      symbol,
      base_asset: baseAsset,
      timeframe,
      signal_type: a.signalType,
      score: a.score,
      price_at_signal: a.price,
      entry_low: p.entryLow,
      entry_high: p.entryHigh,
      stop_loss: p.stopLoss,
      target1: p.target1,
      target2: p.target2,
      risk_reward: p.riskReward,
      signal_at: signalAtIso,
      candle_close_time: closeIso,
      status: "OPEN",
      source: "manual_track",
      tracked_by: userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // unique violation: try to ensure reverse for the existing row
      const { data: dup } = await supabase
        .from("signal_outcomes")
        .select(
          "id, symbol, base_asset, timeframe, signal_type, score, price_at_signal, entry_low, entry_high, stop_loss, target1, signal_at, candle_close_time, source, tracked_by",
        )
        .eq("symbol", symbol)
        .eq("timeframe", timeframe)
        .eq("signal_type", a.signalType)
        .eq("candle_close_time", closeIso)
        .maybeSingle();
      if (dup) {
        await ensureReverseMirror(supabase, {
          id: dup.id as string,
          symbol: dup.symbol as string,
          base_asset: dup.base_asset as string,
          timeframe: dup.timeframe as string,
          signal_type: dup.signal_type as "BUY" | "SELL",
          score: Number(dup.score),
          price_at_signal: Number(dup.price_at_signal),
          entry_low: dup.entry_low != null ? Number(dup.entry_low) : null,
          entry_high: dup.entry_high != null ? Number(dup.entry_high) : null,
          stop_loss: Number(dup.stop_loss),
          target1: Number(dup.target1),
          signal_at: dup.signal_at as string,
          candle_close_time: (dup.candle_close_time as string) ?? null,
          source: (dup.source as string) ?? "manual_track",
          tracked_by: (dup.tracked_by as string) ?? null,
        });
      }
      return json({ ok: true, already: true, signal_type: a.signalType, score: a.score });
    }
    return json({ ok: false, reason: "server_error" }, 500);
  }

  await ensureReverseMirror(supabase, {
    id: inserted.id as string,
    symbol,
    base_asset: baseAsset,
    timeframe,
    signal_type: a.signalType,
    score: a.score,
    price_at_signal: a.price,
    entry_low: p.entryLow,
    entry_high: p.entryHigh,
    stop_loss: p.stopLoss,
    target1: p.target1,
    signal_at: signalAtIso,
    candle_close_time: closeIso,
    source: "manual_track",
    tracked_by: userId,
  });

  return json({
    ok: true,
    already: false,
    id: inserted.id,
    signal_type: a.signalType,
    score: a.score,
    price: a.price,
    stop_loss: p.stopLoss,
    target1: p.target1,
  });
});
