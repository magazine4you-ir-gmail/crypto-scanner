// Power Mix — auto-tune the selection table from closed trade outcomes (PURE).
// For each day class (and dead hours) compares original vs reverse vs none on WIN/LOSS/EXPIRED
// and picks the side with the best net USDT (then total R, then win rate). Does not change thresholds or windows.
import { DAY_CLASSES, selectionFor, type DayClass, type DeadPick, type PowerMixConfig, type SidePick } from './config';
import { dayOf, type MixMode, type MixRow } from './mix';
import type { MixTrade, TradePair } from './tradeCalc';

export interface SideScore {
  pick: SidePick | 'byClass';
  closed: number;
  wins: number;
  losses: number;
  expired: number;
  netUsd: number;
  totalR: number;
  winRate: number; // 0..1 among closed that are WIN or LOSS (expired count in closed but not in WR denom if only W/L — we use wins/closed for simplicity)
}

export interface BucketTune {
  key: DayClass | 'DEAD';
  /** recommended pick for this bucket */
  best: SidePick | DeadPick;
  /** all candidates ranked best → worst */
  ranked: SideScore[];
  /** how many FINAL signals fell in this bucket */
  signals: number;
  /** true when sample is too small to trust */
  weak: boolean;
}

export interface AutoTuneResult {
  selection: PowerMixConfig['selection'];
  buckets: BucketTune[];
  /** overall mix score under the recommended selection (closed only) */
  overall: SideScore;
  mode: MixMode;
  /** signals considered (FINAL only) */
  totalSignals: number;
}

const MIN_CLOSED = 3; // below this the bucket is marked weak; still picks best available
const CLOSED = (t: MixTrade) => t.status === 'WIN' || t.status === 'LOSS' || t.status === 'EXPIRED';

function scoreTrades(trades: MixTrade[], pick: SidePick | 'byClass'): SideScore {
  const closed = trades.filter(CLOSED);
  const wins = closed.filter((t) => t.status === 'WIN').length;
  const losses = closed.filter((t) => t.status === 'LOSS').length;
  const expired = closed.filter((t) => t.status === 'EXPIRED').length;
  const netUsd = closed.reduce((s, t) => s + (t.netUsd ?? 0), 0);
  const totalR = closed.reduce((s, t) => s + (t.r ?? 0), 0);
  const winRate = closed.length ? wins / closed.length : 0;
  return { pick, closed: closed.length, wins, losses, expired, netUsd, totalR, winRate };
}

/** Higher is better. none with 0 closed scores 0 (neutral baseline). */
function better(a: SideScore, b: SideScore): number {
  if (a.netUsd !== b.netUsd) return a.netUsd - b.netUsd;
  if (a.totalR !== b.totalR) return a.totalR - b.totalR;
  if (a.winRate !== b.winRate) return a.winRate - b.winRate;
  // prefer more evidence when tied
  return a.closed - b.closed;
}

function rankPicks(candidates: SideScore[]): SideScore[] {
  return [...candidates].sort((a, b) => better(b, a));
}

function pickBest(ranked: SideScore[]): SideScore {
  // If best has negative expectancy and "none" exists with 0, prefer none when best netUsd < 0
  const best = ranked[0];
  const none = ranked.find((x) => x.pick === 'none');
  if (best && none && best.netUsd < 0 && none.netUsd >= best.netUsd) return none;
  return best;
}

/**
 * Optimise only `cfg.selection` using historical closed trades.
 * Class buckets use non-dead FINAL signals of that class.
 * DEAD bucket uses all FINAL dead-hours signals; `byClass` is scored with the class picks already chosen.
 */
export function autoTuneSelection(
  rows: MixRow[],
  tradesOf: (row: MixRow) => TradePair,
  mode: MixMode,
  baseCfg: PowerMixConfig,
): AutoTuneResult {
  const finalRows = rows.filter((r) => dayOf(r, mode).state === 'FINAL' && dayOf(r, mode).dayClass);

  // ---- per day-class (non-dead) ----
  const classPicks: Record<DayClass, SidePick> = { ...baseCfg.selection } as Record<DayClass, SidePick>;
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
    const ranked = rankPicks([
      scoreTrades(orig, 'original'),
      scoreTrades(rev, 'reverse'),
      scoreTrades([], 'none'), // baseline: take nothing → 0 PnL
    ]);
    // If both sides are negative, none (0) wins via pickBest
    const best = pickBest(ranked);
    const chosen = (best.pick === 'byClass' ? 'none' : best.pick) as SidePick;
    classPicks[c] = chosen;
    buckets.push({
      key: c,
      best: chosen,
      ranked,
      signals: bucketRows.length,
      weak: Math.max(ranked[0]?.closed ?? 0, ranked[1]?.closed ?? 0) < MIN_CLOSED,
    });
  }

  // ---- dead hours ----
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
  const deadRanked = rankPicks([
    scoreTrades(deadOrig, 'original'),
    scoreTrades(deadRev, 'reverse'),
    scoreTrades(deadByClass, 'byClass'),
    scoreTrades([], 'none'),
  ]);
  const deadBest = pickBest(deadRanked);
  const deadPick = deadBest.pick as DeadPick;

  buckets.push({
    key: 'DEAD',
    best: deadPick,
    ranked: deadRanked,
    signals: deadRows.length,
    weak: Math.max(deadRanked[0]?.closed ?? 0, deadRanked[1]?.closed ?? 0) < MIN_CLOSED,
  });

  const selection: PowerMixConfig['selection'] = {
    VERY_STRONG: classPicks.VERY_STRONG,
    STRONG: classPicks.STRONG,
    POWER: classPicks.POWER,
    MIXED: classPicks.MIXED,
    NEUTRAL: classPicks.NEUTRAL,
    DEAD: deadPick,
  };

  // overall under recommended selection
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
    overall: scoreTrades(mixTrades, 'original'), // pick label unused
    mode,
    totalSignals: finalRows.length,
  };
}
