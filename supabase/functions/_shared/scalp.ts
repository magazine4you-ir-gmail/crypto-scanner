// supabase/functions/_shared/scalp.ts
//
// استراتژی «فست اسکالپ» — Fast Scalp strategy engine.
// Same rules as engine.ts: no npm / Deno imports, only the shared engine, so it runs unchanged in the
// browser (Vite alias "@scalp") and in Edge Functions (Deno).
//
// Idea (what the strategy text asked for, turned into rules):
//   high volume        -> relative-volume spike + only liquid pairs (page filter) + volume-profile nodes
//   correct data       -> only CLOSED candles, optional taker-buy delta, cost-aware gates
//   volume profile     -> POC / value area (VAH, VAL) / HVN / LVN built from the candles themselves
//   smart-money        -> liquidity sweep, market-structure shift (MSS), fair-value gap (FVG), order block (OB)
//   price action       -> engulfing / pin bar / momentum candle as the final trigger
//   short timeframe    -> 1m / 5m / 15m, time stop (trade expires after a few bars)
//   no greed           -> ONE small target (default 1.5R), clipped at the first wall; no runner, no averaging
//   controlled risk    -> structural stop, stop-size limits, net R/R after fees, cooldown + daily loss cap (backtest)
//
// Everything is computed on the candles you pass in. Nothing looks into the future.

import {
  atr,
  detectStructure,
  ema,
  findSwingPoints,
  relativeVolume,
  resolveTrade,
  volatilityProfile,
  type Candle,
  type Direction,
  type StructureLabel,
  type SwingPoint,
} from './engine.ts';

// =====================================================================
// Types
// =====================================================================

export type ScalpSignalType = 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';
export type ScalpModel = 'REVERSAL' | 'CONTINUATION';
export type PricePattern = 'ENGULFING' | 'PIN_BAR' | 'MOMENTUM';
export type HtfBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type TargetKind = 'R_MULTIPLE' | 'POC' | 'VAH' | 'VAL' | 'HVN' | 'SWING';
export type ScalpFactorKey = 'liquidity' | 'structure' | 'profile' | 'zone' | 'priceAction' | 'volume' | 'htf';

export interface ProfileBin {
  price: number;
  volume: number;
}

export interface VolumeProfile {
  low: number;
  high: number;
  step: number;
  bins: ProfileBin[];
  /** Price of the highest-volume bin (centre). */
  poc: number;
  /** Value area high / low (70 % of the volume by default). */
  vah: number;
  val: number;
  /** High-volume nodes (local peaks, acceptance) and low-volume nodes (local troughs, fast-travel zones). */
  hvn: number[];
  lvn: number[];
  totalVolume: number;
}

export interface Zone {
  low: number;
  high: number;
  /** Index (in the analysed array) of the candle that formed the zone. */
  index: number;
}

export interface Sweep {
  direction: Direction;
  /** The swing level that was raided (a swing low for LONG, a swing high for SHORT). */
  level: number;
  /** Most extreme price since the raid started (the wick tip): the natural stop reference. */
  extreme: number;
  barIndex: number;
  swingIndex: number;
  /** How far past the level price went. */
  depth: number;
  /** True when several swings sit at nearly the same price (equal highs/lows = fatter liquidity pool). */
  equal: boolean;
}

export interface ScalpReason {
  code: string;
  fa: string;
  en: string;
}

export interface ScalpFactor {
  key: ScalpFactorKey;
  /** 0..100 */
  score: number;
  /** Weight in the total (weights sum to 100). */
  weight: number;
  positive: boolean;
  fa: string;
  en: string;
}

export interface ScalpPlan {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  targetKind: TargetKind;
  stopDistance: number;
  /** Stop distance in percent of entry. */
  stopPct: number;
  /** Gross reward in units of risk. */
  rewardR: number;
  /** Reward/risk after round-trip costs. */
  netRR: number;
  /** Round-trip cost as a share of the stop distance (fees eat this much of 1R). */
  costToRisk: number;
  positionSize: number;
  notional: number;
  /** Time stop: the trade is closed at the close of this bar if neither stop nor target was hit. */
  maxBars: number;
}

export interface ScalpWeights {
  liquidity: number;
  structure: number;
  profile: number;
  zone: number;
  priceAction: number;
  volume: number;
  htf: number;
}

export interface ScalpConfig {
  profileLookback: number;
  profileBins: number;
  swingLookback: number;
  structureLookback: number;
  sweepMaxAge: number;
  sweepLookbackBars: number;
  zoneLookback: number;
  minFvgAtr: number;
  /** Last-3-candles relative volume needed to confirm the trigger. */
  minRelVolume: number;
  minScore: number;
  watchScore: number;
  /** Target in R. "No greed": small and fixed. */
  targetR: number;
  /** A wall closer than this many R makes the trade not worth taking. */
  minGrossR: number;
  minNetRR: number;
  /** Max share of 1R that fees may consume. */
  maxCostToRisk: number;
  /** Round-trip fees + slippage in percent of price. */
  costPct: number;
  minStopAtr: number;
  maxStopAtr: number;
  stopBufferAtr: number;
  riskPercent: number;
  capital: number;
  /** 100 = spot, no leverage. */
  maxPositionPct: number;
  allowShort: boolean;
  /** Block trades against the higher-timeframe bias (when one is supplied). */
  htfStrict: boolean;
  weights: ScalpWeights;
}

export interface ScalpOptions {
  timeframe?: string;
  config?: Partial<ScalpConfig>;
  htfBias?: HtfBias | null;
}

export interface ScalpAnalysis {
  type: ScalpSignalType;
  /** Side the verdict refers to (for WAIT / NO_TRADE: the better-developed side). */
  direction: Direction;
  model: ScalpModel | null;
  score: number;
  longScore: number;
  shortScore: number;
  price: number;
  candleCloseTime: number;
  atr: number;
  atrPct: number;
  relVolume: number | null;
  structure: StructureLabel;
  htfBias: HtfBias | null;
  profile: VolumeProfile;
  sweep: Sweep | null;
  mss: boolean;
  fvg: Zone | null;
  orderBlock: Zone | null;
  pattern: PricePattern | null;
  /** Profile node the price is reacting from (VAL/VAH/POC/HVN), if any. */
  node: { price: number; kind: 'VAL' | 'VAH' | 'POC' | 'HVN' } | null;
  /** Price re-entered the value area after trading outside of it. */
  valueReentry: boolean;
  /** Taker-buy delta of the last candle in [-1, 1] when the data feed provides it. */
  delta: number | null;
  plan: ScalpPlan | null;
  factors: ScalpFactor[];
  /** Why the setup is not a signal (empty for BUY/SELL). */
  reasons: ScalpReason[];
}

// =====================================================================
// Defaults
// =====================================================================

export const DEFAULT_SCALP_WEIGHTS: ScalpWeights = {
  liquidity: 25,
  structure: 15,
  profile: 20,
  zone: 10,
  priceAction: 15,
  volume: 10,
  htf: 5,
};

export const DEFAULT_SCALP_CONFIG: ScalpConfig = {
  profileLookback: 240,
  profileBins: 48,
  swingLookback: 2,
  structureLookback: 3,
  sweepMaxAge: 3,
  sweepLookbackBars: 60,
  zoneLookback: 30,
  minFvgAtr: 0.25,
  minRelVolume: 1.2,
  minScore: 65,
  watchScore: 50,
  targetR: 1.5,
  minGrossR: 1.0,
  minNetRR: 1.1,
  maxCostToRisk: 0.3,
  costPct: 0.1,
  minStopAtr: 0.4,
  maxStopAtr: 2.0,
  stopBufferAtr: 0.15,
  riskPercent: 0.5,
  capital: 10_000,
  maxPositionPct: 100,
  allowShort: true,
  htfStrict: true,
  weights: DEFAULT_SCALP_WEIGHTS,
};

/** Time stop per timeframe, in bars. */
export const SCALP_MAX_BARS: Record<string, number> = { '1m': 15, '5m': 12, '15m': 10 };

/** Higher timeframe used for the bias filter. */
export const SCALP_HTF: Record<string, string> = { '1m': '15m', '5m': '1h', '15m': '4h' };

export const MIN_SCALP_CANDLES = 120;

// =====================================================================
// Volume profile
// =====================================================================

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Builds a volume profile from OHLCV candles. A candle's volume is spread evenly over the price bins
 * its high-low range touches (the best possible with candle data; tick data would be exact).
 */
export function buildVolumeProfile(candles: Candle[], binCount = 48, valueAreaPct = 0.7): VolumeProfile | null {
  if (candles.length < 10 || binCount < 8) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;

  const step = (hi - lo) / binCount;
  const vols = new Array<number>(binCount).fill(0);
  for (const c of candles) {
    const v = c.volume;
    if (!(v > 0)) continue;
    const range = c.high - c.low;
    if (!(range > 0)) {
      vols[clamp(Math.floor((c.close - lo) / step), 0, binCount - 1)] += v;
      continue;
    }
    const first = clamp(Math.floor((c.low - lo) / step), 0, binCount - 1);
    const lastBin = clamp(Math.floor((c.high - lo) / step), 0, binCount - 1);
    for (let b = first; b <= lastBin; b++) {
      const binLo = lo + b * step;
      const overlap = Math.min(c.high, binLo + step) - Math.max(c.low, binLo);
      if (overlap > 0) vols[b] += (v * overlap) / range;
    }
  }

  const total = vols.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return null;

  let pocI = 0;
  for (let b = 1; b < binCount; b++) if (vols[b] > vols[pocI]) pocI = b;

  // value area: grow from the POC towards the heavier neighbour until 70 % of the volume is inside
  let loI = pocI;
  let hiI = pocI;
  let acc = vols[pocI];
  const target = total * valueAreaPct;
  while (acc < target && (loI > 0 || hiI < binCount - 1)) {
    const up = hiI < binCount - 1 ? vols[hiI + 1] : -1;
    const dn = loI > 0 ? vols[loI - 1] : -1;
    if (up >= dn) {
      hiI++;
      acc += vols[hiI];
    } else {
      loI--;
      acc += vols[loI];
    }
  }

  const centre = (b: number) => lo + (b + 0.5) * step;
  const mean = total / binCount;
  const hvn: number[] = [];
  const lvn: number[] = [];
  let lastHvn = -2;
  let lastLvn = -2;
  for (let b = 1; b < binCount - 1; b++) {
    if (b !== pocI && vols[b] >= 1.3 * mean && vols[b] >= vols[b - 1] && vols[b] >= vols[b + 1] && b - lastHvn > 1) {
      hvn.push(centre(b));
      lastHvn = b;
    }
    if (vols[b] <= 0.5 * mean && vols[b] <= vols[b - 1] && vols[b] <= vols[b + 1] && b - lastLvn > 1) {
      lvn.push(centre(b));
      lastLvn = b;
    }
  }

  return {
    low: lo,
    high: hi,
    step,
    bins: vols.map((volume, b) => ({ price: centre(b), volume })),
    poc: centre(pocI),
    vah: lo + (hiI + 1) * step,
    val: lo + loI * step,
    hvn,
    lvn,
    totalVolume: total,
  };
}

// =====================================================================
// Smart-money concepts (price based)
// =====================================================================

/**
 * Liquidity sweep ("stop hunt"): within the last `maxAge` candles a wick pierced a still-untouched swing
 * low (LONG) / swing high (SHORT) and the candle CLOSED back on the right side of it, and price has not
 * closed back through the level since.
 */
export function detectSweep(
  candles: Candle[],
  swings: SwingPoint[],
  atrV: number,
  dir: Direction,
  maxAge = 3,
  lookbackBars = 60,
): Sweep | null {
  const n = candles.length;
  const isLong = dir === 'LONG';
  const type = isLong ? 'LOW' : 'HIGH';
  const pool = swings.filter((s) => s.type === type && s.index >= n - lookbackBars);

  for (let i = n - 1; i >= Math.max(1, n - maxAge); i--) {
    const c = candles[i];
    let best: Sweep | null = null;
    for (const s of pool) {
      if (s.index >= i) continue;
      let taken = false;
      for (let k = s.index + 1; k < i; k++) {
        if (isLong ? candles[k].low < s.price : candles[k].high > s.price) {
          taken = true;
          break;
        }
      }
      if (taken) continue;
      const pierced = isLong ? c.low < s.price : c.high > s.price;
      const reclaimed = isLong ? c.close > s.price : c.close < s.price;
      if (!pierced || !reclaimed) continue;
      const depth = isLong ? s.price - c.low : c.high - s.price;
      if (depth < 0.05 * atrV || depth > 2 * atrV) continue;

      let extreme = isLong ? c.low : c.high;
      let failed = false;
      for (let k = i + 1; k < n; k++) {
        extreme = isLong ? Math.min(extreme, candles[k].low) : Math.max(extreme, candles[k].high);
        if (isLong ? candles[k].close < s.price : candles[k].close > s.price) failed = true;
      }
      if (failed) continue;

      const equal = pool.some((o) => o !== s && Math.abs(o.price - s.price) <= 0.3 * atrV);
      const cand: Sweep = { direction: dir, level: s.price, extreme, barIndex: i, swingIndex: s.index, depth, equal };
      if (!best || (cand.equal && !best.equal) || (cand.equal === best.equal && cand.depth > best.depth)) best = cand;
    }
    if (best) return best;
  }
  return null;
}

/**
 * Market-structure shift after a sweep: price closes beyond the last minor swing that formed on the way
 * down (LONG) / up (SHORT) into the raid. That is the first sign that the raid was a trap, not a breakout.
 */
export function detectMss(
  candles: Candle[],
  swings: SwingPoint[],
  sweep: Sweep,
  dir: Direction,
): { mss: boolean; level: number | null } {
  const isLong = dir === 'LONG';
  const b = sweep.barIndex;
  const opp = swings.filter((s) => s.type === (isLong ? 'HIGH' : 'LOW') && s.index > sweep.swingIndex && s.index < b);
  let level: number | null = null;
  if (opp.length > 0) {
    level = opp[opp.length - 1].price;
  } else {
    const from = Math.max(0, b - 4);
    if (b - from >= 1) {
      level = isLong ? -Infinity : Infinity;
      for (let k = from; k < b; k++) level = isLong ? Math.max(level, candles[k].high) : Math.min(level, candles[k].low);
    }
  }
  if (level === null || !Number.isFinite(level)) return { mss: false, level: null };
  for (let k = b; k < candles.length; k++) {
    if (isLong ? candles[k].close > level : candles[k].close < level) return { mss: true, level };
  }
  return { mss: false, level };
}

/** Active (not closed through) fair-value gaps in the given direction, newest first. */
export function findFvgs(candles: Candle[], atrV: number, dir: Direction, lookback = 30, minAtr = 0.25): Zone[] {
  const n = candles.length;
  const isLong = dir === 'LONG';
  const out: Zone[] = [];
  for (let i = n - 1; i >= Math.max(2, n - lookback); i--) {
    const a = candles[i - 2];
    const c = candles[i];
    const exists = isLong ? c.low > a.high : c.high < a.low;
    if (!exists) continue;
    const zLow = isLong ? a.high : c.high;
    const zHigh = isLong ? c.low : a.low;
    if (zHigh - zLow < minAtr * atrV) continue;
    let mitigated = false;
    for (let k = i + 1; k < n; k++) {
      if (isLong ? candles[k].close < zLow : candles[k].close > zHigh) {
        mitigated = true;
        break;
      }
    }
    if (!mitigated) out.push({ low: zLow, high: zHigh, index: i });
  }
  return out;
}

/**
 * Order blocks: the last opposite candle before a displacement candle (body >= 1 ATR) that broke the
 * previous 5-bar extreme. Active while no candle has closed through the far edge.
 */
export function findOrderBlocks(candles: Candle[], atrV: number, dir: Direction, lookback = 30): Zone[] {
  const n = candles.length;
  const isLong = dir === 'LONG';
  const out: Zone[] = [];
  for (let j = n - 2; j >= Math.max(6, n - lookback); j--) {
    const d = candles[j];
    const body = Math.abs(d.close - d.open);
    if (!(isLong ? d.close > d.open : d.close < d.open) || body < atrV) continue;
    let ext = isLong ? -Infinity : Infinity;
    for (let k = j - 5; k < j; k++) ext = isLong ? Math.max(ext, candles[k].high) : Math.min(ext, candles[k].low);
    if (isLong ? d.close <= ext : d.close >= ext) continue;

    let zone: Zone | null = null;
    for (let k = j - 1; k >= Math.max(0, j - 6); k--) {
      const o = candles[k];
      if (isLong ? o.close < o.open : o.close > o.open) {
        zone = { low: o.low, high: o.high, index: k };
        break;
      }
    }
    if (!zone) continue;
    let mitigated = false;
    for (let m = j + 1; m < n; m++) {
      if (isLong ? candles[m].close < zone.low : candles[m].close > zone.high) {
        mitigated = true;
        break;
      }
    }
    if (!mitigated) out.push(zone);
  }
  return out;
}

/** Last candle touched the zone from the right side and did not close through it. */
function retests(zone: Zone, last: Candle, dir: Direction): boolean {
  return dir === 'LONG'
    ? last.low <= zone.high && last.close >= zone.low
    : last.high >= zone.low && last.close <= zone.high;
}

// =====================================================================
// Price action
// =====================================================================

/** Confirmation pattern on the LAST closed candle. */
export function pricePattern(candles: Candle[], dir: Direction, atrV: number): PricePattern | null {
  const n = candles.length;
  if (n < 2) return null;
  const c = candles[n - 1];
  const p = candles[n - 2];
  const range = c.high - c.low;
  if (!(range > 0) || range < 0.4 * atrV) return null;
  const body = Math.abs(c.close - c.open);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;
  const pBody = Math.abs(p.close - p.open);

  if (dir === 'LONG') {
    if (c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close && body >= pBody) return 'ENGULFING';
    if (lower >= 0.5 * range && lower >= 2 * body && c.close >= c.low + 0.6 * range) return 'PIN_BAR';
    if (c.close > c.open && body >= 0.6 * range && c.close >= c.low + 0.75 * range && range >= 0.7 * atrV) return 'MOMENTUM';
  } else {
    if (c.close < c.open && p.close > p.open && c.close <= p.open && c.open >= p.close && body >= pBody) return 'ENGULFING';
    if (upper >= 0.5 * range && upper >= 2 * body && c.close <= c.high - 0.6 * range) return 'PIN_BAR';
    if (c.close < c.open && body >= 0.6 * range && c.close <= c.high - 0.75 * range && range >= 0.7 * atrV) return 'MOMENTUM';
  }
  return null;
}

/** Aggressive-buyer share of the candle, in [-1, 1]. Null when the feed has no taker data. */
export function deltaRatio(c: Candle): number | null {
  if (c.takerBuyVolume === undefined || !Number.isFinite(c.takerBuyVolume) || !(c.volume > 0)) return null;
  return clamp((2 * c.takerBuyVolume - c.volume) / c.volume, -1, 1);
}

// =====================================================================
// Higher-timeframe bias
// =====================================================================

export function htfBias(candles: Candle[]): HtfBias {
  if (candles.length < 55) return 'NEUTRAL';
  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const n = closes.length;
  const a = e20[n - 1];
  const b = e50[n - 1];
  const aPrev = e20[n - 4];
  if (a === null || b === null || aPrev === null) return 'NEUTRAL';
  if (closes[n - 1] > a && a > b && a > aPrev) return 'BULLISH';
  if (closes[n - 1] < a && a < b && a < aPrev) return 'BEARISH';
  return 'NEUTRAL';
}

// =====================================================================
// Volume-profile context
// =====================================================================

interface ProfileContext {
  node: { price: number; kind: 'VAL' | 'VAH' | 'POC' | 'HVN' } | null;
  reentry: boolean;
}

function profileContext(candles: Candle[], profile: VolumeProfile, dir: Direction, atrV: number): ProfileContext {
  const n = candles.length;
  const last = candles[n - 1];
  const isLong = dir === 'LONG';
  const recent = candles.slice(-3);

  const nodes: { price: number; kind: 'VAL' | 'VAH' | 'POC' | 'HVN' }[] = isLong
    ? [{ price: profile.val, kind: 'VAL' }, { price: profile.poc, kind: 'POC' }, ...profile.hvn.map((p) => ({ price: p, kind: 'HVN' as const }))]
    : [{ price: profile.vah, kind: 'VAH' }, { price: profile.poc, kind: 'POC' }, ...profile.hvn.map((p) => ({ price: p, kind: 'HVN' as const }))];

  const extreme = isLong ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high));
  let node: ProfileContext['node'] = null;
  let bestDist = Infinity;
  for (const nd of nodes) {
    const d = isLong ? extreme - nd.price : nd.price - extreme; // >0 = extreme stayed on the "safe" side
    const touched = isLong
      ? extreme <= nd.price + 0.3 * atrV && extreme >= nd.price - 0.8 * atrV && last.close >= nd.price - 0.1 * atrV
      : extreme >= nd.price - 0.3 * atrV && extreme <= nd.price + 0.8 * atrV && last.close <= nd.price + 0.1 * atrV;
    if (touched && Math.abs(d) < bestDist) {
      bestDist = Math.abs(d);
      node = nd;
    }
  }

  let reentry = false;
  const edge = isLong ? profile.val : profile.vah;
  if (isLong ? last.close > edge : last.close < edge) {
    for (let k = Math.max(0, n - 7); k < n - 1; k++) {
      if (isLong ? candles[k].close < edge : candles[k].close > edge) {
        reentry = true;
        break;
      }
    }
  }
  return { node, reentry };
}

// =====================================================================
// One side (LONG or SHORT) evaluation
// =====================================================================

interface Ctx {
  candles: Candle[];
  n: number;
  last: Candle;
  atrV: number;
  e20: number | null;
  e50: number | null;
  structure: StructureLabel;
  swingsFine: SwingPoint[];
  swingsStruct: SwingPoint[];
  profile: VolumeProfile;
  rvMax3: number | null;
  htf: HtfBias | null;
  cfg: ScalpConfig;
  timeframe?: string;
}

interface SideEval {
  dir: Direction;
  model: ScalpModel | null;
  score: number;
  factors: ScalpFactor[];
  plan: ScalpPlan | null;
  blockers: ScalpReason[];
  sweep: Sweep | null;
  mss: boolean;
  fvg: Zone | null;
  ob: Zone | null;
  pattern: PricePattern | null;
  node: ProfileContext['node'];
  reentry: boolean;
}

const SOFT_CODES = new Set(['NO_PATTERN', 'LOW_VOLUME']);

function reason(code: string, fa: string, en: string): ScalpReason {
  return { code, fa, en };
}

function buildPlan(
  dir: Direction,
  ctx: Ctx,
  stopRef: number,
): { plan: ScalpPlan; blockers: ScalpReason[] } {
  const { last, atrV, cfg, profile, swingsStruct } = ctx;
  const isLong = dir === 'LONG';
  const sgn = isLong ? 1 : -1;
  const blockers: ScalpReason[] = [];
  const entry = last.close;

  let stop = isLong ? stopRef - cfg.stopBufferAtr * atrV : stopRef + cfg.stopBufferAtr * atrV;
  let risk = Math.abs(entry - stop);
  const minRisk = cfg.minStopAtr * atrV;
  if (risk < minRisk) {
    risk = minRisk; // a stop inside the noise is a donation
    stop = entry - sgn * risk;
  }
  if (risk > cfg.maxStopAtr * atrV) {
    blockers.push(reason('STOP_WIDE', 'استاپ ساختاری بیش از حد دور است', 'Structural stop is too far away'));
  }

  // Walls: everything between entry and the desired target that can stop price.
  // When the entry is still OUTSIDE the value area, the near value-area edge (VAL for longs, VAH for
  // shorts) is the re-entry trigger of the trade, not a wall: the trade is "back into value, towards the
  // POC". The far edge and the POC/HVN/swings are real walls.
  const nearEdge = isLong ? profile.val : profile.vah;
  const outsideValue = isLong ? entry < nearEdge : entry > nearEdge;
  const walls: { price: number; kind: TargetKind }[] = [
    { price: profile.poc, kind: 'POC' as TargetKind },
    ...(isLong || !outsideValue ? [{ price: profile.vah, kind: 'VAH' as TargetKind }] : []),
    ...(!isLong || !outsideValue ? [{ price: profile.val, kind: 'VAL' as TargetKind }] : []),
    ...profile.hvn.map((p) => ({ price: p, kind: 'HVN' as TargetKind })),
    ...swingsStruct
      .filter((s) => s.type === (isLong ? 'HIGH' : 'LOW'))
      .map((s) => ({ price: s.price, kind: 'SWING' as TargetKind })),
  ]
    .filter((w) => sgn * (w.price - entry) > 0.05 * atrV)
    .sort((a, b) => sgn * (a.price - b.price));

  const desired = cfg.targetR * risk;
  let target = entry + sgn * desired;
  let targetKind: TargetKind = 'R_MULTIPLE';
  const wall = walls.find((w) => Math.abs(w.price - entry) < desired);
  if (wall) {
    target = wall.price - sgn * 0.1 * atrV; // front-run the wall
    targetKind = wall.kind;
  }
  const reward = Math.abs(target - entry);
  const rewardR = reward / risk;

  const costAbs = entry * (cfg.costPct / 100);
  const costToRisk = costAbs / risk;
  const netRR = (reward - costAbs) / (risk + costAbs);

  if (rewardR < cfg.minGrossR) {
    blockers.push(reason('TARGET_BLOCKED', 'سطح مقابل (حجم/سوئینگ) خیلی نزدیک است', 'An opposing level is too close to the entry'));
  } else if (costToRisk > cfg.maxCostToRisk) {
    blockers.push(reason('COST_TOO_HIGH', 'کارمزد بخش بزرگی از ریسک را می‌خورد', 'Fees would eat too much of the risk'));
  } else if (netRR < cfg.minNetRR) {
    blockers.push(reason('NET_RR_LOW', 'ریسک/بازده خالص پس از کارمزد کافی نیست', 'Net risk/reward after fees is too low'));
  }

  const riskAmount = cfg.capital * (cfg.riskPercent / 100);
  const bySize = riskAmount / (risk + costAbs);
  const byCap = (cfg.capital * (cfg.maxPositionPct / 100)) / entry;
  const positionSize = Math.min(bySize, byCap);

  const plan: ScalpPlan = {
    direction: dir,
    entry,
    stop,
    target,
    targetKind,
    stopDistance: risk,
    stopPct: (risk / entry) * 100,
    rewardR,
    netRR,
    costToRisk,
    positionSize,
    notional: positionSize * entry,
    maxBars: SCALP_MAX_BARS[ctx.timeframe ?? ''] ?? 12,
  };
  return { plan, blockers };
}

function evaluateSide(dir: Direction, ctx: Ctx): SideEval {
  const { candles, n, last, atrV, cfg, profile } = ctx;
  const isLong = dir === 'LONG';
  const sgn = isLong ? 1 : -1;
  const w = cfg.weights;

  const sweep = detectSweep(candles, ctx.swingsFine, atrV, dir, cfg.sweepMaxAge, cfg.sweepLookbackBars);
  const mssInfo = sweep ? detectMss(candles, ctx.swingsFine, sweep, dir) : { mss: false, level: null };
  const fvg = findFvgs(candles, atrV, dir, cfg.zoneLookback, cfg.minFvgAtr).find((z) => z.index < n - 1 && retests(z, last, dir)) ?? null;
  const ob = findOrderBlocks(candles, atrV, dir, cfg.zoneLookback).find((z) => retests(z, last, dir)) ?? null;
  const pattern = pricePattern(candles, dir, atrV);
  const pctx = profileContext(candles, profile, dir, atrV);

  const structureOk = isLong
    ? ctx.structure === 'HH_HL' || ctx.structure === 'BOS_BULLISH'
    : ctx.structure === 'LH_LL' || ctx.structure === 'BOS_BEARISH';
  const trendOk =
    ctx.e20 !== null && ctx.e50 !== null && structureOk &&
    (isLong ? ctx.e20 > ctx.e50 && last.close > ctx.e50 : ctx.e20 < ctx.e50 && last.close < ctx.e50);
  const zoneRetest = fvg !== null || ob !== null || pctx.node !== null;

  let model: ScalpModel | null = null;
  if (sweep) model = 'REVERSAL';
  else if (trendOk && zoneRetest) model = 'CONTINUATION';

  const blockers: ScalpReason[] = [];
  if (model === null) {
    blockers.push(reason('NO_SETUP', 'ستاپی (جارو نقدینگی یا پولبک روند) وجود ندارد', 'No setup (liquidity sweep or trend pullback)'));
  }

  // ---- stop reference + plan ------------------------------------------------
  let plan: ScalpPlan | null = null;
  if (model !== null) {
    let stopRef: number;
    if (model === 'REVERSAL' && sweep) {
      stopRef = sweep.extreme;
    } else {
      const lows = candles.slice(-3);
      const base = isLong ? Math.min(...lows.map((c) => c.low)) : Math.max(...lows.map((c) => c.high));
      const zoneEdges = [fvg, ob].filter((z): z is Zone => z !== null).map((z) => (isLong ? z.low : z.high));
      stopRef = isLong ? Math.min(base, ...zoneEdges) : Math.max(base, ...zoneEdges);
    }
    const built = buildPlan(dir, ctx, stopRef);
    plan = built.plan;
    blockers.push(...built.blockers);
  }

  // ---- factors -----------------------------------------------------------------
  let liquidity = 0;
  let liquidityTxt = { fa: 'بدون جارو نقدینگی / پولبک', en: 'No sweep / pullback' };
  if (model === 'REVERSAL' && sweep) {
    liquidity = clamp(70 + (sweep.equal ? 15 : 0) + (sweep.depth >= 0.3 * atrV ? 10 : 0), 0, 100);
    liquidityTxt = isLong
      ? { fa: `جارو نقدینگی کف${sweep.equal ? ' (کف‌های برابر)' : ''} و بازگشت`, en: `Sell-side liquidity sweep${sweep.equal ? ' (equal lows)' : ''} + reclaim` }
      : { fa: `جارو نقدینگی سقف${sweep.equal ? ' (سقف‌های برابر)' : ''} و بازگشت`, en: `Buy-side liquidity sweep${sweep.equal ? ' (equal highs)' : ''} + reclaim` };
  } else if (model === 'CONTINUATION') {
    liquidity = 60;
    liquidityTxt = { fa: 'پولبک در جهت روند', en: 'Pullback with the trend' };
  }

  const structure = model === 'REVERSAL' ? (mssInfo.mss ? 100 : 30) : model === 'CONTINUATION' ? 100 : 0;
  const structureTxt =
    model === 'REVERSAL'
      ? mssInfo.mss
        ? { fa: 'تغییر ساختار (MSS) تأیید شد', en: 'Market-structure shift (MSS) confirmed' }
        : { fa: 'هنوز MSS ندارد', en: 'No MSS yet' }
      : model === 'CONTINUATION'
        ? { fa: 'ساختار هم‌جهت (HH/HL یا LH/LL)', en: 'Structure aligned (HH/HL or LH/LL)' }
        : { fa: 'بدون ساختار', en: 'No structure' };

  let profileScore = 0;
  if (pctx.reentry && pctx.node) profileScore = 100;
  else if (pctx.reentry) profileScore = 80;
  else if (pctx.node) profileScore = 60;
  else if (isLong ? last.close < profile.val : last.close > profile.vah) profileScore = 20;
  if (plan) {
    const between = (p: number) => sgn * (p - plan.entry) > 0 && sgn * (plan.target - p) > 0;
    if (profile.lvn.some(between) && !profile.hvn.some(between)) profileScore = Math.min(100, profileScore + 10);
  }
  const nodeName = pctx.node?.kind ?? '';
  const profileTxt = pctx.reentry
    ? { fa: `بازگشت به محدوده ارزش${pctx.node ? ` + واکنش از ${nodeName}` : ''}`, en: `Value-area re-entry${pctx.node ? ` + reaction at ${nodeName}` : ''}` }
    : pctx.node
      ? { fa: `واکنش از ${nodeName} در ولیوم پروفایل`, en: `Reaction at volume-profile ${nodeName}` }
      : { fa: 'قیمت روی گره حجمی نیست', en: 'Not at a volume node' };

  const zoneScore = clamp((fvg ? 60 : 0) + (ob ? 60 : 0), 0, 100);
  const zoneTxt =
    fvg || ob
      ? { fa: `ریتست ${[fvg ? 'FVG' : '', ob ? 'اوردر بلاک' : ''].filter(Boolean).join(' + ')}`, en: `Retest of ${[fvg ? 'FVG' : '', ob ? 'order block' : ''].filter(Boolean).join(' + ')}` }
      : { fa: 'بدون FVG/اوردر بلاک فعال', en: 'No active FVG / order block' };

  const paScore = pattern === 'ENGULFING' ? 100 : pattern === 'PIN_BAR' ? 90 : pattern === 'MOMENTUM' ? 70 : 0;
  const paTxt = pattern
    ? { fa: `الگوی تأیید: ${pattern === 'ENGULFING' ? 'اینگلفینگ' : pattern === 'PIN_BAR' ? 'پین‌بار' : 'کندل مومنتوم'}`, en: `Trigger: ${pattern === 'ENGULFING' ? 'engulfing' : pattern === 'PIN_BAR' ? 'pin bar' : 'momentum candle'}` }
    : { fa: 'کندل تأیید ندارد', en: 'No confirming candle' };

  const rv = ctx.rvMax3;
  let volumeScore = rv === null ? 10 : rv >= 2 ? 100 : rv >= 1.5 ? 80 : rv >= 1.2 ? 60 : rv >= 1 ? 40 : 10;
  const rawDelta = deltaRatio(last);
  const dirDelta = rawDelta === null ? null : rawDelta * sgn;
  if (dirDelta !== null) {
    if (dirDelta >= 0.15) volumeScore += 15;
    else if (dirDelta <= -0.15) volumeScore -= 30;
  }
  volumeScore = clamp(volumeScore, 0, 100);
  const volumeTxt = {
    fa: `حجم نسبی ${rv === null ? '—' : rv.toFixed(1)}×${dirDelta === null ? '' : ` | دلتا ${(dirDelta * 100).toFixed(0)}٪`}`,
    en: `Relative volume ${rv === null ? '—' : rv.toFixed(1)}×${dirDelta === null ? '' : ` | delta ${(dirDelta * 100).toFixed(0)}%`}`,
  };

  const htfAligned = ctx.htf !== null && ctx.htf === (isLong ? 'BULLISH' : 'BEARISH');
  const htfOpposed = ctx.htf !== null && ctx.htf === (isLong ? 'BEARISH' : 'BULLISH');
  const htfScore = ctx.htf === null ? 50 : htfAligned ? 100 : htfOpposed ? 0 : 50;
  const htfTxt =
    ctx.htf === null
      ? { fa: 'تایم‌فریم بالاتر استفاده نشده', en: 'Higher timeframe not used' }
      : htfAligned
        ? { fa: 'هم‌جهت با تایم‌فریم بالاتر', en: 'Aligned with higher timeframe' }
        : htfOpposed
          ? { fa: 'خلاف تایم‌فریم بالاتر', en: 'Against higher timeframe' }
          : { fa: 'تایم‌فریم بالاتر خنثی', en: 'Higher timeframe neutral' };

  const mk = (key: ScalpFactorKey, score: number, weight: number, txt: { fa: string; en: string }): ScalpFactor => ({
    key,
    score,
    weight,
    positive: score >= 50,
    fa: txt.fa,
    en: txt.en,
  });
  const factors: ScalpFactor[] = [
    mk('liquidity', liquidity, w.liquidity, liquidityTxt),
    mk('structure', structure, w.structure, structureTxt),
    mk('profile', profileScore, w.profile, profileTxt),
    mk('zone', zoneScore, w.zone, zoneTxt),
    mk('priceAction', paScore, w.priceAction, paTxt),
    mk('volume', volumeScore, w.volume, volumeTxt),
    mk('htf', htfScore, w.htf, htfTxt),
  ];
  const wSum = factors.reduce((s, f) => s + f.weight, 0) || 100;
  const score = Math.round(factors.reduce((s, f) => s + (f.score * f.weight) / wSum, 0));

  // ---- gates ---------------------------------------------------------------------
  if (model !== null) {
    if (!pattern) blockers.push(reason('NO_PATTERN', 'کندل تأیید (اینگلفینگ/پین‌بار/مومنتوم) هنوز نیامده', 'No confirming candle yet'));
    if (rv === null || rv < cfg.minRelVolume) blockers.push(reason('LOW_VOLUME', 'حجم کافی برای تأیید نیست', 'Not enough volume to confirm'));
    if (dirDelta !== null && dirDelta <= -0.15) blockers.push(reason('FLOW_AGAINST', 'جریان خرید/فروش تهاجمی خلاف جهت است', 'Aggressive order flow is against the trade'));
    if (cfg.htfStrict && htfOpposed) blockers.push(reason('HTF_OPPOSED', 'خلاف جهت تایم‌فریم بالاتر', 'Against the higher-timeframe bias'));
    if (score < cfg.minScore) blockers.push(reason('LOW_SCORE', `امتیاز ${score} کمتر از حداقل ${cfg.minScore}`, `Score ${score} is below the minimum ${cfg.minScore}`));
    if (dir === 'SHORT' && !cfg.allowShort) blockers.push(reason('SHORT_DISABLED', 'شورت غیرفعال است', 'Shorts are disabled'));
  }

  return { dir, model, score, factors, plan, blockers, sweep, mss: mssInfo.mss, fvg, ob, pattern, node: pctx.node, reentry: pctx.reentry };
}

// =====================================================================
// Public: analyse
// =====================================================================

/**
 * Analyses CLOSED candles (pass them through closedCandles() first). Needs at least MIN_SCALP_CANDLES.
 */
export function analyzeScalp(candles: Candle[], options: ScalpOptions = {}): ScalpAnalysis | null {
  const cfg: ScalpConfig = { ...DEFAULT_SCALP_CONFIG, ...options.config, weights: { ...DEFAULT_SCALP_WEIGHTS, ...options.config?.weights } };
  const n = candles.length;
  if (n < MIN_SCALP_CANDLES) return null;

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = candles[n - 1];
  const atrV = atr(candles, 14)[n - 1];
  if (atrV === null || !(atrV > 0) || !(last.close > 0)) return null;

  const profile = buildVolumeProfile(candles.slice(-cfg.profileLookback), cfg.profileBins);
  if (!profile) return null;

  const rv = relativeVolume(volumes, 20);
  let rvMax3: number | null = null;
  for (let k = n - 3; k < n; k++) {
    const v = rv[k];
    if (v !== null && v !== undefined && (rvMax3 === null || v > rvMax3)) rvMax3 = v;
  }

  const swingsFine = findSwingPoints(candles, cfg.swingLookback);
  const swingsStruct = findSwingPoints(candles, cfg.structureLookback);
  const structure = detectStructure(swingsStruct);

  const ctx: Ctx = {
    candles,
    n,
    last,
    atrV,
    e20: ema(closes, 20)[n - 1],
    e50: ema(closes, 50)[n - 1],
    structure,
    swingsFine,
    swingsStruct,
    profile,
    rvMax3,
    htf: options.htfBias ?? null,
    cfg,
    timeframe: options.timeframe,
  };

  const longEval = evaluateSide('LONG', ctx);
  const shortEval = evaluateSide('SHORT', ctx);

  const isSignal = (e: SideEval) => e.model !== null && e.blockers.length === 0;
  const isWatch = (e: SideEval) =>
    e.model !== null && e.score >= cfg.watchScore && e.blockers.every((b) => SOFT_CODES.has(b.code) || b.code === 'LOW_SCORE');

  let chosen: SideEval;
  let type: ScalpSignalType;
  const signals = [longEval, shortEval].filter(isSignal);
  if (signals.length > 0) {
    chosen = signals.sort((a, b) => b.score - a.score)[0];
    type = chosen.dir === 'LONG' ? 'BUY' : 'SELL';
  } else {
    const watches = [longEval, shortEval].filter(isWatch);
    if (watches.length > 0) {
      chosen = watches.sort((a, b) => b.score - a.score)[0];
      type = 'WAIT';
    } else {
      const formed = [longEval, shortEval].filter((e) => e.model !== null);
      chosen = (formed.length > 0 ? formed : [longEval, shortEval]).sort((a, b) => b.score - a.score)[0];
      type = 'NO_TRADE';
    }
  }

  const volatile = (atrV / last.close) * 100 >= volatilityProfile(options.timeframe).high;
  const reasons = [...chosen.blockers];
  if (volatile && (type === 'BUY' || type === 'SELL')) {
    type = 'NO_TRADE';
    reasons.push(reason('HIGH_VOLATILITY', 'نوسان بیش از حد (خطر کندل‌های خبری)', 'Volatility too high (news-candle risk)'));
  }

  return {
    type,
    direction: chosen.dir,
    model: chosen.model,
    score: chosen.score,
    longScore: longEval.score,
    shortScore: shortEval.score,
    price: last.close,
    candleCloseTime: last.closeTime,
    atr: atrV,
    atrPct: (atrV / last.close) * 100,
    relVolume: rvMax3,
    structure,
    htfBias: options.htfBias ?? null,
    profile,
    sweep: chosen.sweep,
    mss: chosen.mss,
    fvg: chosen.fvg,
    orderBlock: chosen.ob,
    pattern: chosen.pattern,
    node: chosen.node,
    valueReentry: chosen.reentry,
    delta: deltaRatio(last),
    plan: chosen.plan,
    factors: chosen.factors,
    reasons,
  };
}

// =====================================================================
// Backtest (shared by the UI and the tests)
// =====================================================================

export interface ScalpBacktestOptions {
  /** Bars needed before the first analysis. */
  warmup?: number;
  /** Candles passed to the analyser at each step (keeps the run fast and identical to live use). */
  windowSize?: number;
  /** Bars to stay flat after a trade closes. */
  cooldownBars?: number;
  /** Stop trading for the UTC day once this many R were lost. */
  maxDailyLossR?: number;
  /** Higher-timeframe candles (closed) for the bias filter; only data that was closed at each bar is used. */
  htfCandles?: Candle[];
}

export interface ScalpTrade {
  direction: Direction;
  model: ScalpModel | null;
  score: number;
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  targetKind: TargetKind;
  exit: number | null;
  status: 'WIN' | 'LOSS' | 'EXPIRED' | 'OPEN';
  rMultiple: number | null;
  pnlPct: number | null;
  bars: number | null;
}

export interface ScalpBacktestStats {
  trades: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
  profitFactor: number;
  maxDrawdownR: number;
  avgBars: number;
  /** Bars where a real setup existed (sweep or pullback), whether or not it passed every gate. */
  setupsSeen: number;
  /** Why real setups did not become trades, by reason code. */
  rejectCounts: Record<string, number>;
  skippedByDailyLimit: number;
}

export function backtestScalp(
  candles: Candle[],
  options: ScalpOptions = {},
  bt: ScalpBacktestOptions = {},
): { trades: ScalpTrade[]; stats: ScalpBacktestStats } {
  const warmup = bt.warmup ?? MIN_SCALP_CANDLES;
  const windowSize = bt.windowSize ?? 400;
  const cooldown = bt.cooldownBars ?? 3;
  const maxDailyLossR = bt.maxDailyLossR ?? 3;
  const costPct = options.config?.costPct ?? DEFAULT_SCALP_CONFIG.costPct;
  const htf = bt.htfCandles;

  const trades: ScalpTrade[] = [];
  const rejectCounts: Record<string, number> = {};
  const dayR = new Map<number, number>();
  let setupsSeen = 0;
  let skippedByDailyLimit = 0;
  let htfPtr = 0;

  for (let i = warmup; i < candles.length - 1; i++) {
    const day = Math.floor(candles[i].closeTime / 86_400_000);
    if ((dayR.get(day) ?? 0) <= -maxDailyLossR) {
      skippedByDailyLimit++;
      continue;
    }

    let bias: HtfBias | null = options.htfBias ?? null;
    if (htf && htf.length > 0) {
      while (htfPtr < htf.length && htf[htfPtr].closeTime <= candles[i].closeTime) htfPtr++;
      bias = htfBias(htf.slice(Math.max(0, htfPtr - 120), htfPtr));
    }

    const window = candles.slice(Math.max(0, i + 1 - windowSize), i + 1);
    const a = analyzeScalp(window, { ...options, htfBias: bias });
    if (!a) continue;

    if (a.model !== null) {
      if (a.type === 'BUY' || a.type === 'SELL') setupsSeen++;
      else {
        setupsSeen++;
        for (const r of a.reasons) rejectCounts[r.code] = (rejectCounts[r.code] ?? 0) + 1;
      }
    }
    if ((a.type !== 'BUY' && a.type !== 'SELL') || !a.plan) continue;

    const direction: Direction = a.type === 'BUY' ? 'LONG' : 'SHORT';
    const res = resolveTrade(
      { direction, entry: a.plan.entry, stop: a.plan.stop, target: a.plan.target, maxBars: a.plan.maxBars },
      candles.slice(i + 1),
      costPct,
    );
    trades.push({
      direction,
      model: a.model,
      score: a.score,
      entryTime: candles[i].closeTime,
      entry: a.plan.entry,
      stop: a.plan.stop,
      target: a.plan.target,
      targetKind: a.plan.targetKind,
      exit: res?.exitPrice ?? null,
      status: res?.status ?? 'OPEN',
      rMultiple: res?.rMultiple ?? null,
      pnlPct: res?.pnlPct ?? null,
      bars: res?.barsHeld ?? null,
    });
    if (!res) break;
    const exitDay = Math.floor(res.exitTime / 86_400_000);
    dayR.set(exitDay, (dayR.get(exitDay) ?? 0) + res.rMultiple);
    i += res.barsHeld + cooldown;
  }

  const closed = trades.filter((t) => t.status !== 'OPEN');
  const wins = closed.filter((t) => t.status === 'WIN').length;
  const losses = closed.filter((t) => t.status === 'LOSS').length;
  const expired = closed.filter((t) => t.status === 'EXPIRED').length;
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let gain = 0;
  let loss = 0;
  for (const t of closed) {
    const r = t.rMultiple ?? 0;
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    if (r > 0) gain += r;
    else loss += -r;
  }
  return {
    trades,
    stats: {
      trades: closed.length,
      wins,
      losses,
      expired,
      winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
      expectancyR: closed.length > 0 ? eq / closed.length : 0,
      totalR: eq,
      profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : 0,
      maxDrawdownR: dd,
      avgBars: closed.length > 0 ? closed.reduce((s, t) => s + (t.bars ?? 0), 0) / closed.length : 0,
      setupsSeen,
      rejectCounts,
      skippedByDailyLimit,
    },
  };
}
