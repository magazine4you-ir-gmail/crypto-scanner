// Reverse Signal Plus — entry-zone analysis.
//
// The ENTRY ZONE, the reverse STOP and the reverse TAKE-PROFIT are INPUTS and are never modified.
// This module only evaluates candidate entry prices that lie INSIDE the existing zone, computes their
// risk/reward (gross and net of fees + slippage) and classifies the entry status.
//
// RR basis: every RR produced here is computed on a RECOMMENDED (planned) entry price, never on an
// actual fill. Actual R of executed trades is computed separately from real / simulated fills.
import { D, ZERO, ONE, abs, add, cmp, div, fraction, mul, sub, pctOf, ratioPct } from './money.ts';
import type { Dec } from './money.ts';
import type { CostConfig, EntryStatus, RrGrade, Side } from './types.ts';

export type EntryReason =
  | 'NO_ZONE_USING_REF'
  | 'GEOMETRY_INVALID'
  | 'NO_VALID_ENTRY'
  | 'RR_BELOW_MIN'
  | 'RR_WARNING'
  | 'SIGNAL_EXPIRED'
  | 'STOP_TOUCHED'
  | 'TARGET_TOUCHED'
  | 'PRICE_PASSED_ZONE';

export interface UnitEconomics {
  riskDistance: Dec;
  rewardDistance: Dec;
  /** Loss per 1 unit if the stop is hit, INCLUDING entry+exit fees and entry+stop slippage. */
  netRiskPerUnit: Dec;
  /** Profit per 1 unit if the target is hit, AFTER entry+exit fees and entry slippage. */
  netRewardPerUnit: Dec;
  rrGross: Dec;
  rrNet: Dec;
}

export function geometryOk(side: Side, entry: Dec, stop: Dec, target: Dec): boolean {
  return side === 'SELL' ? target < entry && entry < stop : stop < entry && entry < target;
}

/**
 * Per-unit economics of a trade. Cost model (documented in README):
 *   risk   = |entry - stop|   + entry*(fee+slip) + stop*(fee+slip)
 *   reward = |target - entry| - entry*(fee+slip) - target*fee            (limit take-profit: no slippage)
 */
export function unitEconomics(entry: Dec, stop: Dec, target: Dec, cost: CostConfig): UnitEconomics {
  const f = fraction(cost.feePct);
  const s = fraction(cost.slippagePct);
  const fs = add(f, s);
  const riskDistance = abs(sub(entry, stop));
  const rewardDistance = abs(sub(target, entry));
  const netRiskPerUnit = add(riskDistance, add(mul(entry, fs), mul(stop, fs)));
  const netRewardPerUnit = sub(sub(rewardDistance, mul(entry, fs)), mul(target, f));
  const rrGross = riskDistance > ZERO ? div(rewardDistance, riskDistance) : ZERO;
  const rrNet = netRiskPerUnit > ZERO && netRewardPerUnit > ZERO ? div(netRewardPerUnit, netRiskPerUnit) : ZERO;
  return { riskDistance, rewardDistance, netRiskPerUnit, netRewardPerUnit, rrGross, rrNet };
}

export function gradeRr(rrNet: Dec, minRr: Dec): RrGrade {
  if (cmp(rrNet, minRr) < 0) return 'BELOW_MIN';
  return cmp(rrNet, ONE) < 0 ? 'REVIEW' : 'FAVORABLE';
}

export interface Candidate extends UnitEconomics {
  price: Dec;
  valid: boolean;
  grade: RrGrade;
}

export interface EntryZoneInput {
  side: Side;
  /** Existing entry zone (read-only). null when the stored row has no zone. */
  zoneLow: Dec | null;
  zoneHigh: Dec | null;
  /** Entry of the existing reverse signal (close of the signal candle). */
  refEntry: Dec;
  /** Existing reverse stop / take-profit (read-only). */
  stop: Dec;
  target: Dec;
  currentPrice: Dec;
  cost: CostConfig;
  minRr: Dec;
  approachPct: Dec;
  ageBars: number;
  expiryBars: number;
  /** Closed candles since the signal touched the reverse stop / target. */
  stopTouched?: boolean;
  targetTouched?: boolean;
  samples?: number;
  /** Beyond the zone edge by more than this % of price = "passed" (no chasing). */
  chaseTolerancePct?: Dec;
}

export interface EntryZoneResult {
  zoneLow: Dec | null;
  zoneHigh: Dec | null;
  recommendedEntry: Dec | null;
  /** Min/max price of the candidates that satisfy the minimum RR. */
  entryRangeLow: Dec | null;
  entryRangeHigh: Dec | null;
  distanceToEntry: Dec | null;
  distanceToEntryPct: Dec | null;
  riskDistance: Dec | null;
  rewardDistance: Dec | null;
  rrGross: Dec | null;
  rrNet: Dec | null;
  rrGrade: RrGrade | null;
  rrBasis: 'RECOMMENDED_ENTRY';
  status: EntryStatus;
  reasons: EntryReason[];
  candidates: Candidate[];
}

/** Evenly spaced prices from low to high inclusive (exact decimal arithmetic). */
export function zoneGrid(low: Dec, high: Dec, samples: number): Dec[] {
  if (high <= low || samples < 2) return [low];
  const out: Dec[] = [];
  const span = sub(high, low);
  for (let i = 0; i < samples; i++) {
    out.push(i === samples - 1 ? high : add(low, div(mul(span, D(i)), D(samples - 1))));
  }
  return out;
}

export function analyzeEntryZone(input: EntryZoneInput): EntryZoneResult {
  const { side, stop, target, currentPrice, cost, minRr } = input;
  const reasons: EntryReason[] = [];
  const tol = input.chaseTolerancePct ?? D('0.2');

  const emptyResult = (status: EntryStatus, why: EntryReason[]): EntryZoneResult => ({
    zoneLow: input.zoneLow,
    zoneHigh: input.zoneHigh,
    recommendedEntry: null,
    entryRangeLow: null,
    entryRangeHigh: null,
    distanceToEntry: null,
    distanceToEntryPct: null,
    riskDistance: null,
    rewardDistance: null,
    rrGross: null,
    rrNet: null,
    rrGrade: null,
    rrBasis: 'RECOMMENDED_ENTRY',
    status,
    reasons: [...reasons, ...why],
    candidates: [],
  });

  // --- candidate prices: ONLY inside the existing zone ---------------------------------------
  let prices: Dec[];
  let zoneLow = input.zoneLow;
  let zoneHigh = input.zoneHigh;
  if (zoneLow === null || zoneHigh === null || zoneLow > zoneHigh) {
    reasons.push('NO_ZONE_USING_REF');
    prices = [input.refEntry];
    zoneLow = input.refEntry;
    zoneHigh = input.refEntry;
  } else {
    prices = zoneGrid(zoneLow, zoneHigh, input.samples ?? 13);
  }

  const candidates: Candidate[] = prices
    .filter((p) => geometryOk(side, p, stop, target))
    .map((p) => {
      const e = unitEconomics(p, stop, target, cost);
      const grade = gradeRr(e.rrNet, minRr);
      return { price: p, ...e, valid: grade !== 'BELOW_MIN', grade };
    });

  // Nothing usable inside the zone: the signal is still listed (informational reason only, no entry suggestion).
  if (candidates.length === 0) return emptyResult('WAITING', ['GEOMETRY_INVALID']);

  // --- terminal states that do not depend on the candidate quality ---------------------------
  const expired = input.ageBars >= input.expiryBars;

  const valid = candidates.filter((c) => c.valid);
  const pool = valid.length ? valid : candidates;
  // best net RR; tie -> the price closest to the current price (easier to get filled)
  const best = pool.reduce((a, b) => {
    const c = cmp(b.rrNet, a.rrNet);
    if (c > 0) return b;
    if (c < 0) return a;
    return cmp(abs(sub(b.price, currentPrice)), abs(sub(a.price, currentPrice))) < 0 ? b : a;
  });

  const rec = best.price;
  const distance = abs(sub(rec, currentPrice));
  const base = {
    zoneLow,
    zoneHigh,
    recommendedEntry: rec,
    entryRangeLow: valid.length ? valid.reduce((a, b) => (b.price < a.price ? b : a)).price : null,
    entryRangeHigh: valid.length ? valid.reduce((a, b) => (b.price > a.price ? b : a)).price : null,
    distanceToEntry: distance,
    distanceToEntryPct: ratioPct(distance, currentPrice),
    riskDistance: best.riskDistance,
    rewardDistance: best.rewardDistance,
    rrGross: best.rrGross,
    rrNet: best.rrNet,
    rrGrade: best.grade,
    rrBasis: 'RECOMMENDED_ENTRY' as const,
    candidates,
  };

  const done = (status: EntryStatus, why: EntryReason[]): EntryZoneResult => ({
    ...base,
    status,
    reasons: [...reasons, ...why],
  });

  if (input.stopTouched) return done('EXPIRED', ['STOP_TOUCHED']);
  if (input.targetTouched) return done('EXPIRED', ['TARGET_TOUCHED']);
  if (expired) return done('EXPIRED', ['SIGNAL_EXPIRED']);
  // A low RR never rejects the signal: it is reported as an informational reason and the timing status goes on as usual.
  const rrNotes: EntryReason[] = valid.length ? [] : ['RR_BELOW_MIN'];

  // --- price position vs the zone (fills happen when the market moves TOWARDS the limit) -------
  const tolAbs = pctOf(currentPrice, tol);
  const passed =
    side === 'SELL' ? currentPrice > add(zoneHigh, tolAbs) : currentPrice < sub(zoneLow, tolAbs);
  if (passed) return done('EXPIRED', ['PRICE_PASSED_ZONE']);

  const stopHit = side === 'SELL' ? currentPrice >= stop : currentPrice <= stop;
  if (stopHit) return done('EXPIRED', ['STOP_TOUCHED']);
  const targetHit = side === 'SELL' ? currentPrice <= target : currentPrice >= target;
  if (targetHit) return done('EXPIRED', ['TARGET_TOUCHED']);

  const why: EntryReason[] = [...rrNotes, ...(best.grade === 'REVIEW' ? (['RR_WARNING'] as EntryReason[]) : [])];
  const reached = side === 'SELL' ? currentPrice >= rec : currentPrice <= rec;
  if (reached) return done('READY', why);
  if (cmp(ratioPct(distance, currentPrice), input.approachPct) <= 0) return done('APPROACHING', why);
  return done('WAITING', why);
}
