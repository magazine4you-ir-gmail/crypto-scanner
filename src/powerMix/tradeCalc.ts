// Power Mix — ONE trade model for both sides of a pair, so cards, statistics and the history all speak the same language.
//
//   * REVERSE side  -> computed the Reverse Plus way: the central historical backtest of the signal (limit entry at the recommended
//                      entry, stop / target of the reverse trade, real closed candles, no hindsight) run through the user's LOCAL scenario
//                      (leverage + sizing + amount, the same values as the Reverse Plus pages) and the public fee / slippage assumptions.
//                      A reverse signal without a stored backtest falls back to its Reverse Lab result (flagged source = 'LAB').
//   * ORIGINAL side -> its own Signal Lab result (net % and R, fees already included), expressed in USDT with the SAME scenario.
//
// Pure: no network, no storage. NOTHING here touches how signals are generated or resolved.
import type { SignalOutcome } from '@/services/outcomeService';
import { computeStats, type OutcomeStats } from '@/services/outcomeService';
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import type { PlusBacktest, PlusPublicConfig } from '@/services/reversePlusService';
import { scenarioParams } from '@/reversePlus/summary';
import { rowToResult } from '@/reversePlus/backtestRows';
import type { ScenarioPrefs } from '@/reversePlus/scenarioPrefs';
import { applyScenarioToBacktest, buildScenario, toNumber } from '../../supabase/functions/_shared/reversePlus/index';
import type { MixPair } from './mix';

export type Side = 'original' | 'reverse';
/** NO_ENTRY = the limit entry was never reached (no trade). UNKNOWN = not enough data to decide (no trade). */
export type TradeStatus = 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED' | 'NO_ENTRY' | 'UNKNOWN';

type CostCfg = Pick<PlusPublicConfig, 'fee_pct' | 'slippage_pct' | 'assumed_mmr_pct' | 'liq_safety_factor'>;

export interface TradeCtx {
  cfg: CostCfg;
  prefs: ScenarioPrefs;
  /** central backtests by reverse outcome id */
  backtests: ReadonlyMap<string, PlusBacktest>;
}

export interface MixTrade {
  side: Side;
  /** the lab row this trade belongs to (display fields: symbol, timeframe, score, stop, target ...) */
  outcome: SignalOutcome;
  status: TradeStatus;
  /** net result as % of the position value (fees + slippage included); null while nothing is decided */
  pnlPct: number | null;
  /** net result in R (1R = the risk at the stop) */
  r: number | null;
  /** net result in USDT for the local scenario */
  netUsd: number | null;
  /** net result as % of the margin (what the leverage multiplies) */
  roiPct: number | null;
  entry: number | null;
  exit: number | null;
  liquidated: boolean;
  /** PLUS = computed from the Reverse Plus backtest · LAB = the lab's own recorded result */
  source: 'PLUS' | 'LAB';
  /** when it closed (falls back to the signal time) */
  atMs: number;
  /** copy of the row with the status / pnl / R of THIS model, so `computeStats` can be reused unchanged */
  stat: SignalOutcome;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const timeOf = (o: SignalOutcome) => Date.parse(o.candle_close_time ?? o.signal_at);

function money(side: Side, o: SignalOutcome, pnlPct: number | null, r: number | null, ctx: TradeCtx): { netUsd: number | null; roiPct: number | null } {
  const entry = num(o.price_at_signal);
  if (entry === null || entry <= 0 || (pnlPct === null && r === null)) return { netUsd: null, roiPct: null };
  const sc = buildScenario(scenarioParams(o as unknown as ReverseOutcome, entry, ctx.cfg, ctx.prefs));
  if (sc.issues.includes('BAD_GEOMETRY') || sc.issues.includes('BAD_SIZE')) return { netUsd: null, roiPct: null };
  const margin = toNumber(sc.margin);
  const usd = ctx.prefs.sizing === 'FIXED_RISK'
    ? (r === null ? null : r * toNumber(sc.riskAmount))
    : (pnlPct === null ? null : (pnlPct / 100) * toNumber(sc.notional));
  void side;
  return { netUsd: usd, roiPct: usd !== null && margin > 0 ? (usd / margin) * 100 : null };
}

function finish(t: Omit<MixTrade, 'stat'>): MixTrade {
  const hidden = t.status === 'NO_ENTRY' || t.status === 'UNKNOWN';
  const stat = { ...t.outcome, status: hidden ? 'CANCELLED' : t.status, pnl_pct: t.pnlPct, r_multiple: t.r } as SignalOutcome;
  return { ...t, stat };
}

/** The lab's own recorded result (original side, or a reverse signal without a stored backtest). */
export function labTrade(side: Side, o: SignalOutcome, ctx: TradeCtx): MixTrade {
  const status: TradeStatus = o.status === 'OPEN' || o.status === 'WIN' || o.status === 'LOSS' || o.status === 'EXPIRED' ? o.status : 'UNKNOWN';
  const closed = status === 'WIN' || status === 'LOSS' || status === 'EXPIRED';
  const pnlPct = closed ? num(o.pnl_pct) : null;
  const r = closed ? num(o.r_multiple) : null;
  const { netUsd, roiPct } = money(side, o, pnlPct, r, ctx);
  return finish({
    side, outcome: o, status, pnlPct, r, netUsd, roiPct,
    entry: num(o.price_at_signal), exit: num(o.exit_price), liquidated: false, source: 'LAB',
    atMs: o.exit_at ? Date.parse(o.exit_at) : timeOf(o),
  });
}

/** Reverse signal through the Reverse Plus backtest + the local scenario. */
export function reversePlusTrade(rev: ReverseOutcome, bt: PlusBacktest | null | undefined, ctx: TradeCtx): MixTrade {
  if (!bt) return labTrade('reverse', rev, ctx);
  const res = rowToResult(bt);
  const entryLevel = num(bt.entry_level) ?? num(rev.price_at_signal) ?? 0;
  const m = applyScenarioToBacktest(res, scenarioParams(rev, entryLevel, ctx.cfg, ctx.prefs));

  let status: TradeStatus;
  switch (res.outcome) {
    case 'WIN': status = 'WIN'; break;
    case 'LOSS': status = 'LOSS'; break;
    case 'BREAKEVEN': case 'EXPIRED': status = 'EXPIRED'; break;
    case 'NO_ENTRY': status = 'NO_ENTRY'; break;
    default: status = rev.status === 'OPEN' ? 'OPEN' : 'UNKNOWN'; // AMBIGUOUS / UNKNOWN: never guessed
  }
  const decided = status === 'WIN' || status === 'LOSS';
  const netUsd = decided && m.netPnl !== null ? toNumber(m.netPnl) : null;
  const notional = toNumber(m.notional);
  return finish({
    side: 'reverse', outcome: rev, status,
    pnlPct: netUsd !== null && notional > 0 ? (netUsd / notional) * 100 : null,
    r: decided && m.rMultiple !== null ? toNumber(m.rMultiple) : null,
    netUsd,
    roiPct: decided && m.roiPct !== null ? toNumber(m.roiPct) : null,
    entry: res.entryPrice !== null ? toNumber(res.entryPrice) : entryLevel,
    exit: res.exitPrice !== null ? toNumber(res.exitPrice) : null,
    liquidated: m.liquidated, source: 'PLUS',
    atMs: res.exitTime ?? timeOf(rev),
  });
}

export interface TradePair { original: MixTrade; reverse: MixTrade }
export type TradeBook = ReadonlyMap<string, TradePair>;

/** One lookup per pair (keyed by the reverse outcome id = MixRow.id). */
export function buildTradeBook(pairs: MixPair[], ctx: TradeCtx): Map<string, TradePair> {
  const book = new Map<string, TradePair>();
  for (const p of pairs) {
    book.set(p.reverse.id, { original: labTrade('original', p.original, ctx), reverse: reversePlusTrade(p.reverse, ctx.backtests.get(p.reverse.id), ctx) });
  }
  return book;
}

export interface MixStats extends OutcomeStats {
  /** sum of the net USDT results of closed trades */
  netUsd: number;
  /** worst peak-to-trough of the cumulative USDT curve (closed trades in close order) */
  maxDrawdownUsd: number;
  bestUsd: number | null;
  worstUsd: number | null;
  totalR: number;
  avgRoiPct: number;
  /** limit entry never reached / undecidable: not traded, not counted anywhere else */
  noEntry: number;
  unknown: number;
  liquidations: number;
}

export function computeMixStats(trades: MixTrade[]): MixStats {
  const base = computeStats(trades.map((t) => t.stat));
  const closed = trades.filter((t) => t.status === 'WIN' || t.status === 'LOSS' || t.status === 'EXPIRED').sort((a, b) => a.atMs - b.atMs);
  const usd = closed.map((t) => t.netUsd).filter((v): v is number => v !== null);
  let eq = 0, peak = 0, dd = 0;
  for (const t of closed) {
    eq += t.netUsd ?? 0;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const rois = closed.map((t) => t.roiPct).filter((v): v is number => v !== null);
  return {
    ...base,
    netUsd: usd.reduce((s, v) => s + v, 0),
    maxDrawdownUsd: dd,
    bestUsd: usd.length ? Math.max(...usd) : null,
    worstUsd: usd.length ? Math.min(...usd) : null,
    totalR: closed.reduce((s, t) => s + (t.r ?? 0), 0),
    avgRoiPct: rois.length ? rois.reduce((s, v) => s + v, 0) / rois.length : 0,
    noEntry: trades.filter((t) => t.status === 'NO_ENTRY').length,
    unknown: trades.filter((t) => t.status === 'UNKNOWN').length,
    liquidations: closed.filter((t) => t.liquidated).length,
  };
}
