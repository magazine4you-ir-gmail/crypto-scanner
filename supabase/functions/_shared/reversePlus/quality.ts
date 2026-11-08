// Reverse Signal Plus — Entry Quality Score (0..100), explainable and look-ahead safe.
//
// IMPORTANT: this score is a HEURISTIC INDEX, not a probability of winning. The weights below are
// hypotheses. Whether a score of 80 really performs better than 60 must be verified with the module's own
// recorded results (see "performance by Entry Quality Score"). Any change of weights MUST bump QUALITY_VERSION
// so stored scores stay comparable.
//
// Indicators and levels are read from the engine (read-only). The score is evaluated for the direction of the
// REVERSE trade: e.g. a strong trend in the ORIGINAL direction is a negative for the reverse trade.
//
// No look-ahead: only candles with closeTime <= asOfCloseTime are used.
import { analyzeCore, macd } from '../engine.ts';
import type { Candle } from '../engine.ts';
import type { Side, BilingualText } from './types.ts';

export const QUALITY_VERSION = 'rpq-1';

export type QualityGrade = 'HIGH' | 'REVIEW' | 'CAUTION' | 'NO_ENTRY' | 'INSUFFICIENT_DATA';

export interface QualityFactor {
  key: 'adx' | 'atr' | 'rsi' | 'macd' | 'structure' | 'volume' | 'distance' | 'supportResistance' | 'candle';
  max: number;
  earned: number;
  available: boolean;
  reason: BilingualText;
}

export interface QualityResult {
  version: string;
  score: number | null;
  grade: QualityGrade;
  /** share of the maximum weight that could be evaluated (data availability) */
  coverage: number;
  asOfCloseTime: number | null;
  factors: QualityFactor[];
  note: BilingualText;
}

export const QUALITY_MAX: Record<QualityFactor['key'], number> = {
  adx: 15,
  atr: 5,
  rsi: 15,
  macd: 10,
  structure: 15,
  volume: 5,
  distance: 10,
  supportResistance: 15,
  candle: 10,
};

export function gradeOf(score: number): QualityGrade {
  return score >= 80 ? 'HIGH' : score >= 65 ? 'REVIEW' : score >= 50 ? 'CAUTION' : 'NO_ENTRY';
}

const NOTE: BilingualText = {
  fa: 'این امتیاز یک شاخص اکتشافی برای کیفیت ورود است، نه احتمال برد. اعتبار آن باید با نتایج واقعی ثبت‌شده سنجیده شود.',
  en: 'A heuristic entry-quality index, not a win probability. Its validity must be checked against the recorded results.',
};

export interface QualityInput {
  /** Candles of the symbol/timeframe, ascending. Anything closing after `asOfCloseTime` is ignored. */
  candles: Candle[];
  asOfCloseTime: number;
  timeframe: string;
  /** Direction of the reverse trade. */
  side: Side;
  /** Recommended entry (from the entry-zone analysis) and the unchanged reverse levels, as numbers (heuristics only). */
  recommendedEntry: number | null;
  stop: number;
  target: number;
}

export function computeEntryQuality(input: QualityInput): QualityResult {
  const candles = input.candles.filter((c) => c.closeTime <= input.asOfCloseTime && Number.isFinite(c.close));
  const a = analyzeCore(candles, { timeframe: input.timeframe });
  const insufficient = (): QualityResult => ({
    version: QUALITY_VERSION,
    score: null,
    grade: 'INSUFFICIENT_DATA',
    coverage: 0,
    asOfCloseTime: candles.length ? candles[candles.length - 1].closeTime : null,
    factors: [],
    note: NOTE,
  });
  if (!a || candles.length < 50) return insufficient();

  const last = candles[candles.length - 1];
  const price = last.close;
  const bearishReverse = input.side === 'SELL';
  const sign = bearishReverse ? -1 : 1; // evidence for the reverse trade = sign * (bullish measure)
  const factors: QualityFactor[] = [];
  const add = (key: QualityFactor['key'], earned: number | null, fa: string, en: string) =>
    factors.push({
      key,
      max: QUALITY_MAX[key],
      earned: earned === null ? 0 : Math.max(0, Math.min(QUALITY_MAX[key], earned)),
      available: earned !== null,
      reason: { fa, en },
    });

  // 1. ADX + trend (a trend against the reverse trade is a negative)
  const trendAgainst =
    (sign > 0 && a.trend === 'BEARISH') || (sign < 0 && a.trend === 'BULLISH');
  if (a.adx === null) add('adx', null, 'ADX در دسترس نیست', 'ADX unavailable');
  else if (!trendAgainst && a.trend !== 'NEUTRAL')
    add('adx', 15, 'روند هم‌جهت با معامله معکوس است', 'Trend agrees with the reverse trade');
  else if (a.trend === 'NEUTRAL') add('adx', a.adx < 20 ? 12 : 8, 'روند خنثی', 'Neutral trend');
  else if (a.adx < 20) add('adx', 12, 'روند ضعیف (ADX<20) علیه معامله معکوس', 'Weak counter-trend (ADX<20)');
  else if (a.adx < 25) add('adx', 8, 'روند در حال شکل‌گیری علیه معامله معکوس', 'Counter-trend forming (ADX 20–25)');
  else if (a.adx < 35) add('adx', 3, 'روند قوی علیه معامله معکوس', 'Strong counter-trend (ADX 25–35)');
  else add('adx', 0, 'روند بسیار قوی علیه معامله معکوس', 'Very strong counter-trend (ADX>35)');

  // 2. ATR / volatility regime
  if (a.riskLevel === 'MEDIUM') add('atr', 5, 'نوسان متعادل', 'Balanced volatility');
  else if (a.riskLevel === 'LOW') add('atr', 4, 'نوسان کم', 'Low volatility');
  else add('atr', 1, 'نوسان بالا', 'High volatility');

  // 3. RSI — exhaustion in the ORIGINAL direction supports the reverse trade
  if (a.rsi === null) add('rsi', null, 'RSI در دسترس نیست', 'RSI unavailable');
  else {
    const v = bearishReverse ? a.rsi : 100 - a.rsi;
    const pts = v >= 70 ? 15 : v >= 62 ? 11 : v >= 55 ? 6 : v >= 48 ? 2 : 0;
    add('rsi', pts, `RSI=${a.rsi.toFixed(0)}`, `RSI=${a.rsi.toFixed(0)}`);
  }

  // 4. MACD histogram — momentum turning towards the reverse direction
  const closes = candles.map((c) => c.close);
  const hist = macd(closes).histogram;
  const h = hist[hist.length - 1];
  const hp = hist[hist.length - 2];
  if (h === null || h === undefined || hp === null || hp === undefined) add('macd', null, 'MACD در دسترس نیست', 'MACD unavailable');
  else {
    const slope = sign * (h - hp);
    const level = sign * h;
    if (slope > 0 && level > 0) add('macd', 10, 'مومنتوم به نفع معامله معکوس', 'Momentum favours the reverse trade');
    else if (slope > 0) add('macd', 7, 'مومنتوم در حال چرخش', 'Momentum turning');
    else if (level > 0) add('macd', 5, 'مومنتوم کند می‌شود', 'Momentum fading');
    else add('macd', 0, 'مومنتوم علیه معامله معکوس', 'Momentum against the reverse trade');
  }

  // 5. Market structure
  const struct = a.structure;
  const bearishMap: Record<string, number> = {
    CHOCH_BEARISH: 15, BOS_BEARISH: 12, LH_LL: 10, RANGING: 6, HH_HL: 2, BOS_BULLISH: 1, CHOCH_BULLISH: 0,
  };
  const bullishMap: Record<string, number> = {
    CHOCH_BULLISH: 15, BOS_BULLISH: 12, HH_HL: 10, RANGING: 6, LH_LL: 2, BOS_BEARISH: 1, CHOCH_BEARISH: 0,
  };
  const sp = (bearishReverse ? bearishMap : bullishMap)[struct];
  if (sp === undefined) add('structure', null, 'ساختار بازار نامشخص', 'Structure undefined');
  else add('structure', sp, `ساختار: ${struct}`, `Structure: ${struct}`);

  // 6. Volume confirmation (weak evidence for reversals, hence the small weight)
  if (a.relVolume === null) add('volume', null, 'حجم در دسترس نیست', 'Volume unavailable');
  else add('volume', a.relVolume >= 1.5 ? 5 : a.relVolume >= 1 ? 3 : 1, `حجم نسبی ${a.relVolume.toFixed(2)}×`, `Relative volume ${a.relVolume.toFixed(2)}×`);

  // 7. Distance of the price from the recommended entry, in ATRs
  const atrAbs = a.atrPct !== null ? (a.atrPct / 100) * price : null;
  if (input.recommendedEntry === null || atrAbs === null || !(atrAbs > 0)) {
    add('distance', null, 'فاصله تا ورود قابل محاسبه نیست', 'Distance to entry unavailable');
  } else {
    const d = Math.abs(price - input.recommendedEntry) / atrAbs;
    add('distance', d <= 0.3 ? 10 : d <= 1 ? 7 : d <= 2 ? 3 : 0, `${d.toFixed(2)} ATR تا ورود`, `${d.toFixed(2)} ATR to entry`);
  }

  // 8. Existing support/resistance on the REWARD path (levels are read, never changed)
  const entry = input.recommendedEntry ?? price;
  const lo = Math.min(entry, input.target);
  const hi = Math.max(entry, input.target);
  const reward = Math.abs(input.target - entry);
  const inPath = a.levels.filter((l) => l.price > lo && l.price < hi);
  if (!(reward > 0)) add('supportResistance', null, 'مسیر سود نامعتبر', 'Invalid reward path');
  else if (inPath.length === 0) add('supportResistance', 15, 'مانعی تا حد سود نیست', 'No S/R obstacle before the target');
  else {
    const frac = Math.min(...inPath.map((l) => Math.abs(l.price - entry) / reward));
    if (frac >= 0.7) add('supportResistance', 12, 'مانع نزدیک حد سود', 'Obstacle close to the target');
    else if (frac >= 0.4) add('supportResistance', 7, 'مانع در میانهٔ مسیر سود', 'Obstacle mid-way to the target');
    else add('supportResistance', 2, 'مانع نزدیک ورود', 'Obstacle right after the entry');
  }

  // 9. Confirmation candle (last CLOSED candle at asOf)
  const range = last.high - last.low;
  if (!(range > 0)) add('candle', null, 'کندل تأیید در دسترس نیست', 'Confirmation candle unavailable');
  else {
    const body = Math.abs(last.close - last.open) / range;
    const towards = bearishReverse ? last.close < last.open : last.close > last.open;
    const wick = bearishReverse ? (last.high - Math.max(last.open, last.close)) / range : (Math.min(last.open, last.close) - last.low) / range;
    if (towards && wick >= 0.4) add('candle', 10, 'کندل رد قیمت (سایه بلند)', 'Rejection candle (long wick)');
    else if (towards && body >= 0.5) add('candle', 8, 'کندل قوی در جهت معکوس', 'Strong candle in the reverse direction');
    else if (body < 0.2) add('candle', 4, 'کندل خنثی', 'Indecision candle');
    else if (!towards && body >= 0.6) add('candle', 0, 'کندل قوی علیه معامله معکوس', 'Strong candle against the reverse trade');
    else add('candle', 2, 'کندل ضعیف علیه معامله معکوس', 'Weak candle against the reverse trade');
  }

  const availableMax = factors.filter((f) => f.available).reduce((s, f) => s + f.max, 0);
  const earned = factors.filter((f) => f.available).reduce((s, f) => s + f.earned, 0);
  const coverage = availableMax / 100;
  if (coverage < 0.6) {
    return { version: QUALITY_VERSION, score: null, grade: 'INSUFFICIENT_DATA', coverage, asOfCloseTime: last.closeTime, factors, note: NOTE };
  }
  const score = Math.round((earned / availableMax) * 100);
  return { version: QUALITY_VERSION, score, grade: gradeOf(score), coverage, asOfCloseTime: last.closeTime, factors, note: NOTE };
}
