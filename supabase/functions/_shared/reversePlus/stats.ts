// Reverse Signal Plus — independent performance statistics.
// Never merged with Signal Lab / Reverse Signal Lab statistics. PAPER and ACTUAL are always computed separately
// (the caller passes rows of ONE mode). Money sums use Dec; ratios are plain numbers for display.
import { ZERO, abs, add, div, max, sub, sum, toNumber } from './money.ts';
import type { Dec } from './money.ts';

export type TradeOutcome = 'WIN' | 'LOSS' | 'EXPIRED' | 'BREAKEVEN' | 'OPEN' | 'PENDING' | 'NO_FILL' | 'CANCELLED';

export interface StatRow {
  outcome: TradeOutcome;
  netPnl: Dec | null;
  finalR: number | null;
  timeframe: string;
  qualityScore: number | null;
  closedAt: string | null;
}

export interface Bucket {
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  netPnl: Dec;
  /** fewer than MIN_SAMPLE trades: the figures are NOT statistically meaningful */
  lowSample: boolean;
}

export const MIN_SAMPLE = 30;
const CLOSED: TradeOutcome[] = ['WIN', 'LOSS', 'EXPIRED', 'BREAKEVEN'];

export interface PlusStats extends Bucket {
  noFill: number;
  open: number;
  profitFactor: number;
  avgWin: Dec;
  avgLoss: Dec;
  maxDrawdown: Dec;
  byTimeframe: Record<string, Bucket>;
  byScoreBucket: Record<string, Bucket>;
}

export function scoreBucketOf(score: number | null): string {
  if (score === null) return 'N/A';
  return score >= 80 ? '80-100' : score >= 65 ? '65-79' : score >= 50 ? '50-64' : '<50';
}

function bucketOf(rows: StatRow[]): Bucket {
  // same convention as Signal Lab: win rate = WIN / (WIN + LOSS); EXPIRED / BREAKEVEN are neither
  const wins = rows.filter((r) => r.outcome === 'WIN').length;
  const losses = rows.filter((r) => r.outcome === 'LOSS').length;
  const rs = rows.map((r) => r.finalR).filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    n: rows.length,
    wins,
    losses,
    winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
    expectancyR: rs.length ? rs.reduce((s, v) => s + v, 0) / rs.length : 0,
    netPnl: sum(rows.map((r) => r.netPnl ?? ZERO)),
    lowSample: rows.length < MIN_SAMPLE,
  };
}

export function computePlusStats(rows: StatRow[]): PlusStats {
  const closed = rows
    .filter((r) => CLOSED.includes(r.outcome))
    .sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''));
  const base = bucketOf(closed);
  const pnl = (r: StatRow): Dec => r.netPnl ?? ZERO;
  const winsPnl = closed.map(pnl).filter((v) => v > ZERO);
  const lossPnl = closed.map(pnl).filter((v) => v < ZERO);
  const grossWin = sum(winsPnl);
  const grossLoss = abs(sum(lossPnl));
  const profitFactor = grossLoss > ZERO ? toNumber(div(grossWin, grossLoss)) : grossWin > ZERO ? Infinity : 0;

  let equity: Dec = ZERO;
  let peak: Dec = ZERO;
  let maxDd: Dec = ZERO;
  for (const r of closed) {
    equity = add(equity, pnl(r));
    peak = max(peak, equity);
    maxDd = max(maxDd, sub(peak, equity));
  }

  const group = (keyOf: (r: StatRow) => string): Record<string, Bucket> => {
    const m = new Map<string, StatRow[]>();
    for (const r of closed) {
      const k = keyOf(r);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return Object.fromEntries([...m.entries()].map(([k, v]) => [k, bucketOf(v)]));
  };

  return {
    ...base,
    noFill: rows.filter((r) => r.outcome === 'NO_FILL').length,
    open: rows.filter((r) => r.outcome === 'OPEN' || r.outcome === 'PENDING').length,
    profitFactor,
    avgWin: winsPnl.length ? div(grossWin, BigInt(winsPnl.length) * 10n ** 18n) : ZERO,
    avgLoss: lossPnl.length ? div(grossLoss, BigInt(lossPnl.length) * 10n ** 18n) : ZERO,
    maxDrawdown: maxDd,
    byTimeframe: group((r) => r.timeframe),
    byScoreBucket: group((r) => scoreBucketOf(r.qualityScore)),
  };
}

// ---------------------------------------------------------------------------------------------
// Three-way comparison on the SAME signals (never merges the underlying statistics).
// ---------------------------------------------------------------------------------------------
export interface ModePair {
  originId: string;
  originalStatus: string;
  originalR: number | null;
  reverseStatus: string;
  reverseR: number | null;
  /** Reverse Signal Plus (one mode, chosen by the caller) */
  plusOutcome: TradeOutcome | null;
  plusR: number | null;
}

export interface ModeSummary {
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
}

const isClosed = (s: string | null) => s === 'WIN' || s === 'LOSS' || s === 'EXPIRED';

function summarize(rs: { status: string; r: number | null }[]): ModeSummary {
  const wins = rs.filter((x) => x.status === 'WIN').length;
  const losses = rs.filter((x) => x.status === 'LOSS').length;
  const vals = rs.map((x) => x.r ?? 0);
  const total = vals.reduce((s, v) => s + v, 0);
  return {
    n: rs.length,
    wins,
    losses,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
    expectancyR: rs.length ? total / rs.length : 0,
    totalR: total,
  };
}

/** Compares the three systems on the signals where Plus actually traded and all three results are closed. */
export function compareModes(pairs: ModePair[]): { original: ModeSummary; reverse: ModeSummary; plus: ModeSummary; common: number } {
  const common = pairs.filter(
    (p) => isClosed(p.originalStatus) && isClosed(p.reverseStatus) && p.plusOutcome !== null && isClosed(p.plusOutcome === 'BREAKEVEN' ? 'EXPIRED' : p.plusOutcome),
  );
  return {
    common: common.length,
    original: summarize(common.map((p) => ({ status: p.originalStatus, r: p.originalR }))),
    reverse: summarize(common.map((p) => ({ status: p.reverseStatus, r: p.reverseR }))),
    plus: summarize(common.map((p) => ({ status: p.plusOutcome as string, r: p.plusR }))),
  };
}

/** PAPER and ACTUAL trades are always separated before any statistic is computed. */
export function partitionByMode<T extends { mode: 'PAPER' | 'ACTUAL' }>(rows: T[]): { paper: T[]; actual: T[] } {
  return { paper: rows.filter((r) => r.mode === 'PAPER'), actual: rows.filter((r) => r.mode === 'ACTUAL') };
}
