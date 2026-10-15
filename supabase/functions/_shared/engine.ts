// supabase/functions/_shared/engine.ts
//
// موتور تحلیل مشترک — تنها منبع حقیقت برای اسکن خودکار (سرور) و اسکنر دستی (مرورگر).
// Single source of truth for the signal engine. Used by:
//   - supabase/functions/scheduled-scan  (Deno)
//   - src/**                             (Vite, via the "@engine" alias)
//
// قانون: این فایل نباید هیچ import ای داشته باشد (نه Deno، نه npm).
// Rule: this file must stay dependency-free so it runs unchanged in both runtimes.

// =====================================================================
// Types
// =====================================================================

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  /** Aggressive-buyer volume (Binance kline field 9). Optional: used by the Fast Scalp delta filter only. */
  takerBuyVolume?: number;
}

export type SignalType = 'BUY' | 'SELL' | 'WAIT' | 'EXIT' | 'NO_TRADE';
export type Direction = 'LONG' | 'SHORT';
export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type MarketRegime =
  | 'BULLISH_TREND'
  | 'BEARISH_TREND'
  | 'RANGE'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'TRANSITION'
  | 'UNCLEAR';
export type StructureLabel =
  | 'HH_HL'
  | 'LH_LL'
  | 'RANGING'
  | 'BOS_BULLISH'
  | 'BOS_BEARISH'
  | 'CHOCH_BULLISH'
  | 'CHOCH_BEARISH'
  | 'UNDEFINED';

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
}

export interface SRLevel {
  price: number;
  /** Role relative to the last close at the time the levels were built. */
  type: 'SUPPORT' | 'RESISTANCE';
  strength: number;
  touches: number;
}

export interface RiskPlan {
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  /** Real reward/risk: reward is measured up to the first obstacle (S/R) or target1, whichever is closer. */
  riskReward: number;
  riskLevel: RiskLevel;
  /** Position size in coins, capped so notional never exceeds capital * maxPositionPct. */
  positionSize: number;
  /** Stop distance as a percentage of entry price. */
  riskPct: number;
  /** Nearest opposing S/R level price (resistance for longs, support for shorts) or null. */
  obstacle: number | null;
}

export interface RiskConfig {
  minRiskReward: number;
  riskPercent: number;
  capital: number;
  atrMultiplier: number;
  /** Minimum stop distance in ATRs (protects against stops sitting inside the noise). */
  minStopAtr: number;
  /** Max position notional as % of capital (100 = spot, no leverage). */
  maxPositionPct: number;
}

export interface ScoringWeights {
  trend: number;
  structure: number;
  momentum: number;
  volume: number;
  volatility: number;
  supportResistance: number;
  riskReward: number;
}

export interface SignalThresholds {
  strong: number;
  buy: number;
  watch: number;
}

// =====================================================================
// Constants
// =====================================================================

export const DEFAULT_WEIGHTS: ScoringWeights = {
  trend: 20,
  structure: 20,
  momentum: 15,
  volume: 15,
  volatility: 10,
  supportResistance: 10,
  riskReward: 10,
};

export const DEFAULT_THRESHOLDS: SignalThresholds = { strong: 80, buy: 70, watch: 60 };

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  minRiskReward: 2,
  riskPercent: 1,
  capital: 10000,
  atrMultiplier: 1.5,
  minStopAtr: 0.8,
  maxPositionPct: 100,
};

export const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

/** After this many bars without hitting stop/target a paper trade expires. */
export const EXPIRY_BARS: Record<string, number> = {
  '1m': 240,
  '5m': 144,
  '15m': 96,
  '30m': 96,
  '1h': 48,
  '4h': 30,
  '1d': 20,
  '1w': 12,
};

/**
 * ATR% considered "high volatility" for each timeframe. The old engine used a fixed 6% for every
 * timeframe, which blocked almost every altcoin on 1d and never filtered anything on 1h.
 */
const VOL_HIGH_PCT: Record<string, number> = {
  '1m': 0.8,
  '5m': 1.5,
  '15m': 2.5,
  '30m': 3.2,
  '1h': 4,
  '4h': 6,
  '1d': 10,
  '1w': 18,
};

export interface VolatilityProfile {
  high: number;
  ok: number;
  low: number;
  lowRisk: number;
  midRisk: number;
}

export function volatilityProfile(timeframe?: string): VolatilityProfile {
  const high = (timeframe && VOL_HIGH_PCT[timeframe]) || 6;
  return { high, ok: high * (5 / 6), low: high * 0.25, lowRisk: high / 3, midRisk: (high * 2) / 3 };
}

/** Round-trip trading cost (fees + slippage) in percent, deducted from every paper trade. */
export const TRADE_COST_PCT = 0.25;

// =====================================================================
// Symbols / quote assets (USDT pairs and BTC pairs share one engine)
// =====================================================================

/**
 * Quote currencies the scanner works with. A signal on ETHBTC is computed exactly like one on ETHUSDT:
 * same closed-candle engine, same scoring, same risk plan. Prices are simply measured in BTC.
 */
export type QuoteAsset = 'USDT' | 'BTC';
export const QUOTE_ASSETS: readonly QuoteAsset[] = ['USDT', 'BTC'];

/** Bare tickers that END in "BTC" but are base assets, not BTC pairs (so "WBTC" is not read as W/BTC). */
const BTC_SUFFIX_BASES = new Set(['WBTC', 'CBBTC', 'LBTC', 'TBTC', 'SOLVBTC', 'FBTC', 'UNIBTC', 'PUMPBTC']);

/** "ETHBTC" -> { base: "ETH", quote: "BTC" }; "SOLUSDT" -> { base: "SOL", quote: "USDT" }; bare tickers -> null. */
export function splitSymbol(symbol: string): { base: string; quote: QuoteAsset } | null {
  const s = String(symbol ?? '').toUpperCase().trim();
  if (s.length > 4 && s.endsWith('USDT')) return { base: s.slice(0, -4), quote: 'USDT' };
  if (s.length > 3 && s.endsWith('BTC') && !BTC_SUFFIX_BASES.has(s)) return { base: s.slice(0, -3), quote: 'BTC' };
  return null;
}

export function quoteOf(symbol: string): QuoteAsset {
  return splitSymbol(symbol)?.quote ?? 'USDT';
}

export function baseOf(symbol: string): string {
  return splitSymbol(symbol)?.base ?? String(symbol ?? '').toUpperCase().trim();
}

/** Full pair for any input: "eth" -> ETHUSDT, "ETHBTC" -> ETHBTC, "wbtc" -> WBTCUSDT. */
export function normalizeSymbol(input: string, defaultQuote: QuoteAsset = 'USDT'): string {
  const s = String(input ?? '').toUpperCase().trim();
  return splitSymbol(s) ? s : s + defaultQuote;
}

/** The same coin quoted in the other currency: ETHUSDT <-> ETHBTC. BTC itself has no BTC pair. */
export function counterpartSymbol(symbol: string): string | null {
  const p = splitSymbol(symbol);
  if (!p) return null;
  if (p.quote === 'USDT') return p.base === 'BTC' ? null : `${p.base}BTC`;
  return `${p.base}USDT`;
}

/** Decimals needed to show a price legibly: BTC pairs trade at 0.00001-0.1, USDT pairs at 0.0001-100000. */
export function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (!Number.isFinite(abs) || abs === 0) return 2;
  if (abs < 0.001) return 8;
  if (abs < 1) return 6;
  if (abs < 10) return 4;
  if (abs < 1000) return 2;
  return abs >= 1_000_000 ? 0 : 2;
}

// =====================================================================
// Candle helpers
// =====================================================================

/** Drops the still-forming candle so indicators never repaint. */
export function closedCandles(candles: Candle[], now = Date.now()): Candle[] {
  return candles.filter((c) => Number.isFinite(c.close) && c.closeTime < now);
}

export function timeframeMs(timeframe: string): number {
  return TIMEFRAME_MS[timeframe] ?? 3_600_000;
}

/** Close time (ms) of the most recent candle that must already be closed for this timeframe. */
export function lastBoundary(timeframe: string, now = Date.now()): number {
  const ms = timeframeMs(timeframe);
  if (timeframe === '1w') {
    // Binance weekly candles open on Monday 00:00 UTC; the epoch is a Thursday (+4 days offset).
    const offset = 4 * 86_400_000;
    return Math.floor((now - offset) / ms) * ms + offset;
  }
  return Math.floor(now / ms) * ms;
}

// =====================================================================
// Indicators
// =====================================================================

export function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = seed;
  for (let i = period; i < values.length; i++) {
    const prev = result[i - 1] as number;
    result[i] = values[i] * k + prev * (1 - k);
  }
  return result;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  const compute = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = compute(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    result[i] = compute(avgGain, avgLoss);
  }
  return result;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });
  const macdValues = macdLine.filter((v): v is number => v !== null);
  const firstValidIndex = macdLine.findIndex((v) => v !== null);
  const signalEma = firstValidIndex >= 0 ? ema(macdValues, signalPeriod) : [];
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  if (firstValidIndex >= 0) {
    for (let i = 0; i < signalEma.length; i++) signalLine[firstValidIndex + i] = signalEma[i];
  }
  const histogram = closes.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return m !== null && s !== null ? m - s : null;
  });
  return { macd: macdLine, signal: signalLine, histogram };
}

function trueRange(candles: Candle[], i: number): number {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const prevClose = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return result;
  const tr = candles.map((_, i) => trueRange(candles, i));
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prev = sum / period;
  result[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    result[i] = prev;
  }
  return result;
}

function wilderSmooth(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum;
  for (let i = period; i < values.length; i++) {
    const prev = result[i - 1] as number;
    result[i] = prev - prev / period + values[i];
  }
  return result;
}

export function adx(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period * 2) return result;
  const plusDm: number[] = [0];
  const minusDm: number[] = [0];
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(trueRange(candles, i));
  }
  const sTr = wilderSmooth(tr, period);
  const sP = wilderSmooth(plusDm, period);
  const sM = wilderSmooth(minusDm, period);
  const dx = candles.map((_, i) => {
    const t = sTr[i];
    const p = sP[i];
    const m = sM[i];
    if (t === null || p === null || m === null || t === 0) return null;
    const plusDi = (p / t) * 100;
    const minusDi = (m / t) * 100;
    const sum = plusDi + minusDi;
    return sum === 0 ? 0 : (Math.abs(plusDi - minusDi) / sum) * 100;
  });
  const dxValues = dx.filter((v): v is number => v !== null);
  const firstValidIndex = dx.findIndex((v) => v !== null);
  if (firstValidIndex < 0 || dxValues.length <= period) return result;
  const seed = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[firstValidIndex + period - 1] = seed;
  let prev = seed;
  for (let i = period; i < dxValues.length; i++) {
    prev = (prev * (period - 1) + dxValues[i]) / period;
    result[firstValidIndex + i] = prev;
  }
  return result;
}

export interface BollingerResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollingerBands(closes: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(sumSq / period);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { middle, upper, lower };
}

export function vwap(candles: Candle[]): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  let pv = 0;
  let vol = 0;
  let currentDay = -1;
  for (let i = 0; i < candles.length; i++) {
    const day = Math.floor(candles[i].openTime / 86_400_000);
    if (day !== currentDay) {
      currentDay = day;
      pv = 0;
      vol = 0;
    }
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    pv += typical * candles[i].volume;
    vol += candles[i].volume;
    result[i] = vol > 0 ? pv / vol : null;
  }
  return result;
}

export function volumeMovingAverage(volumes: number[], period = 20): (number | null)[] {
  return sma(volumes, period);
}

/** Volume divided by the average of the PREVIOUS `period` candles (the current one is excluded). */
export function relativeVolume(volumes: number[], period = 20): (number | null)[] {
  const result: (number | null)[] = new Array(volumes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < volumes.length; i++) {
    if (i >= period) {
      const avg = sum / period;
      result[i] = avg > 0 ? volumes[i] / avg : null;
      sum -= volumes[i - period];
    }
    sum += volumes[i];
  }
  return result;
}

// =====================================================================
// Market structure, support / resistance, regime
// =====================================================================

export function findSwingPoints(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  if (candles.length < lookback * 2 + 1) return points;
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) points.push({ index: i, time: candles[i].openTime, price: candles[i].high, type: 'HIGH' });
    if (isLow) points.push({ index: i, time: candles[i].openTime, price: candles[i].low, type: 'LOW' });
  }
  return points;
}

export function detectStructure(swings: SwingPoint[]): StructureLabel {
  if (swings.length < 4) return 'UNDEFINED';
  const highs = swings.filter((s) => s.type === 'HIGH').slice(-3);
  const lows = swings.filter((s) => s.type === 'LOW').slice(-3);
  if (highs.length < 2 || lows.length < 2) return 'UNDEFINED';
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];
  const higherHigh = lastHigh.price > prevHigh.price;
  const higherLow = lastLow.price > prevLow.price;
  const lowerHigh = lastHigh.price < prevHigh.price;
  const lowerLow = lastLow.price < prevLow.price;
  if (higherHigh && higherLow) return 'HH_HL';
  if (lowerHigh && lowerLow) return 'LH_LL';
  const recent = swings.slice(-6).map((s) => s.price);
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  if (min > 0 && (max - min) / min < 0.05) return 'RANGING';
  if (higherHigh && !higherLow) return 'BOS_BULLISH';
  if (lowerLow && !lowerHigh) return 'BOS_BEARISH';
  return 'RANGING';
}

/**
 * Builds S/R levels from ALL swing points pooled together. A level is a support when it is below the
 * last close and a resistance when above, so a broken resistance automatically becomes support
 * (role reversal). Recent touches weigh more than old ones.
 */
export function findSupportResistance(candles: Candle[], swings: SwingPoint[], tolerance = 0.015): SRLevel[] {
  if (swings.length === 0 || candles.length === 0) return [];
  const lastClose = candles[candles.length - 1].close;
  const lastIndex = Math.max(candles.length - 1, 1);
  const sorted = [...swings].sort((a, b) => a.price - b.price);

  const levels: SRLevel[] = [];
  let group: SwingPoint[] = [];
  let mean = 0;
  const flush = () => {
    if (group.length === 0) return;
    const price = group.reduce((s, p) => s + p.price, 0) / group.length;
    const weighted = group.reduce((s, p) => s + (0.5 + 0.5 * (p.index / lastIndex)), 0);
    levels.push({
      price,
      type: price > lastClose ? 'RESISTANCE' : 'SUPPORT',
      strength: Math.round(weighted * 10) / 10,
      touches: group.length,
    });
    group = [];
  };
  for (const p of sorted) {
    if (group.length === 0) {
      group.push(p);
      mean = p.price;
      continue;
    }
    if (Math.abs(p.price - mean) / mean <= tolerance) {
      group.push(p);
      mean = group.reduce((s, x) => s + x.price, 0) / group.length;
    } else {
      flush();
      group.push(p);
      mean = p.price;
    }
  }
  flush();
  return levels.sort((a, b) => b.strength - a.strength);
}

/** Nearest level strictly above price (role-agnostic). */
export function nearestResistance(levels: SRLevel[], price: number): number | null {
  let best: number | null = null;
  for (const l of levels) if (l.price > price && (best === null || l.price < best)) best = l.price;
  return best;
}

/** Nearest level strictly below price (role-agnostic). */
export function nearestSupport(levels: SRLevel[], price: number): number | null {
  let best: number | null = null;
  for (const l of levels) if (l.price < price && (best === null || l.price > best)) best = l.price;
  return best;
}

export interface RegimeResult {
  regime: MarketRegime;
  trend: TrendDirection;
  confidence: number;
  adx: number | null;
}

export function detectRegime(candles: Candle[], timeframe?: string): RegimeResult {
  if (candles.length < 50) return { regime: 'UNCLEAR', trend: 'NEUTRAL', confidence: 0, adx: null };
  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1];
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const atrValues = atr(candles, 14);
  const adxValues = adx(candles, 14);
  const l20 = e20[e20.length - 1];
  const l50 = e50[e50.length - 1];
  const l200 = e200[e200.length - 1];
  const lAtr = atrValues[atrValues.length - 1];
  const lAdx = adxValues[adxValues.length - 1];
  if (l20 === null || l50 === null || l200 === null || lAtr === null) {
    return { regime: 'UNCLEAR', trend: 'NEUTRAL', confidence: 0, adx: lAdx };
  }
  const vp = volatilityProfile(timeframe);
  const atrPct = (lAtr / lastClose) * 100;
  const isHigh = atrPct > vp.high;
  const isLow = atrPct < vp.low;

  let trend: TrendDirection = 'NEUTRAL';
  if (l20 > l50 && l50 > l200 && lastClose > l200) trend = 'BULLISH';
  else if (l20 < l50 && l50 < l200 && lastClose < l200) trend = 'BEARISH';

  const adxStrong = lAdx !== null && lAdx > 25;
  const adxWeak = lAdx !== null && lAdx < 20;

  let regime: MarketRegime = 'UNCLEAR';
  let confidence = 30;
  if (isHigh) {
    regime = 'HIGH_VOLATILITY';
    confidence = 60;
  } else if (trend === 'BULLISH' && adxStrong) {
    regime = 'BULLISH_TREND';
    confidence = 80;
  } else if (trend === 'BEARISH' && adxStrong) {
    regime = 'BEARISH_TREND';
    confidence = 80;
  } else if (trend === 'NEUTRAL' || adxWeak) {
    regime = 'RANGE';
    confidence = 60;
  } else if (isLow) {
    regime = 'LOW_VOLATILITY';
    confidence = 50;
  } else if (trend === 'BULLISH' || trend === 'BEARISH') {
    regime = 'TRANSITION';
    confidence = 40;
  }
  return { regime, trend, confidence, adx: lAdx };
}

// =====================================================================
// Risk plan
// =====================================================================

export function classifyRiskLevel(atrValue: number, price: number, timeframe?: string): RiskLevel {
  const vp = volatilityProfile(timeframe);
  const atrPct = (atrValue / price) * 100;
  if (atrPct < vp.lowRisk) return 'LOW';
  if (atrPct < vp.midRisk) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Builds a long or short plan.
 *  - Stop = ATR stop, tightened to the nearest structure level only when that level is at least
 *    `minStopAtr` ATRs away (a stop inside the noise is just a donation).
 *  - Targets are 2R / 3R / 5R.
 *  - riskReward is the REAL reward/risk: reward is clipped at the first opposing S/R level.
 *    (The old engine always reported 2.0, which made the R/R filter meaningless.)
 *  - Position size is capped so the notional never exceeds capital * maxPositionPct.
 */
export function computeRiskPlan(
  direction: Direction,
  candles: Candle[],
  levels: SRLevel[],
  atrValue: number | null,
  config: RiskConfig,
  timeframe?: string,
): RiskPlan | null {
  if (candles.length === 0 || atrValue === null || !(atrValue > 0)) return null;
  const price = candles[candles.length - 1].close;
  if (!(price > 0)) return null;
  const sign = direction === 'LONG' ? 1 : -1;

  const atrStop = atrValue * config.atrMultiplier;
  const minStop = atrValue * config.minStopAtr;
  let stopDistance = Math.max(atrStop, minStop);

  const structureLevel = direction === 'LONG' ? nearestSupport(levels, price) : nearestResistance(levels, price);
  if (structureLevel !== null) {
    const structDistance = direction === 'LONG' ? price - structureLevel * 0.998 : structureLevel * 1.002 - price;
    if (structDistance > 0 && structDistance < stopDistance) stopDistance = Math.max(structDistance, minStop);
  }

  const stopLoss = price - sign * stopDistance;
  if (direction === 'LONG' && stopLoss <= 0) return null;

  const target1 = price + sign * stopDistance * 2;
  const target2 = price + sign * stopDistance * 3;
  const target3 = price + sign * stopDistance * 5;

  const obstacle = direction === 'LONG' ? nearestResistance(levels, price) : nearestSupport(levels, price);
  const fullReward = stopDistance * 2;
  const obstacleReward = obstacle === null ? Infinity : Math.abs(obstacle - price) * 0.995;
  const reward = Math.min(fullReward, obstacleReward);
  const riskReward = reward / stopDistance;

  const riskAmount = config.capital * (config.riskPercent / 100);
  const bySize = riskAmount / stopDistance;
  const byCap = (config.capital * (config.maxPositionPct / 100)) / price;
  const positionSize = Math.min(bySize, byCap);

  return {
    entryLow: direction === 'LONG' ? price : price - atrValue * 0.3,
    entryHigh: direction === 'LONG' ? price + atrValue * 0.3 : price,
    invalidation: stopLoss,
    stopLoss,
    target1,
    target2,
    target3,
    riskReward,
    riskLevel: classifyRiskLevel(atrValue, price, timeframe),
    positionSize,
    riskPct: (stopDistance / price) * 100,
    obstacle,
  };
}

export function isResistanceTooClose(levels: SRLevel[], price: number, threshold = 0.02): boolean {
  const r = nearestResistance(levels, price);
  if (r === null) return false;
  const d = (r - price) / price;
  return d > 0 && d < threshold;
}

export function isSupportTooClose(levels: SRLevel[], price: number, threshold = 0.02): boolean {
  const s = nearestSupport(levels, price);
  if (s === null) return false;
  const d = (price - s) / price;
  return d > 0 && d < threshold;
}

// =====================================================================
// Scoring engine
// =====================================================================

export interface AnalyzeOptions {
  timeframe?: string;
  weights?: Partial<ScoringWeights>;
  thresholds?: Partial<SignalThresholds>;
  riskConfig?: Partial<RiskConfig>;
  /** When false, bearish setups never produce SELL (they can still be WAIT). Default true. */
  allowShort?: boolean;
}

export interface FactorState {
  key: 'trend' | 'structure' | 'momentum' | 'volume' | 'volatility' | 'support_resistance' | 'risk_reward';
  positive: boolean;
  weight: number;
}

export interface CoreAnalysis {
  signalType: SignalType;
  bias: Direction;
  score: number;
  bullScore: number;
  bearScore: number;
  regime: MarketRegime;
  trend: TrendDirection;
  structure: StructureLabel;
  riskLevel: RiskLevel;
  price: number;
  /** Close time of the last candle used (ms). */
  candleCloseTime: number;
  rsi: number | null;
  atrPct: number | null;
  relVolume: number | null;
  adx: number | null;
  /** Plan of the signal's direction (for WAIT/NO_TRADE: plan of the dominant side). */
  risk: RiskPlan | null;
  longPlan: RiskPlan | null;
  shortPlan: RiskPlan | null;
  levels: SRLevel[];
  bullFactors: FactorState[];
  bearFactors: FactorState[];
  /** Bilingual reason pairs: [fa, en, fa, en, ...] */
  reasons: string[];
}

function bucketRr(rr: number): number {
  return rr >= 3 ? 100 : rr >= 2 ? 80 : rr >= 1.5 ? 50 : 20;
}

/**
 * Analyses CLOSED candles. Pass them through closedCandles() first if they may contain the forming candle.
 */
export function analyzeCore(candles: Candle[], options: AnalyzeOptions = {}): CoreAnalysis | null {
  if (candles.length < 50) return null;

  const weights: ScoringWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const thresholds: SignalThresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const riskConfig: RiskConfig = { ...DEFAULT_RISK_CONFIG, ...options.riskConfig };
  const allowShort = options.allowShort !== false;
  const tf = options.timeframe;
  const vp = volatilityProfile(tf);

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];
  const lastClose = last.close;

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const rsiValues = rsi(closes, 14);
  const macdResult = macd(closes);
  const atrValues = atr(candles, 14);
  const relVol = relativeVolume(volumes, 20);

  const l20 = e20[e20.length - 1];
  const l50 = e50[e50.length - 1];
  const l200 = e200[e200.length - 1];
  const lRsi = rsiValues[rsiValues.length - 1];
  const lMacd = macdResult.macd[macdResult.macd.length - 1];
  const lSignal = macdResult.signal[macdResult.signal.length - 1];
  const lHist = macdResult.histogram[macdResult.histogram.length - 1];
  const lAtr = atrValues[atrValues.length - 1];
  const lRelVol = relVol[relVol.length - 1];

  const swings = findSwingPoints(candles, 3);
  const structure = detectStructure(swings);
  const levels = findSupportResistance(candles, swings);
  const regimeResult = detectRegime(candles, tf);

  const reasons: string[] = [];

  // ---------- bullish side ----------
  let trendBull = 0;
  if (l20 !== null && l50 !== null && l20 > l50) trendBull += 40;
  if (l50 !== null && l200 !== null && l50 > l200) trendBull += 30;
  if (l20 !== null && lastClose > l20) trendBull += 30;
  if (l20 !== null && l50 !== null && l20 < l50) trendBull -= 20;
  if (l50 !== null && l200 !== null && l50 < l200) trendBull -= 20;
  trendBull = Math.max(0, Math.min(100, trendBull));
  const trendBullish = regimeResult.trend === 'BULLISH';

  const structureBull = structure === 'HH_HL' || structure === 'BOS_BULLISH' ? 80 : structure === 'LH_LL' || structure === 'BOS_BEARISH' ? 20 : structure === 'RANGING' ? 40 : 30;
  const structureBullish = structure === 'HH_HL' || structure === 'BOS_BULLISH';

  let momBull = 0;
  if (lRsi !== null) {
    if (lRsi > 50 && lRsi < 70) momBull += 50;
    else if (lRsi >= 70) momBull += 30;
    else if (lRsi < 30) momBull += 20;
    else momBull += 35;
  }
  if (lMacd !== null && lSignal !== null && lMacd > lSignal) momBull += 30;
  else momBull -= 10;
  if (lHist !== null && lHist > 0) momBull += 20;
  else momBull -= 10;
  momBull = Math.max(0, Math.min(100, momBull));
  const momentumBullish = lRsi !== null && lRsi > 50 && lMacd !== null && lSignal !== null && lMacd > lSignal;

  // ---------- bearish side (mirror) ----------
  let trendBear = 0;
  if (l20 !== null && l50 !== null && l20 < l50) trendBear += 40;
  if (l50 !== null && l200 !== null && l50 < l200) trendBear += 30;
  if (l20 !== null && lastClose < l20) trendBear += 30;
  if (l20 !== null && l50 !== null && l20 > l50) trendBear -= 20;
  if (l50 !== null && l200 !== null && l50 > l200) trendBear -= 20;
  trendBear = Math.max(0, Math.min(100, trendBear));
  const trendBearish = regimeResult.trend === 'BEARISH';

  const structureBear = structure === 'LH_LL' || structure === 'BOS_BEARISH' ? 80 : structure === 'HH_HL' || structure === 'BOS_BULLISH' ? 20 : structure === 'RANGING' ? 40 : 30;
  const structureBearish = structure === 'LH_LL' || structure === 'BOS_BEARISH';

  let momBear = 0;
  if (lRsi !== null) {
    if (lRsi < 50 && lRsi > 30) momBear += 50;
    else if (lRsi <= 30) momBear += 30;
    else if (lRsi >= 70) momBear += 20;
    else momBear += 35;
  }
  if (lMacd !== null && lSignal !== null && lMacd < lSignal) momBear += 30;
  else momBear -= 10;
  if (lHist !== null && lHist < 0) momBear += 20;
  else momBear -= 10;
  momBear = Math.max(0, Math.min(100, momBear));
  const momentumBearish = lRsi !== null && lRsi < 50 && lMacd !== null && lSignal !== null && lMacd < lSignal;

  // ---------- direction-agnostic ----------
  let volumeScore = 0;
  if (lRelVol !== null) volumeScore = lRelVol > 1.5 ? 80 : lRelVol > 1.0 ? 60 : lRelVol > 0.7 ? 40 : 20;
  const volumeConfirming = lRelVol !== null && lRelVol > 1.0;

  const atrPct = lAtr !== null ? (lAtr / lastClose) * 100 : null;
  let volatilityScore = 0;
  if (atrPct !== null) {
    const ratio = atrPct / vp.high;
    volatilityScore = ratio < 1 / 3 ? 80 : ratio < 2 / 3 ? 60 : ratio < 1 ? 40 : 20;
  }
  const volatilityOk = atrPct !== null && atrPct < vp.ok;

  // ---------- plans, S/R and R/R ----------
  const longPlan = computeRiskPlan('LONG', candles, levels, lAtr, riskConfig, tf);
  const shortPlan = computeRiskPlan('SHORT', candles, levels, lAtr, riskConfig, tf);

  const resistance = nearestResistance(levels, lastClose);
  const support = nearestSupport(levels, lastClose);
  const distScore = (d: number) => (d > 0.05 ? 80 : d > 0.02 ? 60 : 30);
  const srBull = resistance !== null ? distScore((resistance - lastClose) / lastClose) : 50;
  const srBear = support !== null ? distScore((lastClose - support) / lastClose) : 50;

  const rrBull = longPlan ? bucketRr(longPlan.riskReward) : 0;
  const rrBear = shortPlan ? bucketRr(shortPlan.riskReward) : 0;
  const rrOkLong = longPlan !== null && longPlan.riskReward >= riskConfig.minRiskReward;
  const rrOkShort = shortPlan !== null && shortPlan.riskReward >= riskConfig.minRiskReward;

  const total = (trend: number, struct: number, mom: number, sr: number, rr: number) =>
    Math.round(
      (trend / 100) * weights.trend +
        (struct / 100) * weights.structure +
        (mom / 100) * weights.momentum +
        (volumeScore / 100) * weights.volume +
        (volatilityScore / 100) * weights.volatility +
        (sr / 100) * weights.supportResistance +
        (rr / 100) * weights.riskReward,
    );
  const bullTotal = total(trendBull, structureBull, momBull, srBull, rrBull);
  const bearTotal = total(trendBear, structureBear, momBear, srBear, rrBear);

  const srOkLong = resistance === null || (resistance - lastClose) / lastClose > 0.02;
  const srOkShort = support === null || (lastClose - support) / lastClose > 0.02;

  const bullFactors: FactorState[] = [
    { key: 'trend', positive: trendBullish, weight: weights.trend },
    { key: 'structure', positive: structureBullish, weight: weights.structure },
    { key: 'momentum', positive: momentumBullish, weight: weights.momentum },
    { key: 'volume', positive: volumeConfirming, weight: weights.volume },
    { key: 'volatility', positive: volatilityOk, weight: weights.volatility },
    { key: 'support_resistance', positive: srOkLong, weight: weights.supportResistance },
    { key: 'risk_reward', positive: rrOkLong, weight: weights.riskReward },
  ];
  const bearFactors: FactorState[] = [
    { key: 'trend', positive: trendBearish, weight: weights.trend },
    { key: 'structure', positive: structureBearish, weight: weights.structure },
    { key: 'momentum', positive: momentumBearish, weight: weights.momentum },
    { key: 'volume', positive: volumeConfirming, weight: weights.volume },
    { key: 'volatility', positive: volatilityOk, weight: weights.volatility },
    { key: 'support_resistance', positive: srOkShort, weight: weights.supportResistance },
    { key: 'risk_reward', positive: rrOkShort, weight: weights.riskReward },
  ];

  // ---------- decision ----------
  const longSide = bullTotal >= bearTotal;
  const regime = regimeResult.regime;
  const blocked = regime === 'UNCLEAR' || regime === 'HIGH_VOLATILITY' || !volatilityOk;
  // RANGE here means "EMAs not aligned or ADX < 20": choppy markets may form a setup (WAIT) but never trigger one.
  const entryAllowed = regime !== 'RANGE';

  const bullSetupOk = longPlan !== null && rrOkLong && bullTotal >= thresholds.buy && trendBullish && structureBullish && momentumBullish && volumeConfirming;
  const bearSetupOk = allowShort && shortPlan !== null && rrOkShort && bearTotal >= thresholds.buy && trendBearish && structureBearish && momentumBearish && volumeConfirming;

  let signalType: SignalType;
  let score: number;
  let plan: RiskPlan | null;

  if (blocked) {
    signalType = 'NO_TRADE';
    score = Math.max(bullTotal, bearTotal);
    plan = longSide ? longPlan : shortPlan;
    if (regime === 'HIGH_VOLATILITY' || !volatilityOk) reasons.push('نوسان نامناسب', 'Inappropriate volatility');
    else reasons.push('رژیم بازار نامشخص', 'Unclear market regime');
  } else if (bullSetupOk && entryAllowed && !isResistanceTooClose(levels, lastClose)) {
    signalType = 'BUY';
    score = bullTotal;
    plan = longPlan;
    if (score >= thresholds.strong) reasons.push('ستاپ قوی', 'Strong setup');
  } else if (bearSetupOk && entryAllowed && !isSupportTooClose(levels, lastClose)) {
    signalType = 'SELL';
    score = bearTotal;
    plan = shortPlan;
    if (score >= thresholds.strong) reasons.push('ستاپ قوی', 'Strong setup');
  } else {
    score = longSide ? bullTotal : bearTotal;
    plan = longSide ? longPlan : shortPlan;
    const planOk = longSide ? rrOkLong : rrOkShort;
    const tooClose = longSide ? isResistanceTooClose(levels, lastClose) : isSupportTooClose(levels, lastClose);
    if (planOk && !tooClose && score >= thresholds.watch) {
      signalType = 'WAIT';
      reasons.push(entryAllowed ? 'ستاپ در حال شکل‌گیری' : 'بازار رنج/بدون روند قوی', entryAllowed ? 'Setup forming' : 'Choppy market, no strong trend');
    } else {
      signalType = 'NO_TRADE';
      if (!planOk) reasons.push('ریسک/بازده نامناسب', 'Bad risk/reward');
      else if (tooClose) reasons.push('سطح مقابل نزدیک است', 'Opposing level too close');
      else reasons.push('امتیاز پایین', 'Low confluence score');
    }
  }

  return {
    signalType,
    bias: longSide ? 'LONG' : 'SHORT',
    score,
    bullScore: bullTotal,
    bearScore: bearTotal,
    regime,
    trend: regimeResult.trend,
    structure,
    riskLevel: plan?.riskLevel ?? (lAtr !== null ? classifyRiskLevel(lAtr, lastClose, tf) : 'HIGH'),
    price: lastClose,
    candleCloseTime: last.closeTime,
    rsi: lRsi,
    atrPct,
    relVolume: lRelVol,
    adx: regimeResult.adx,
    risk: plan,
    longPlan,
    shortPlan,
    levels,
    bullFactors,
    bearFactors,
    reasons,
  };
}

// =====================================================================
// Trade resolution (shared by Signal Lab on the server and the backtest)
// =====================================================================

export interface TradeInput {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  maxBars: number;
}

export interface TradeResolution {
  status: 'WIN' | 'LOSS' | 'EXPIRED';
  exitPrice: number;
  exitTime: number;
  barsHeld: number;
  /** Net of costs, in percent of entry. */
  pnlPct: number;
  grossPnlPct: number;
  /** Net result in units of initial risk. */
  rMultiple: number;
}

/**
 * Walks CLOSED candles that come AFTER the signal candle.
 * - Stop is checked before target inside the same bar (conservative).
 * - A gap through the stop exits at the open, not at the stop price.
 * Returns null while the trade is still open.
 */
export function resolveTrade(
  input: TradeInput,
  candlesAfter: Candle[],
  costPct: number = TRADE_COST_PCT,
): TradeResolution | null {
  const { direction, entry, stop, target, maxBars } = input;
  const sign = direction === 'LONG' ? 1 : -1;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || !(entry > 0)) return null;

  const finish = (status: TradeResolution['status'], exit: number, c: Candle, bars: number): TradeResolution => {
    const gross = ((exit - entry) / entry) * 100 * sign;
    const net = gross - costPct;
    const rMultiple = (sign * (exit - entry)) / risk - (entry * (costPct / 100)) / risk;
    return { status, exitPrice: exit, exitTime: c.closeTime, barsHeld: bars, pnlPct: net, grossPnlPct: gross, rMultiple };
  };

  for (let i = 0; i < candlesAfter.length; i++) {
    const c = candlesAfter[i];
    const hitStop = direction === 'LONG' ? c.low <= stop : c.high >= stop;
    const hitTarget = direction === 'LONG' ? c.high >= target : c.low <= target;
    if (hitStop) {
      const gapped = direction === 'LONG' ? c.open < stop : c.open > stop;
      return finish('LOSS', gapped ? c.open : stop, c, i + 1);
    }
    if (hitTarget) return finish('WIN', target, c, i + 1);
    if (i + 1 >= maxBars) return finish('EXPIRED', c.close, c, i + 1);
  }
  return null;
}
