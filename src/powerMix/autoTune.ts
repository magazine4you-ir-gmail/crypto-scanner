// Power Mix — auto-tune selection from closed trades, multi-metric checklist (PURE).
import { DAY_CLASSES, selectionFor, type DayClass, type DeadPick, type PowerMixConfig, type SidePick } from './config';
import { dayOf, type MixMode, type MixRow } from './mix';
import type { MixTrade, TradePair } from './tradeCalc';

/** Metrics aligned with the Power Mix comparison / stats cards. */
export type TuneMetric =
  | 'closed'
  | 'winRate'
  | 'wins'
  | 'losses'
  | 'expired'
  | 'expectancyR'
  | 'profitFactor'
  | 'totalPnl'
  | 'netUsd'
  | 'totalR'
  | 'maxDrawdown'
  | 'noEntry';

/** true = higher is better; false = lower is better */
export const METRIC_HIGHER_BETTER: Record<TuneMetric, boolean> = {
  closed: true,
  winRate: true,
  wins: true,
  losses: false,
  expired: false,
  expectancyR: true,
  profitFactor: true,
  totalPnl: true,
  netUsd: true,
  totalR: true,
  maxDrawdown: false,
  noEntry: false,
};

export const ALL_TUNE_METRICS: TuneMetric[] = [
  'closed',
  'winRate',
  'wins',
  'losses',
  'expired',
  'expectancyR',
  'profitFactor',
  'totalPnl',
  'netUsd',
  'totalR',
  'maxDrawdown',
  'noEntry',
];

/** Sensible default: money + R + win rate + drawdown (not raw counts alone). */
export const DEFAULT_TUNE_METRICS: TuneMetric[] = [
  'netUsd',
  'totalR',
  'expectancyR',
  'winRate',
  'profitFactor',
  'maxDrawdown',
];

export interface SideScore {
  pick: SidePick | 'byClass';
  closed: number;
  wins: number;
  losses: number;
  expired: number;
  open: number;
  noEntry: number;
  winRate: number; // 0..100 among WIN+LOSS
  expectancyR: number;
  profitFactor: number;
  totalPnl: number;
  netUsd: number;
  totalR: number;
  maxDrawdown: number;
  /** composite rank-sum under the active metric set (lower = better) */
  rankSum: number;
}

export interface BucketTune {
  key: DayClass | 'DEAD';
  best: SidePick | DeadPick;
  ranked: SideScore[];
  signals: number;
  weak: boolean;
}

export interface AutoTuneResult {
  selection: PowerMixConfig['selection'];
  buckets: BucketTune[];
  overall: SideScore;
  mode: MixMode;
  totalSignals: number;
  metricsUsed: TuneMetric[];
}

const MIN_CLOSED = 3;
const isClosed = (t: MixTrade) => t.status === 'WIN' || t.status === 'LOSS' || t.status === 'EXPIRED';

function scoreTrades(trades: MixTrade[], pick: SidePick | 'byClass'): SideScore {
  const closed = trades.filter(isClosed).sort((a, b) => a.atMs - b.atMs);
  const wins = closed.filter((t) => t.status === 'WIN');
  const losses = closed.filter((t) => t.status === 'LOSS');
  const expired = closed.filter((t) => t.status === 'EXPIRED');
  const decided = wins.length + losses.length;
  const winRate = decided > 0 ? (wins.length / decided) * 100 : 0;

  const pnlPct = (t: MixTrade) => t.pnlPct ?? 0;
  const rOf = (t: MixTrade) => t.r ?? 0;
  const totalPnl = closed.reduce((s, t) => s + pnlPct(t), 0);
  const totalR = closed.reduce((s, t) => s + rOf(t), 0);
  const expectancyR = closed.length ? totalR / closed.length : 0;
  const grossWin = closed.reduce((s, t) => s + Math.max(0, pnlPct(t)), 0);
  const grossLoss = Math.abs(closed.reduce((s, t) => s + Math.min(0, pnlPct(t)), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  const usd = closed.map((t) => t.netUsd).filter((v): v is number => v !== null);
  const netUsd = usd.reduce((s, v) => s + v, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const t of closed) {
    eq += t.netUsd ?? 0;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }

  return {
    pick,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    expired: expired.length,
    open: trades.filter((t) => t.status === 'OPEN').length,
    noEntry: trades.filter((t) => t.status === 'NO_ENTRY').length,
    winRate,
    expectancyR,
    profitFactor,
    totalPnl,
    netUsd,
    totalR,
    maxDrawdown: dd,
    rankSum: 0,
  };
}

function metricValue(s: SideScore, m: TuneMetric): number {
  switch (m) {
    case 'closed': return s.closed;
    case 'winRate': return s.winRate;
    case 'wins': return s.wins;
    case 'losses': return s.losses;
    case 'expired': return s.expired;
    case 'expectancyR': return s.expectancyR;
    case 'profitFactor': return s.profitFactor === Infinity ? 999 : s.profitFactor;
    case 'totalPnl': return s.totalPnl;
    case 'netUsd': return s.netUsd;
    case 'totalR': return s.totalR;
    case 'maxDrawdown': return s.maxDrawdown;
    case 'noEntry': return s.noEntry;
  }
}

/**
 * Rank-sum scoring: for each selected metric, rank candidates (0 = best).
 * Lower rankSum wins. Ties broken by netUsd then totalR.
 */
function rankCandidates(candidates: SideScore[], metrics: TuneMetric[]): SideScore[] {
  const metricsUse = metrics.length ? metrics : DEFAULT_TUNE_METRICS;
  const n = candidates.length;
  const rankSum = new Array(n).fill(0);

  for (const m of metricsUse) {
    const higher = METRIC_HIGHER_BETTER[m];
    const vals = candidates.map((c) => metricValue(c, m));
    // rank: best gets 0, worst gets n-1 (stable on ties: average rank not needed — same rank ok)
    const order = vals
      .map((v, i) => ({ v, i }))
      .sort((a, b) => (higher ? b.v - a.v : a.v - b.v));
    order.forEach((o, place) => {
      rankSum[o.i] += place;
    });
  }

  const scored = candidates.map((c, i) => ({ ...c, rankSum: rankSum[i] }));
  scored.sort((a, b) => {
    if (a.rankSum !== b.rankSum) return a.rankSum - b.rankSum;
    if (a.netUsd !== b.netUsd) return b.netUsd - a.netUsd;
    return b.totalR - a.totalR;
  });
  return scored;
}

function pickBest(ranked: SideScore[]): SideScore {
  const best = ranked[0];
  const none = ranked.find((x) => x.pick === 'none');
  // If the winner is still clearly losing money and "none" is available, prefer sitting out
  if (best && none && best.pick !== 'none' && best.netUsd < 0 && best.expectancyR < 0) {
    return none;
  }
  return best;
}

export function autoTuneSelection(
  rows: MixRow[],
  tradesOf: (row: MixRow) => TradePair,
  mode: MixMode,
  baseCfg: PowerMixConfig,
  metrics: TuneMetric[] = DEFAULT_TUNE_METRICS,
): AutoTuneResult {
  const metricsUse = metrics.length ? metrics : DEFAULT_TUNE_METRICS;
  const finalRows = rows.filter((r) => {
    const d = dayOf(r, mode);
    return d.state === 'FINAL' && d.dayClass;
  });

  const classPicks = { ...baseCfg.selection } as Record<DayClass, SidePick>;
  const buckets: BucketTune[] = [];

  for (const c of DAY_CLASSES) {
    const bucketRows = finalRows.filter((r) => {
      const d = dayOf(r, mode);
      return !d.deadHours && d.dayClass === c;
    });
    const orig: MixTrade[] = [];
    const rev: MixTrade[] = [];
    for (const r of bucketRows) {
      const tp = tradesOf(r);
      orig.push(tp.original);
      rev.push(tp.reverse);
    }
    const ranked = rankCandidates(
      [scoreTrades(orig, 'original'), scoreTrades(rev, 'reverse'), scoreTrades([], 'none')],
      metricsUse,
    );
    const best = pickBest(ranked);
    const chosen = (best.pick === 'byClass' ? 'none' : best.pick) as SidePick;
    classPicks[c] = chosen;
    buckets.push({
      key: c,
      best: chosen,
      ranked,
      signals: bucketRows.length,
      weak: Math.max(ranked.find((x) => x.pick === 'original')?.closed ?? 0, ranked.find((x) => x.pick === 'reverse')?.closed ?? 0) < MIN_CLOSED,
    });
  }

  const deadRows = finalRows.filter((r) => dayOf(r, mode).deadHours);
  const deadOrig: MixTrade[] = [];
  const deadRev: MixTrade[] = [];
  const deadByClass: MixTrade[] = [];
  for (const r of deadRows) {
    const tp = tradesOf(r);
    deadOrig.push(tp.original);
    deadRev.push(tp.reverse);
    const d = dayOf(r, mode);
    const p = d.dayClass ? classPicks[d.dayClass] : 'none';
    if (p === 'original') deadByClass.push(tp.original);
    else if (p === 'reverse') deadByClass.push(tp.reverse);
  }
  const deadRanked = rankCandidates(
    [
      scoreTrades(deadOrig, 'original'),
      scoreTrades(deadRev, 'reverse'),
      scoreTrades(deadByClass, 'byClass'),
      scoreTrades([], 'none'),
    ],
    metricsUse,
  );
  const deadBest = pickBest(deadRanked);
  const deadPick = deadBest.pick as DeadPick;

  buckets.push({
    key: 'DEAD',
    best: deadPick,
    ranked: deadRanked,
    signals: deadRows.length,
    weak: Math.max(deadRanked.find((x) => x.pick === 'original')?.closed ?? 0, deadRanked.find((x) => x.pick === 'reverse')?.closed ?? 0) < MIN_CLOSED,
  });

  const selection: PowerMixConfig['selection'] = {
    VERY_STRONG: classPicks.VERY_STRONG,
    STRONG: classPicks.STRONG,
    POWER: classPicks.POWER,
    MIXED: classPicks.MIXED,
    NEUTRAL: classPicks.NEUTRAL,
    DEAD: deadPick,
  };

  const mixTrades: MixTrade[] = [];
  for (const r of finalRows) {
    const d = dayOf(r, mode);
    if (!d.dayClass) continue;
    const p = selectionFor({ ...baseCfg, selection }, d.dayClass, d.deadHours);
    const tp = tradesOf(r);
    if (p === 'original') mixTrades.push(tp.original);
    else if (p === 'reverse') mixTrades.push(tp.reverse);
  }

  return {
    selection,
    buckets,
    overall: scoreTrades(mixTrades, 'original'),
    mode,
    totalSignals: finalRows.length,
    metricsUsed: metricsUse,
  };
}
