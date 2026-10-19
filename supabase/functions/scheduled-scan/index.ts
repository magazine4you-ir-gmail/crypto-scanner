// supabase/functions/scheduled-scan/index.ts
//
// اسکن خودکار ساعتی ارزهای برتر (Buy / Short / Wait)
// + Signal Lab + Reverse Signal Lab
//
// What one run does:
//   1. Builds the coin universe (CoinGecko ∩ Binance spot, min liquidity)
//   2. Scans due (symbol, timeframe) pairs
//   3. Upserts scan_results
//   4. Signal Lab: resolve OPEN + register new BUY/SELL once per candle
//   4b. Reverse Signal Lab:
//        - backfill missing reverse rows for ALL non-CANCELLED outcomes (paginated)
//        - mirror CANCELLED origins
//        - resolve OPEN reverse trades (including historical closed origins)
//   5. Housekeeping
//
// Auth: header x-cron-secret: <CRON_SECRET>
// Optional: ?force=1   ?tf=1h,4h

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  analyzeCore,
  buildReverseOutcomeRow,
  closedCandles,
  EXPIRY_BARS,
  lastBoundary,
  quoteOf,
  resolveTrade,
  timeframeMs,
  type Candle,
  type CoreAnalysis,
  type QuoteAsset,
} from "../_shared/engine.ts";

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
const TIMEFRAMES = ["1h", "4h", "1d"];
const TOP_N = 100;
const BTC_TOP_N = 50;
const CANDLE_LIMIT = 300;
const CONCURRENCY = 8;
const SCAN_BUDGET_MS = 85_000;
const EVAL_BUDGET_MS = 140_000;
const MIN_QUOTE_VOLUME = 2_000_000;
const MIN_BTC_PAIR_VOLUME_USD = 300_000;
const KEEP_RUNS_DAYS = 14;
const KEEP_SIGNALS_DAYS = 30;
const STALE_ROW_DAYS = 3;

const REVERSE_PAGE = 500;
const REVERSE_MAX_PAGES = 40;

const BINANCE_BASE = "https://data-api.binance.vision";
const BINANCE_FUTURES = "https://fapi.binance.com";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const EXCLUDED_BASES = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDE", "USDS", "PYUSD", "USD1", "USDD",
  "GUSD", "FRAX", "LUSD", "EURC", "EURI", "AEUR", "XUSD", "RLUSD", "BFUSD", "USDG", "USDY", "SUSDE",
  "USDT0", "BSC-USD", "USDTB", "USDF", "USDX", "SUSD", "CUSD", "USDC.E", "BUIDL", "USTB", "USYC",
  "WBTC", "WETH", "STETH", "WSTETH", "WEETH", "WBETH", "BETH", "CBBTC", "CBETH", "RETH", "METH",
  "EZETH", "RSETH", "BNSOL", "JITOSOL", "MSOL", "WBNB", "WSTUSR", "SOLVBTC", "LBTC", "TBTC", "BTCB",
  "PAXG", "XAUT",
]);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url: string, headers: Record<string, string> = {}, tries = 3): Promise<unknown> {
  let lastError: Error = new Error("request failed");
  for (let attempt = 0; attempt < tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", ...headers } });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status === 418 || res.status >= 500;
      lastError = new Error(`HTTP ${res.status}`);
      if (!retryable) break;
      const retryAfter = Number(res.headers.get("Retry-After") || 0) * 1000;
      await sleep(Math.max(retryAfter, 600 * 2 ** attempt));
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      await sleep(600 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function parseKlines(rows: unknown[][]): Candle[] {
  return rows
    .map((row) => ({
      openTime: row[0] as number,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: row[6] as number,
    }))
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low));
}

async function mapPool<T>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<void>,
  deadline: number,
): Promise<number> {
  let next = 0;
  let skipped = 0;
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (Date.now() > deadline) {
        skipped++;
        continue;
      }
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return skipped;
}

const num = (v: number | null | undefined): number | null =>
  v !== null && v !== undefined && Number.isFinite(v) ? v : null;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------
// Universe
// ---------------------------------------------------------------------
interface Coin {
  symbol: string;
  base: string;
  quote: QuoteAsset;
  name: string;
  rank: number;
}

async function getTradablePairs(): Promise<Map<string, { base: string; quote: QuoteAsset }>> {
  const data = (await fetchJson(`${BINANCE_BASE}/api/v3/exchangeInfo`)) as {
    symbols?: Record<string, unknown>[];
  };
  const map = new Map<string, { base: string; quote: QuoteAsset }>();
  for (const s of data.symbols ?? []) {
    const quote = String(s.quoteAsset);
    if (s.status === "TRADING" && (quote === "USDT" || quote === "BTC") && s.isSpotTradingAllowed !== false) {
      map.set(String(s.symbol), { base: String(s.baseAsset).toUpperCase(), quote });
    }
  }
  return map;
}

async function getUsdVolumes(): Promise<Map<string, number> | null> {
  try {
    const tickers = (await fetchJson(`${BINANCE_BASE}/api/v3/ticker/24hr`)) as {
      symbol: string;
      quoteVolume: string;
      lastPrice: string;
    }[];
    const btcUsd = Number(tickers.find((t) => t.symbol === "BTCUSDT")?.lastPrice ?? 0);
    const out = new Map<string, number>();
    for (const t of tickers) {
      const v = Number(t.quoteVolume);
      if (quoteOf(t.symbol) === "BTC" && t.symbol.endsWith("BTC")) {
        out.set(t.symbol, btcUsd > 0 ? v * btcUsd : 0);
      } else {
        out.set(t.symbol, v);
      }
    }
    return out;
  } catch {
    return null;
  }
}

async function buildUniverse(n: number): Promise<{ coins: Coin[]; source: string }> {
  const [tradable, volumes] = await Promise.all([getTradablePairs(), getUsdVolumes()]);
  const minVolume = (symbol: string) =>
    tradable.get(symbol)?.quote === "BTC" ? MIN_BTC_PAIR_VOLUME_USD : MIN_QUOTE_VOLUME;
  const liquid = (symbol: string) => volumes === null || (volumes.get(symbol) ?? 0) >= minVolume(symbol);

  try {
    const key = Deno.env.get("COINGECKO_API_KEY");
    const headers: Record<string, string> = key ? { "x-cg-demo-api-key": key } : {};
    const cg = (await fetchJson(
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`,
      headers,
      2,
    )) as { symbol: string; name: string; market_cap_rank: number | null }[];

    const usdtCoins: Coin[] = [];
    const btcCoins: Coin[] = [];
    const seen = new Set<string>();
    const seenBtc = new Set<string>();
    for (const c of cg) {
      const base = String(c.symbol).toUpperCase();
      if (EXCLUDED_BASES.has(base)) continue;
      const rank = c.market_cap_rank ?? usdtCoins.length + 1;

      const usdt = `${base}USDT`;
      if (usdtCoins.length < n && !seen.has(usdt) && tradable.has(usdt) && liquid(usdt)) {
        seen.add(usdt);
        usdtCoins.push({ symbol: usdt, base, quote: "USDT", name: c.name, rank });
      }
      const btc = `${base}BTC`;
      if (base !== "BTC" && btcCoins.length < BTC_TOP_N && !seenBtc.has(btc) && tradable.has(btc) && liquid(btc)) {
        seenBtc.add(btc);
        btcCoins.push({ symbol: btc, base, quote: "BTC", name: c.name, rank });
      }
      if (usdtCoins.length >= n && btcCoins.length >= BTC_TOP_N) break;
    }
    if (usdtCoins.length >= Math.min(n, 50)) {
      return { coins: [...usdtCoins, ...btcCoins], source: "coingecko-marketcap" };
    }
  } catch {
    // fall through
  }

  const tickers = volumes ?? (await getUsdVolumes());
  if (!tickers) throw new Error("cannot build universe: Binance 24h tickers unavailable");
  const rankedBy = (quote: QuoteAsset, limit: number) =>
    [...tickers.entries()]
      .filter(([symbol, vol]) => {
        const t = tradable.get(symbol);
        return (
          t !== undefined &&
          t.quote === quote &&
          !EXCLUDED_BASES.has(t.base) &&
          !(quote === "BTC" && t.base === "BTC") &&
          vol >= minVolume(symbol)
        );
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([symbol]) => symbol);
  const usdtSymbols = rankedBy("USDT", n);
  const rankOfBase = new Map(usdtSymbols.map((symbol, i) => [tradable.get(symbol)!.base, i + 1]));
  const toCoin = (symbol: string, quote: QuoteAsset, i: number): Coin => {
    const base = tradable.get(symbol)!.base;
    return {
      symbol,
      base,
      quote,
      name: base,
      rank: rankOfBase.get(base) ?? usdtSymbols.length + i + 1,
    };
  };
  return {
    coins: [
      ...usdtSymbols.map((x, i) => toCoin(x, "USDT", i)),
      ...rankedBy("BTC", BTC_TOP_N).map((x, i) => toCoin(x, "BTC", i)),
    ],
    source: "binance-volume",
  };
}

async function getFuturesPerps(): Promise<Set<string> | null> {
  try {
    const data = (await fetchJson(`${BINANCE_FUTURES}/fapi/v1/exchangeInfo`, {}, 1)) as {
      symbols?: Record<string, unknown>[];
    };
    const set = new Set<string>();
    for (const s of data.symbols ?? []) {
      if (s.contractType === "PERPETUAL" && s.status === "TRADING" && s.quoteAsset === "USDT") {
        set.add(String(s.symbol));
      }
    }
    return set.size > 0 ? set : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------
async function fetchClosedCandles(symbol: string, interval: string): Promise<Candle[]> {
  const rows = (await fetchJson(
    `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${CANDLE_LIMIT}`,
  )) as unknown[][];
  return closedCandles(parseKlines(rows));
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>;

interface ScanRow extends Record<string, unknown> {
  symbol: string;
  base_asset: string;
  timeframe: string;
  signal_type: string;
  score: number;
  price: number;
  candle_close_time: string;
}

// ---------------------------------------------------------------------
// Signal Lab
// ---------------------------------------------------------------------
interface OutcomeRow {
  id: string;
  symbol: string;
  timeframe: string;
  signal_type: "BUY" | "SELL";
  price_at_signal: number;
  stop_loss: number;
  target1: number;
  signal_at: string;
  candle_close_time: string | null;
}

async function evaluateOpenOutcomes(
  supabase: SupabaseClient,
  t0: number,
): Promise<{ checked: number; closed: number }> {
  const { data, error } = await supabase.from("signal_outcomes").select("*").eq("status", "OPEN").limit(1000);
  if (error) throw new Error(`load open outcomes: ${error.message}`);
  const open = (data ?? []) as OutcomeRow[];
  if (open.length === 0) return { checked: 0, closed: 0 };

  const baseTs = (o: OutcomeRow) => Date.parse(o.candle_close_time ?? o.signal_at);
  const groups = new Map<string, OutcomeRow[]>();
  for (const o of open) {
    const key = `${o.symbol}|${o.timeframe}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }

  let closed = 0;
  await mapPool(
    [...groups.entries()],
    CONCURRENCY,
    async ([key, outcomes]) => {
      const [symbol, tf] = key.split("|");
      try {
        const start = Math.min(...outcomes.map(baseTs)) + 1;
        const rows = (await fetchJson(
          `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${tf}&startTime=${start}&limit=1000`,
        )) as unknown[][];
        const candles = closedCandles(parseKlines(rows));
        for (const o of outcomes) {
          const base = baseTs(o);
          const after = candles.filter((c) => c.closeTime > base);
          const res = resolveTrade(
            {
              direction: o.signal_type === "BUY" ? "LONG" : "SHORT",
              entry: Number(o.price_at_signal),
              stop: Number(o.stop_loss),
              target: Number(o.target1),
              maxBars: EXPIRY_BARS[tf] ?? 40,
            },
            after,
          );
          if (!res) continue;
          const { error: upErr } = await supabase
            .from("signal_outcomes")
            .update({
              status: res.status,
              exit_price: res.exitPrice,
              exit_at: new Date(res.exitTime).toISOString(),
              pnl_pct: res.pnlPct,
              pnl_gross_pct: res.grossPnlPct,
              r_multiple: res.rMultiple,
              bars_held: res.barsHeld,
              notes: res.status === "EXPIRED" ? "time expiry" : null,
            })
            .eq("id", o.id)
            .eq("status", "OPEN");
          if (!upErr) closed++;
        }
      } catch (e) {
        console.error(`evaluate ${key}:`, e instanceof Error ? e.message : String(e));
      }
    },
    t0 + EVAL_BUDGET_MS,
  );

  return { checked: open.length, closed };
}

async function registerNewOutcomes(
  supabase: SupabaseClient,
  fresh: ScanRow[],
  nowIso: string,
): Promise<number> {
  if (fresh.length === 0) return 0;

  const { data: openRows } = await supabase
    .from("signal_outcomes")
    .select("symbol, timeframe, signal_type")
    .eq("status", "OPEN")
    .eq("source", "auto_scan");
  const openSet = new Set((openRows ?? []).map((o) => `${o.symbol}|${o.timeframe}|${o.signal_type}`));

  const toInsert: Record<string, unknown>[] = [];
  for (const r of fresh) {
    const key = `${r.symbol}|${r.timeframe}|${r.signal_type}`;
    if (openSet.has(key)) continue;

    const opposite = r.signal_type === "BUY" ? "SELL" : "BUY";
    if (openSet.has(`${r.symbol}|${r.timeframe}|${opposite}`)) {
      await supabase
        .from("signal_outcomes")
        .update({ status: "CANCELLED", exit_at: nowIso, notes: "opposite signal" })
        .eq("symbol", r.symbol)
        .eq("timeframe", r.timeframe)
        .eq("signal_type", opposite)
        .eq("source", "auto_scan")
        .eq("status", "OPEN");
      openSet.delete(`${r.symbol}|${r.timeframe}|${opposite}`);
    }

    toInsert.push({
      symbol: r.symbol,
      base_asset: r.base_asset,
      timeframe: r.timeframe,
      signal_type: r.signal_type,
      score: r.score,
      price_at_signal: r.price,
      entry_low: r.entry_low,
      entry_high: r.entry_high,
      stop_loss: r.stop_loss,
      target1: r.target1,
      target2: r.target2,
      risk_reward: r.risk_reward,
      signal_at: nowIso,
      candle_close_time: r.candle_close_time,
      status: "OPEN",
      source: "auto_scan",
    });
    openSet.add(key);
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { error, count } = await supabase
      .from("signal_outcomes")
      .upsert(chunk, {
        onConflict: "symbol,timeframe,signal_type,candle_close_time",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) console.error("signal_outcomes insert:", error.message);
    else inserted += count ?? chunk.length;
  }
  return inserted;
}

// ---------------------------------------------------------------------
// Reverse Signal Lab
// ---------------------------------------------------------------------

/** همهٔ signal_outcomes غیر CANCELLED که هنوز mirror ندارند. */
async function backfillReverseOutcomes(supabase: SupabaseClient): Promise<number> {
  let created = 0;
  let offset = 0;

  for (let page = 0; page < REVERSE_MAX_PAGES; page++) {
    const { data: origins, error } = await supabase
      .from("signal_outcomes")
      .select(
        "id, symbol, base_asset, timeframe, signal_type, score, price_at_signal, entry_low, entry_high, stop_loss, target1, signal_at, candle_close_time, source, tracked_by, status",
      )
      .neq("status", "CANCELLED")
      .order("signal_at", { ascending: false })
      .range(offset, offset + REVERSE_PAGE - 1);

    if (error) {
      console.error("reverse backfill load:", error.message);
      break;
    }
    if (!origins?.length) break;

    const ids = origins.map((o) => o.id as string);
    const { data: existing } = await supabase
      .from("reverse_signal_outcomes")
      .select("origin_outcome_id")
      .in("origin_outcome_id", ids);
    const have = new Set((existing ?? []).map((r) => r.origin_outcome_id as string));

    const rows: Record<string, unknown>[] = [];
    for (const o of origins) {
      if (have.has(o.id as string)) continue;
      const mirror = buildReverseOutcomeRow({
        id: o.id as string,
        symbol: o.symbol as string,
        base_asset: o.base_asset as string,
        timeframe: o.timeframe as string,
        signal_type: o.signal_type as "BUY" | "SELL",
        score: Number(o.score),
        price_at_signal: Number(o.price_at_signal),
        entry_low: o.entry_low != null ? Number(o.entry_low) : null,
        entry_high: o.entry_high != null ? Number(o.entry_high) : null,
        stop_loss: Number(o.stop_loss),
        target1: Number(o.target1),
        signal_at: o.signal_at as string,
        candle_close_time: (o.candle_close_time as string) ?? null,
        source: (o.source as string) ?? "auto_scan",
        tracked_by: (o.tracked_by as string) ?? null,
      });
      if (mirror) {
        rows.push(mirror);
      } else {
        console.warn(
          `reverse skip invalid plan: ${o.symbol} ${o.timeframe} ${o.signal_type} entry=${o.price_at_signal} stop=${o.stop_loss} target=${o.target1}`,
        );
      }
    }

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error: upErr } = await supabase
        .from("reverse_signal_outcomes")
        .upsert(chunk, { onConflict: "origin_outcome_id", ignoreDuplicates: true });
      if (upErr) console.error("reverse backfill upsert:", upErr.message);
      else created += chunk.length;
    }

    if (origins.length < REVERSE_PAGE) break;
    offset += REVERSE_PAGE;
  }

  console.log(`reverse backfill created≈${created}`);
  return created;
}

/** originهای CANCELLED → reverse OPEN هم CANCELLED */
async function syncReverseCancellations(supabase: SupabaseClient): Promise<number> {
  let total = 0;
  let offset = 0;

  for (let page = 0; page < REVERSE_MAX_PAGES; page++) {
    const { data: cancelled } = await supabase
      .from("signal_outcomes")
      .select("id")
      .eq("status", "CANCELLED")
      .order("signal_at", { ascending: false })
      .range(offset, offset + REVERSE_PAGE - 1);
    if (!cancelled?.length) break;

    const ids = cancelled.map((c) => c.id as string);
    const { data: updated, error } = await supabase
      .from("reverse_signal_outcomes")
      .update({
        status: "CANCELLED",
        notes: "origin cancelled",
        exit_at: new Date().toISOString(),
      })
      .in("origin_outcome_id", ids)
      .eq("status", "OPEN")
      .select("id");
    if (error) console.error("reverse cancel sync:", error.message);
    else total += updated?.length ?? 0;

    if (cancelled.length < REVERSE_PAGE) break;
    offset += REVERSE_PAGE;
  }
  return total;
}

/** چند صفحه کندل بعد از startTime (برای سیگنال‌های قدیمی). */
async function fetchCandlesAfter(symbol: string, tf: string, startTime: number): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = startTime;
  for (let hop = 0; hop < 5; hop++) {
    const rows = (await fetchJson(
      `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${tf}&startTime=${cursor}&limit=1000`,
    )) as unknown[][];
    if (!rows?.length) break;
    const batch = closedCandles(parseKlines(rows));
    if (!batch.length) break;
    all.push(...batch);
    if (rows.length < 1000) break;
    cursor = batch[batch.length - 1].closeTime + 1;
  }
  return all;
}

/**
 * همهٔ reverseهای OPEN را resolve می‌کند
 * (حتی اگر origin از قبل WIN/LOSS/EXPIRED باشد).
 */
async function evaluateOpenReverseOutcomes(
  supabase: SupabaseClient,
  t0: number,
): Promise<{ checked: number; closed: number }> {
  let checked = 0;
  let closed = 0;

  for (let page = 0; page < REVERSE_MAX_PAGES; page++) {
    if (Date.now() > t0 + EVAL_BUDGET_MS) {
      console.warn("reverse evaluate: time budget reached");
      break;
    }

    // همیشه از اول OPENها (قدیمی‌تر اول) — بعد از update دیگر در OPEN نیستند
    const { data, error } = await supabase
      .from("reverse_signal_outcomes")
      .select(
        "id, symbol, timeframe, signal_type, price_at_signal, stop_loss, target1, signal_at, candle_close_time",
      )
      .eq("status", "OPEN")
      .order("signal_at", { ascending: true })
      .limit(REVERSE_PAGE);

    if (error) throw new Error(`load open reverse outcomes: ${error.message}`);
    const open = (data ?? []) as OutcomeRow[];
    if (!open.length) break;

    checked += open.length;

    const baseTs = (o: OutcomeRow) => Date.parse(o.candle_close_time ?? o.signal_at);
    const groups = new Map<string, OutcomeRow[]>();
    for (const o of open) {
      const key = `${o.symbol}|${o.timeframe}`;
      const list = groups.get(key);
      if (list) list.push(o);
      else groups.set(key, [o]);
    }

    let pageClosed = 0;
    await mapPool(
      [...groups.entries()],
      CONCURRENCY,
      async ([key, outcomes]) => {
        const [symbol, tf] = key.split("|");
        try {
          const start = Math.min(...outcomes.map(baseTs)) + 1;
          const allCandles = await fetchCandlesAfter(symbol, tf, start);

          for (const o of outcomes) {
            const base = baseTs(o);
            const after = allCandles.filter((c) => c.closeTime > base);
            const res = resolveTrade(
              {
                direction: o.signal_type === "BUY" ? "LONG" : "SHORT",
                entry: Number(o.price_at_signal),
                stop: Number(o.stop_loss),
                target: Number(o.target1),
                maxBars: EXPIRY_BARS[tf] ?? 40,
              },
              after,
            );
            if (!res) continue;
            const { error: upErr } = await supabase
              .from("reverse_signal_outcomes")
              .update({
                status: res.status,
                exit_price: res.exitPrice,
                exit_at: new Date(res.exitTime).toISOString(),
                pnl_pct: res.pnlPct,
                pnl_gross_pct: res.grossPnlPct,
                r_multiple: res.rMultiple,
                bars_held: res.barsHeld,
                notes: res.status === "EXPIRED" ? "time expiry" : null,
              })
              .eq("id", o.id)
              .eq("status", "OPEN");
            if (!upErr) {
              closed++;
              pageClosed++;
            }
          }
        } catch (e) {
          console.error(`evaluate reverse ${key}:`, e instanceof Error ? e.message : String(e));
        }
      },
      t0 + EVAL_BUDGET_MS,
    );

    // اگر هیچ‌کدام بسته نشد، ادامه بده باعث حلقه بی‌نهایت می‌شود
    if (pageClosed === 0) {
      console.warn(`reverse evaluate: no progress on page ${page}, remaining OPEN will retry next run`);
      break;
    }
  }

  console.log(`reverse evaluate checked=${checked} closed=${closed}`);
  return { checked, closed };
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const provided = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || !safeEqual(provided, expected)) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const tfParam = url.searchParams.get("tf");
  const timeframes = tfParam ? TIMEFRAMES.filter((tf) => tfParam.split(",").includes(tf)) : TIMEFRAMES;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const t0 = Date.now();
  const nowIso = new Date(t0).toISOString();

  await supabase
    .from("scan_runs")
    .update({ status: "failed", error: "timed out (no heartbeat)", finished_at: nowIso })
    .eq("status", "running")
    .lt("started_at", new Date(t0 - 10 * 60_000).toISOString());

  const { data: run, error: runError } = await supabase
    .from("scan_runs")
    .insert({ status: "running", timeframes })
    .select("id")
    .single();
  if (runError || !run) {
    if (runError?.code === "23505") return json({ ok: false, skipped: "another scan is still running" }, 409);
    return json({ ok: false, error: `cannot create scan_runs row: ${runError?.message}` }, 500);
  }
  const runId = run.id as string;

  try {
    // ---------------- 1. universe ----------------
    const { coins, source } = await buildUniverse(TOP_N);
    if (coins.length === 0) throw new Error("empty universe");

    // ---------------- 2. decide what is due ----------------
    const { data: previous } = await supabase
      .from("scan_results")
      .select("symbol, timeframe, signal_type, signal_since, scanned_at")
      .limit(5000);
    const prev = new Map<string, { signal_type: string; signal_since: string; scanned_at: string }>();
    for (const p of previous ?? []) prev.set(`${p.symbol}|${p.timeframe}`, p);

    const boundaries = new Map(timeframes.map((tf) => [tf, lastBoundary(tf, t0)]));
    const tasks = timeframes.flatMap((tf) =>
      coins
        .map((coin) => ({ coin, tf }))
        .filter(({ coin, tf: f }) => {
          if (force) return true;
          const before = prev.get(`${coin.symbol}|${f}`);
          return !before || Date.parse(before.scanned_at) < boundaries.get(f)! + 5_000;
        }),
    );
    const scannedTfs = [...new Set(tasks.map((t) => t.tf))];

    // ---------------- 3. scan ----------------
    const rows: ScanRow[] = [];
    const errors: string[] = [];
    let failed = 0;
    let notReady = 0;

    const skipped = await mapPool(
      tasks,
      CONCURRENCY,
      async ({ coin, tf }) => {
        try {
          const candles = await fetchClosedCandles(coin.symbol, tf);
          const last = candles[candles.length - 1];
          if (!last || last.closeTime < boundaries.get(tf)! - 1) {
            notReady++;
            return;
          }
          const r: CoreAnalysis | null = analyzeCore(candles, { timeframe: tf });
          if (!r) {
            failed++;
            return;
          }
          const before = prev.get(`${coin.symbol}|${tf}`);
          const p =
            r.signalType === "BUY" || r.signalType === "SELL" || r.signalType === "WAIT" ? r.risk : null;
          rows.push({
            run_id: runId,
            symbol: coin.symbol,
            base_asset: coin.base,
            market_rank: coin.rank,
            timeframe: tf,
            signal_type: r.signalType,
            bias: r.bias,
            score: r.score,
            bull_score: r.bullScore,
            bear_score: r.bearScore,
            regime: r.regime,
            trend: r.trend,
            structure: r.structure,
            risk_level: r.riskLevel,
            price: r.price,
            rsi: num(r.rsi),
            atr_pct: num(r.atrPct),
            rel_volume: num(r.relVolume),
            entry_low: num(p?.entryLow),
            entry_high: num(p?.entryHigh),
            stop_loss: num(p?.stopLoss),
            target1: num(p?.target1),
            target2: num(p?.target2),
            target3: num(p?.target3),
            risk_reward: num(p?.riskReward),
            shortable: null,
            candle_close_time: new Date(r.candleCloseTime).toISOString(),
            signal_since: before && before.signal_type === r.signalType ? before.signal_since : nowIso,
            scanned_at: nowIso,
            _isNew: !before || before.signal_type !== r.signalType,
          });
        } catch (e) {
          failed++;
          if (errors.length < 5) {
            errors.push(`${coin.symbol} ${tf}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      },
      t0 + SCAN_BUDGET_MS,
    );

    if (rows.some((r) => r.signal_type === "SELL" && quoteOf(r.symbol) === "USDT")) {
      const perps = await getFuturesPerps();
      if (perps) {
        for (const r of rows) {
          if (r.signal_type === "SELL" && quoteOf(r.symbol) === "USDT") {
            r.shortable = perps.has(r.symbol);
          }
        }
      }
    }

    const freshActionable = rows.filter(
      (r) =>
        r._isNew === true &&
        (r.signal_type === "BUY" || r.signal_type === "SELL") &&
        r.stop_loss != null &&
        r.target1 != null,
    );
    const toSave = rows.map((r) => {
      const copy = { ...r };
      delete copy._isNew;
      return copy;
    });

    for (let i = 0; i < toSave.length; i += 150) {
      const { error } = await supabase
        .from("scan_results")
        .upsert(toSave.slice(i, i + 150), { onConflict: "symbol,timeframe" });
      if (error) throw new Error(`saving results failed: ${error.message}`);
    }

    // ---------------- 4. Signal Lab ----------------
    let outcomesClosed = 0;
    let outcomesOpened = 0;
    try {
      const ev = await evaluateOpenOutcomes(supabase, t0);
      outcomesClosed = ev.closed;
      const recent = freshActionable.filter(
        (r) => t0 - Date.parse(r.candle_close_time) <= 2 * timeframeMs(r.timeframe),
      );
      outcomesOpened = await registerNewOutcomes(supabase, recent, nowIso);
    } catch (e) {
      console.error("signal lab:", e instanceof Error ? e.message : String(e));
      if (errors.length < 5) errors.push(`signal lab: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ---------------- 4b. Reverse Signal Lab ----------------
    try {
      const bf = await backfillReverseOutcomes(supabase);
      const cn = await syncReverseCancellations(supabase);
      const rev = await evaluateOpenReverseOutcomes(supabase, t0);
      console.log(`reverse lab: backfill=${bf} cancelled=${cn} closed=${rev.closed}/${rev.checked}`);
    } catch (e) {
      console.error("reverse lab:", e instanceof Error ? e.message : String(e));
      if (errors.length < 5) {
        errors.push(`reverse lab: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ---------------- 5. housekeeping ----------------
    if (source === "coingecko-marketcap") {
      const symbolList = coins.map((c) => c.symbol).join(",");
      await supabase.from("scan_results").delete().not("symbol", "in", `(${symbolList})`);
    }
    await supabase.from("scan_results").delete().not("timeframe", "in", `(${TIMEFRAMES.join(",")})`);
    await supabase
      .from("scan_results")
      .delete()
      .lt("scanned_at", new Date(t0 - STALE_ROW_DAYS * 86_400_000).toISOString());
    await supabase
      .from("scan_runs")
      .delete()
      .lt("started_at", new Date(t0 - KEEP_RUNS_DAYS * 86_400_000).toISOString());
    await supabase
      .from("signals")
      .delete()
      .lt("created_at", new Date(t0 - KEEP_SIGNALS_DAYS * 86_400_000).toISOString());

    const count = (type: string) => rows.filter((r) => r.signal_type === type).length;
    const incomplete = skipped > 0 || notReady > 0;
    const status = tasks.length > 0 && rows.length === 0 ? "failed" : incomplete ? "partial" : "ok";
    const note =
      skipped > 0
        ? `time budget reached, ${skipped} tasks skipped`
        : notReady > 0
          ? `${notReady} candles not published yet, will retry`
          : null;

    await supabase
      .from("scan_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        universe_source: source,
        symbols_total: coins.length,
        scanned: rows.length,
        failed,
        buy_count: count("BUY"),
        sell_count: count("SELL"),
        wait_count: count("WAIT"),
        outcomes_opened: outcomesOpened,
        outcomes_closed: outcomesClosed,
        timeframes_scanned: scannedTfs,
        error: errors.length ? errors.join(" | ") : note,
      })
      .eq("id", runId);

    return json({
      ok: status !== "failed",
      status,
      run_id: runId,
      universe: {
        count: coins.length,
        usdt: coins.filter((c) => c.quote === "USDT").length,
        btc: coins.filter((c) => c.quote === "BTC").length,
        source,
      },
      timeframes_scanned: scannedTfs,
      scanned: rows.length,
      failed,
      skipped,
      not_ready: notReady,
      buy: count("BUY"),
      sell: count("SELL"),
      wait: count("WAIT"),
      outcomes_opened: outcomesOpened,
      outcomes_closed: outcomesClosed,
      duration_ms: Date.now() - t0,
      sample_errors: errors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("scan_runs")
      .update({ finished_at: new Date().toISOString(), status: "failed", error: message })
      .eq("id", runId);
    return json({ ok: false, error: message }, 500);
  }
});
