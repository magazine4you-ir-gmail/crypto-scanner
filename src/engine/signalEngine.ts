import type { Candle } from '@/types/market';
import type {
  SignalResult,
  SignalType,
  ScoreBreakdown,
  ConfluenceFactor,
  ScoringWeights,
  SignalThresholds,
  RiskPlan,
} from '@/types/signal';
import { ema } from './indicators/movingAverage';
import { rsi } from './indicators/rsi';
import { macd } from './indicators/macd';
import { atr } from './indicators/atr';
import { bollingerBands } from './indicators/bollinger';
import { vwap } from './indicators/vwap';
import { volumeMovingAverage, relativeVolume } from './indicators/volume';
import { adx } from './indicators/adx';
import { findSwingPoints, detectStructure } from './marketStructure';
import { findSupportResistance, nearestResistance } from './supportResistance';
import { detectRegime } from './regime';
import { computeRiskPlan, isResistanceTooClose, type RiskConfig } from './risk';

export const DEFAULT_WEIGHTS: ScoringWeights = {
  trend: 20,
  structure: 20,
  momentum: 15,
  volume: 15,
  volatility: 10,
  supportResistance: 10,
  riskReward: 10,
};

export const DEFAULT_THRESHOLDS: SignalThresholds = {
  strong: 80,
  buy: 70,
  watch: 60,
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  minRiskReward: 2,
  riskPercent: 1,
  capital: 10000,
  atrMultiplier: 1.5,
};

export interface AnalyzeOptions {
  weights?: ScoringWeights;
  thresholds?: SignalThresholds;
  riskConfig?: RiskConfig;
}

export function analyze(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  options: AnalyzeOptions = {},
): SignalResult {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const riskConfig = { ...DEFAULT_RISK_CONFIG, ...options.riskConfig };

  const reasons: string[] = [];
  const factors: ConfluenceFactor[] = [];

  if (candles.length < 50) {
    return buildNoTrade(
      symbol,
      timeframe,
      candles,
      'UNCLEAR',
      'NEUTRAL',
      'UNDEFINED',
      'HIGH',
      [],
      ['داده کافی نیست', 'Insufficient data'],
      0,
      false,
    );
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const lastClose = closes[closes.length - 1];

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiValues = rsi(closes, 14);
  const macdResult = macd(closes);
  const atrValues = atr(candles, 14);
  const bb = bollingerBands(closes, 20, 2);
  const vwapValues = vwap(candles);
  const volMa = volumeMovingAverage(volumes, 20);
  const relVol = relativeVolume(volumes, 20);
  const adxValues = adx(candles, 14);

  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastEma200 = ema200[ema200.length - 1];
  const lastRsi = rsiValues[rsiValues.length - 1];
  const lastMacd = macdResult.macd[macdResult.macd.length - 1];
  const lastSignal = macdResult.signal[macdResult.signal.length - 1];
  const lastHist = macdResult.histogram[macdResult.histogram.length - 1];
  const lastAtr = atrValues[atrValues.length - 1];
  const lastBbUpper = bb.upper[bb.upper.length - 1];
  const lastBbLower = bb.lower[bb.lower.length - 1];
  const lastVwap = vwapValues[vwapValues.length - 1];
  const lastRelVol = relVol[relVol.length - 1];
  const lastAdx = adxValues[adxValues.length - 1];

  const swings = findSwingPoints(candles, 2);
  const structure = detectStructure(swings);
  const levels = findSupportResistance(candles, swings);
  const regimeResult = detectRegime(candles);

  // --- TREND ---
  let trendScore = 0;
  const maxTrend = 100;
  if (lastEma20 !== null && lastEma50 !== null && lastEma20 > lastEma50) trendScore += 40;
  if (lastEma50 !== null && lastEma200 !== null && lastEma50 > lastEma200) trendScore += 30;
  if (lastEma20 !== null && lastClose > lastEma20) trendScore += 30;
  if (lastEma20 !== null && lastEma50 !== null && lastEma20 < lastEma50) trendScore -= 20;
  if (lastEma50 !== null && lastEma200 !== null && lastEma50 < lastEma200) trendScore -= 20;
  trendScore = Math.max(0, Math.min(maxTrend, trendScore));

  const trendBullish = (lastEma20 ?? 0) > (lastEma50 ?? 0) && (lastEma50 ?? 0) > (lastEma200 ?? 0);
  factors.push({
    key: 'trend',
    label_fa: 'روند',
    label_en: 'Trend',
    positive: trendBullish,
    weight: weights.trend,
  });

  // --- STRUCTURE ---
  let structureScore = 0;
  if (structure.label === 'HH_HL' || structure.label === 'BOS_BULLISH') structureScore = 80;
  else if (structure.label === 'LH_LL' || structure.label === 'BOS_BEARISH') structureScore = 20;
  else if (structure.label === 'RANGING') structureScore = 40;
  else structureScore = 30;

  const structureBullish = structure.label === 'HH_HL' || structure.label === 'BOS_BULLISH';
  factors.push({
    key: 'structure',
    label_fa: 'ساختار بازار',
    label_en: 'Market Structure',
    positive: structureBullish,
    weight: weights.structure,
  });

  // --- MOMENTUM ---
  let momentumScore = 0;
  if (lastRsi !== null) {
    if (lastRsi > 50 && lastRsi < 70) momentumScore += 50;
    else if (lastRsi >= 70) momentumScore += 30; // overbought
    else if (lastRsi < 30) momentumScore += 20; // oversold but not bullish yet
    else momentumScore += 35;
  }
  if (lastMacd !== null && lastSignal !== null && lastMacd > lastSignal) momentumScore += 30;
  else momentumScore -= 10;
  if (lastHist !== null && lastHist > 0) momentumScore += 20;
  else momentumScore -= 10;
  momentumScore = Math.max(0, Math.min(100, momentumScore));

  const momentumBullish =
    lastRsi !== null && lastRsi > 50 && lastMacd !== null && lastSignal !== null && lastMacd > lastSignal;
  factors.push({
    key: 'momentum',
    label_fa: 'مومنتوم',
    label_en: 'Momentum',
    positive: momentumBullish,
    weight: weights.momentum,
  });

  // --- VOLUME ---
  let volumeScore = 0;
  if (lastRelVol !== null) {
    if (lastRelVol > 1.5) volumeScore = 80;
    else if (lastRelVol > 1.0) volumeScore = 60;
    else if (lastRelVol > 0.7) volumeScore = 40;
    else volumeScore = 20;
  }
  const volumeConfirming = lastRelVol !== null && lastRelVol > 1.0;
  factors.push({
    key: 'volume',
    label_fa: 'حجم',
    label_en: 'Volume',
    positive: volumeConfirming,
    weight: weights.volume,
  });

  // --- VOLATILITY ---
  let volatilityScore = 0;
  const atrPct = lastAtr !== null ? (lastAtr / lastClose) * 100 : null;
  if (atrPct !== null) {
    if (atrPct < 2) volatilityScore = 80;
    else if (atrPct < 4) volatilityScore = 60;
    else if (atrPct < 6) volatilityScore = 40;
    else volatilityScore = 20;
  }
  const volatilityOk = atrPct !== null && atrPct < 5;
  factors.push({
    key: 'volatility',
    label_fa: 'نوسان',
    label_en: 'Volatility',
    positive: volatilityOk,
    weight: weights.volatility,
  });

  // --- SUPPORT/RESISTANCE ---
  let srScore = 50;
  const resistance = nearestResistance(levels, lastClose);
  if (resistance !== null) {
    const distPct = (resistance - lastClose) / lastClose;
    if (distPct > 0.05) srScore = 80;
    else if (distPct > 0.02) srScore = 60;
    else srScore = 30;
  }
  const srOk = resistance === null || (resistance - lastClose) / lastClose > 0.02;
  factors.push({
    key: 'support_resistance',
    label_fa: 'حمایت/مقاومت',
    label_en: 'Support/Resistance',
    positive: srOk,
    weight: weights.supportResistance,
  });

  // --- RISK/REWARD ---
  const riskPlan = computeRiskPlan(candles, levels, lastAtr, riskConfig);
  let rrScore = 0;
  if (riskPlan !== null) {
    if (riskPlan.riskReward >= 3) rrScore = 100;
    else if (riskPlan.riskReward >= 2) rrScore = 80;
    else if (riskPlan.riskReward >= 1.5) rrScore = 50;
    else rrScore = 20;
  }
  const rrOk = riskPlan !== null && riskPlan.riskReward >= riskConfig.minRiskReward;
  factors.push({
    key: 'risk_reward',
    label_fa: 'ریسک/بازده',
    label_en: 'Risk/Reward',
    positive: rrOk,
    weight: weights.riskReward,
  });

  const breakdown: ScoreBreakdown = {
    trend: (trendScore / 100) * weights.trend,
    structure: (structureScore / 100) * weights.structure,
    momentum: (momentumScore / 100) * weights.momentum,
    volume: (volumeScore / 100) * weights.volume,
    volatility: (volatilityScore / 100) * weights.volatility,
    supportResistance: (srScore / 100) * weights.supportResistance,
    riskReward: (rrScore / 100) * weights.riskReward,
    total: 0,
  };
  breakdown.total = Math.round(
    breakdown.trend +
      breakdown.structure +
      breakdown.momentum +
      breakdown.volume +
      breakdown.volatility +
      breakdown.supportResistance +
      breakdown.riskReward,
  );

  // --- SIGNAL DETERMINATION ---
  let signalType: SignalType;
  const score = breakdown.total;

  // Hard blocks
  if (regimeResult.regime === 'UNCLEAR' || regimeResult.regime === 'HIGH_VOLATILITY') {
    reasons.push('رژیم بازار نامشخص یا نوسان بالا', 'Unclear regime or high volatility');
    signalType = 'NO_TRADE';
  } else if (!volatilityOk) {
    reasons.push('نوسان نامناسب', 'Inappropriate volatility');
    signalType = 'NO_TRADE';
  } else if (isResistanceTooClose(levels, lastClose)) {
    reasons.push('مقاومت نزدیک است', 'Resistance too close');
    signalType = 'NO_TRADE';
  } else if (riskPlan === null || !rrOk) {
    reasons.push('ریسک/بازده نامناسب', 'Bad risk/reward');
    signalType = 'NO_TRADE';
  } else if (score < thresholds.watch) {
    reasons.push('امتیاز پایین', 'Low confluence score');
    signalType = 'NO_TRADE';
  } else if (score >= thresholds.buy && trendBullish && structureBullish && momentumBullish && volumeConfirming) {
    signalType = 'BUY';
    if (score >= thresholds.strong) {
      reasons.push('ستاپ قوی', 'Strong setup');
    }
  } else if (score >= thresholds.watch) {
    signalType = 'WAIT';
    reasons.push('ستاپ در حال شکل‌گیری', 'Setup forming');
  } else {
    signalType = 'NO_TRADE';
    reasons.push('تأییدیه کافی نیست', 'Insufficient confirmation');
  }

  const explanationFa = buildExplanationFa(symbol, timeframe, signalType, score, regimeResult, structure.label, factors, riskPlan, lastClose);
  const explanationEn = buildExplanationEn(symbol, timeframe, signalType, score, regimeResult, structure.label, factors, riskPlan, lastClose);

  return {
    symbol,
    timeframe,
    signalType,
    score,
    regime: regimeResult.regime,
    trend: regimeResult.trend,
    structure: structure.label,
    riskLevel: riskPlan?.riskLevel ?? 'HIGH',
    priceAtSignal: lastClose,
    factors,
    reasons,
    risk: riskPlan,
    explanationFa,
    explanationEn,
    generatedAt: Date.now(),
    dataQualityOk: true,
  };
}

function buildNoTrade(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  regime: string,
  trend: string,
  structure: string,
  riskLevel: string,
  factors: ConfluenceFactor[],
  reasons: string[],
  score: number,
  dataQualityOk: boolean,
): SignalResult {
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;
  return {
    symbol,
    timeframe,
    signalType: 'NO_TRADE',
    score,
    regime: regime as SignalResult['regime'],
    trend: trend as SignalResult['trend'],
    structure: structure as SignalResult['structure'],
    riskLevel: riskLevel as SignalResult['riskLevel'],
    priceAtSignal: lastClose,
    factors,
    reasons,
    risk: null,
    explanationFa: `${symbol} — سیگنال: عدم معامله. ${reasons.filter((r) => /[\u0600-\u06FF]/.test(r)).join('، ')}`,
    explanationEn: `${symbol} — Signal: NO TRADE. ${reasons.filter((r) => !/[\u0600-\u06FF]/.test(r)).join(', ')}`,
    generatedAt: Date.now(),
    dataQualityOk,
  };
}

function buildExplanationFa(
  symbol: string,
  timeframe: string,
  signalType: SignalType,
  score: number,
  regime: { regime: string; trend: string },
  structure: string,
  factors: ConfluenceFactor[],
  risk: RiskPlan | null,
  price: number,
): string {
  const signalLabel: Record<SignalType, string> = {
    BUY: 'خرید',
    WAIT: 'انتظار',
    EXIT: 'خروج',
    NO_TRADE: 'عدم معامله',
  };
  const trendLabel: Record<string, string> = {
    BULLISH: 'صعودی',
    BEARISH: 'نزولی',
    NEUTRAL: 'خنثی',
  };
  const regimeLabel: Record<string, string> = {
    BULLISH_TREND: 'روند صعودی',
    BEARISH_TREND: 'روند نزولی',
    RANGE: 'رنج',
    HIGH_VOLATILITY: 'نوسان بالا',
    LOW_VOLATILITY: 'نوسان پایین',
    TRANSITION: 'گذار',
    UNCLEAR: 'نامشخص',
  };

  const lines: string[] = [];
  lines.push(`${symbol} | تایم‌فریم: ${timeframe}`);
  lines.push(`وضعیت: ${signalLabel[signalType]}`);
  lines.push(`امتیاز: ${score}/100`);
  lines.push(`رژیم بازار: ${regimeLabel[regime.regime] ?? regime.regime}`);
  lines.push(`روند: ${trendLabel[regime.trend] ?? regime.trend}`);
  lines.push(`ساختار: ${structure}`);
  for (const f of factors) {
    lines.push(`${f.label_fa}: ${f.positive ? 'مثبت' : 'منفی'}`);
  }
  if (risk) {
    lines.push(`محدوده ورود: ${risk.entryLow.toFixed(2)} - ${risk.entryHigh.toFixed(2)}`);
    lines.push(`ابطال: ${risk.invalidation.toFixed(2)}`);
    lines.push(`هدف 1: ${risk.target1.toFixed(2)}`);
    lines.push(`هدف 2: ${risk.target2.toFixed(2)}`);
    lines.push(`نسبت ریسک به بازده: 1:${risk.riskReward.toFixed(1)}`);
  }
  return lines.join('\n');
}

function buildExplanationEn(
  symbol: string,
  timeframe: string,
  signalType: SignalType,
  score: number,
  regime: { regime: string; trend: string },
  structure: string,
  factors: ConfluenceFactor[],
  risk: RiskPlan | null,
  price: number,
): string {
  const signalLabel: Record<SignalType, string> = {
    BUY: 'BUY',
    WAIT: 'WAIT',
    EXIT: 'EXIT',
    NO_TRADE: 'NO TRADE',
  };
  const trendLabel: Record<string, string> = {
    BULLISH: 'Bullish',
    BEARISH: 'Bearish',
    NEUTRAL: 'Neutral',
  };
  const regimeLabel: Record<string, string> = {
    BULLISH_TREND: 'Bullish Trend',
    BEARISH_TREND: 'Bearish Trend',
    RANGE: 'Range',
    HIGH_VOLATILITY: 'High Volatility',
    LOW_VOLATILITY: 'Low Volatility',
    TRANSITION: 'Transition',
    UNCLEAR: 'Unclear',
  };

  const lines: string[] = [];
  lines.push(`${symbol} | Timeframe: ${timeframe}`);
  lines.push(`Signal: ${signalLabel[signalType]}`);
  lines.push(`Score: ${score}/100`);
  lines.push(`Market Regime: ${regimeLabel[regime.regime] ?? regime.regime}`);
  lines.push(`Trend: ${trendLabel[regime.trend] ?? regime.trend}`);
  lines.push(`Structure: ${structure}`);
  for (const f of factors) {
    lines.push(`${f.label_en}: ${f.positive ? 'Positive' : 'Negative'}`);
  }
  if (risk) {
    lines.push(`Entry Zone: ${risk.entryLow.toFixed(2)} - ${risk.entryHigh.toFixed(2)}`);
    lines.push(`Invalidation: ${risk.invalidation.toFixed(2)}`);
    lines.push(`Target 1: ${risk.target1.toFixed(2)}`);
    lines.push(`Target 2: ${risk.target2.toFixed(2)}`);
    lines.push(`Risk/Reward: 1:${risk.riskReward.toFixed(1)}`);
  }
  return lines.join('\n');
}
