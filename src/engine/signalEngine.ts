import type { Candle } from '@/types/market';
import type { SignalResult, SignalType, ConfluenceFactor, RiskPlan } from '@/types/signal';
import type { UserSettings } from '@/services/settingsService';
import {
  analyzeCore,
  closedCandles,
  priceDecimals,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_RISK_CONFIG,
  type AnalyzeOptions,
  type CoreAnalysis,
  type FactorState,
} from '@engine';

export { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, DEFAULT_RISK_CONFIG };
export type { AnalyzeOptions };

const FACTOR_LABELS: Record<FactorState['key'], { fa: string; en: string }> = {
  trend: { fa: 'روند', en: 'Trend' },
  structure: { fa: 'ساختار بازار', en: 'Market Structure' },
  momentum: { fa: 'مومنتوم', en: 'Momentum' },
  volume: { fa: 'حجم', en: 'Volume' },
  volatility: { fa: 'نوسان', en: 'Volatility' },
  support_resistance: { fa: 'حمایت/مقاومت', en: 'Support/Resistance' },
  risk_reward: { fa: 'ریسک/بازده', en: 'Risk/Reward' },
};

/** Builds engine options from the user's saved settings so the Settings page actually has an effect. */
export function optionsFromSettings(settings: UserSettings | null | undefined): AnalyzeOptions {
  if (!settings) return {};
  return {
    thresholds: {
      strong: settings.signal_threshold_strong ?? DEFAULT_THRESHOLDS.strong,
      buy: settings.signal_threshold_buy ?? DEFAULT_THRESHOLDS.buy,
      watch: settings.signal_threshold_watch ?? DEFAULT_THRESHOLDS.watch,
    },
    riskConfig: {
      riskPercent: Number(settings.risk_percent ?? DEFAULT_RISK_CONFIG.riskPercent),
      minRiskReward: Number(settings.min_risk_reward ?? DEFAULT_RISK_CONFIG.minRiskReward),
    },
  };
}

/**
 * Analyses candles. The still-forming candle is always dropped so the result never repaints and
 * matches what the server-side auto scan computes.
 */
export function analyze(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  options: AnalyzeOptions = {},
): SignalResult {
  const closed = closedCandles(candles);
  const core = analyzeCore(closed, { ...options, timeframe });
  if (!core) return buildInsufficient(symbol, timeframe, closed);
  return toSignalResult(symbol, timeframe, core);
}

function toSignalResult(symbol: string, timeframe: string, core: CoreAnalysis): SignalResult {
  const useBear = core.signalType === 'SELL' || (core.signalType !== 'BUY' && core.bias === 'SHORT');
  const source = useBear ? core.bearFactors : core.bullFactors;
  const factors: ConfluenceFactor[] = source.map((f) => ({
    key: f.key,
    label_fa: FACTOR_LABELS[f.key].fa,
    label_en: FACTOR_LABELS[f.key].en,
    positive: f.positive,
    weight: f.weight,
  }));

  const base = {
    symbol,
    timeframe,
    signalType: core.signalType,
    bias: core.bias,
    score: core.score,
    regime: core.regime,
    trend: core.trend,
    structure: core.structure,
    riskLevel: core.riskLevel,
    priceAtSignal: core.price,
    factors,
    reasons: core.reasons,
    risk: core.signalType === 'NO_TRADE' ? null : core.risk,
    generatedAt: Date.now(),
    candleCloseTime: core.candleCloseTime,
    dataQualityOk: true,
  };
  return {
    ...base,
    explanationFa: buildExplanation('fa', base),
    explanationEn: buildExplanation('en', base),
  };
}

function buildInsufficient(symbol: string, timeframe: string, candles: Candle[]): SignalResult {
  const last = candles[candles.length - 1];
  return {
    symbol,
    timeframe,
    signalType: 'NO_TRADE',
    bias: 'LONG',
    score: 0,
    regime: 'UNCLEAR',
    trend: 'NEUTRAL',
    structure: 'UNDEFINED',
    riskLevel: 'HIGH',
    priceAtSignal: last?.close ?? 0,
    factors: [],
    reasons: ['داده کافی نیست', 'Insufficient data'],
    risk: null,
    explanationFa: `${symbol} — سیگنال: عدم معامله. داده کافی نیست`,
    explanationEn: `${symbol} — Signal: NO TRADE. Insufficient data`,
    generatedAt: Date.now(),
    candleCloseTime: last?.closeTime ?? null,
    dataQualityOk: false,
  };
}

const SIGNAL_LABEL: Record<'fa' | 'en', Record<SignalType, string>> = {
  fa: { BUY: 'خرید', SELL: 'شورت (فروش)', WAIT: 'انتظار', EXIT: 'خروج', NO_TRADE: 'عدم معامله' },
  en: { BUY: 'BUY', SELL: 'SHORT (SELL)', WAIT: 'WAIT', EXIT: 'EXIT', NO_TRADE: 'NO TRADE' },
};
const TREND_LABEL: Record<'fa' | 'en', Record<string, string>> = {
  fa: { BULLISH: 'صعودی', BEARISH: 'نزولی', NEUTRAL: 'خنثی' },
  en: { BULLISH: 'Bullish', BEARISH: 'Bearish', NEUTRAL: 'Neutral' },
};
const REGIME_LABEL: Record<'fa' | 'en', Record<string, string>> = {
  fa: {
    BULLISH_TREND: 'روند صعودی',
    BEARISH_TREND: 'روند نزولی',
    RANGE: 'رنج',
    HIGH_VOLATILITY: 'نوسان بالا',
    LOW_VOLATILITY: 'نوسان پایین',
    TRANSITION: 'گذار',
    UNCLEAR: 'نامشخص',
  },
  en: {
    BULLISH_TREND: 'Bullish Trend',
    BEARISH_TREND: 'Bearish Trend',
    RANGE: 'Range',
    HIGH_VOLATILITY: 'High Volatility',
    LOW_VOLATILITY: 'Low Volatility',
    TRANSITION: 'Transition',
    UNCLEAR: 'Unclear',
  },
};

interface ExplainInput {
  symbol: string;
  timeframe: string;
  signalType: SignalType;
  score: number;
  regime: string;
  trend: string;
  structure: string;
  factors: ConfluenceFactor[];
  risk: RiskPlan | null;
  reasons: string[];
}

function buildExplanation(lang: 'fa' | 'en', s: ExplainInput): string {
  const fa = lang === 'fa';
  const lines: string[] = [];
  lines.push(fa ? `${s.symbol} | تایم‌فریم: ${s.timeframe}` : `${s.symbol} | Timeframe: ${s.timeframe}`);
  lines.push(`${fa ? 'وضعیت' : 'Signal'}: ${SIGNAL_LABEL[lang][s.signalType]}`);
  lines.push(`${fa ? 'امتیاز' : 'Score'}: ${s.score}/100`);
  lines.push(`${fa ? 'رژیم بازار' : 'Market Regime'}: ${REGIME_LABEL[lang][s.regime] ?? s.regime}`);
  lines.push(`${fa ? 'روند' : 'Trend'}: ${TREND_LABEL[lang][s.trend] ?? s.trend}`);
  lines.push(`${fa ? 'ساختار' : 'Structure'}: ${s.structure}`);
  for (const f of s.factors) {
    const label = fa ? f.label_fa : f.label_en;
    lines.push(`${label}: ${f.positive ? (fa ? 'مثبت' : 'Positive') : fa ? 'منفی' : 'Negative'}`);
  }
  const reason = s.reasons.filter((r) => /[\u0600-\u06FF]/.test(r) === fa);
  if (reason.length > 0) lines.push(`${fa ? 'توضیح' : 'Note'}: ${reason.join(fa ? '، ' : ', ')}`);
  if (s.risk) {
    const r = s.risk;
    lines.push(`${fa ? 'محدوده ورود' : 'Entry Zone'}: ${r.entryLow.toFixed(priceDecimals(r.entryLow))} - ${r.entryHigh.toFixed(priceDecimals(r.entryHigh))}`);
    lines.push(`${fa ? 'ابطال' : 'Invalidation'}: ${r.invalidation.toFixed(priceDecimals(r.invalidation))}`);
    lines.push(`${fa ? 'هدف ۱' : 'Target 1'}: ${r.target1.toFixed(priceDecimals(r.target1))}`);
    lines.push(`${fa ? 'هدف ۲' : 'Target 2'}: ${r.target2.toFixed(priceDecimals(r.target2))}`);
    lines.push(`${fa ? 'نسبت ریسک به بازده' : 'Risk/Reward'}: 1:${r.riskReward.toFixed(1)}`);
  }
  return lines.join('\n');
}
