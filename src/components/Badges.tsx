import { useSettings } from '@/contexts/SettingsContext';
import type { SignalType, TrendDirection, RiskLevel, MarketRegime, StructureLabel } from '@/types/signal';

export function SignalBadge({ type }: { type: SignalType }) {
  const { t } = useSettings();
  const labelMap: Record<SignalType, string> = {
    BUY: t('buy'),
    WAIT: t('wait'),
    EXIT: t('exit'),
    NO_TRADE: t('noTrade'),
  };
  const classMap: Record<SignalType, string> = {
    BUY: 'signal-buy',
    WAIT: 'signal-wait',
    EXIT: 'signal-exit',
    NO_TRADE: 'signal-no-trade',
  };
  return <span className={classMap[type]}>{labelMap[type]}</span>;
}

export function TrendBadge({ trend }: { trend: TrendDirection }) {
  const { t } = useSettings();
  const labelMap: Record<TrendDirection, string> = {
    BULLISH: t('bullish'),
    BEARISH: t('bearish'),
    NEUTRAL: t('neutral'),
  };
  const colorMap: Record<TrendDirection, string> = {
    BULLISH: 'text-success-400',
    BEARISH: 'text-error-400',
    NEUTRAL: 'text-slate-400',
  };
  return <span className={`text-sm font-medium ${colorMap[trend]}`}>{labelMap[trend]}</span>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const { t } = useSettings();
  const labelMap: Record<RiskLevel, string> = {
    LOW: t('low'),
    MEDIUM: t('medium'),
    HIGH: t('high'),
  };
  const colorMap: Record<RiskLevel, string> = {
    LOW: 'text-success-400',
    MEDIUM: 'text-warning-400',
    HIGH: 'text-error-400',
  };
  return <span className={`text-sm font-medium ${colorMap[level]}`}>{labelMap[level]}</span>;
}

export function RegimeBadge({ regime }: { regime: MarketRegime }) {
  const { t } = useSettings();
  const labelMap: Record<MarketRegime, string> = {
    BULLISH_TREND: t('bullishTrend'),
    BEARISH_TREND: t('bearishTrend'),
    RANGE: t('range'),
    HIGH_VOLATILITY: t('highVolatility'),
    LOW_VOLATILITY: t('lowVolatility'),
    TRANSITION: t('transition'),
    UNCLEAR: t('unclear'),
  };
  return <span className="text-sm font-medium text-slate-300">{labelMap[regime]}</span>;
}

export function StructureBadge({ structure }: { structure: StructureLabel }) {
  const { t, lang } = useSettings();
  const labels: Record<string, { fa: string; en: string }> = {
    HH_HL: { fa: 'سقف بالاتر/کف بالاتر', en: 'HH/HL' },
    LH_LL: { fa: 'سقف پایین‌تر/کف پایین‌تر', en: 'LH/LL' },
    RANGING: { fa: 'رنج', en: 'Ranging' },
    BOS_BULLISH: { fa: 'شکست ساختار صعودی', en: 'BOS Bullish' },
    BOS_BEARISH: { fa: 'شکست ساختار نزولی', en: 'BOS Bearish' },
    CHOCH_BULLISH: { fa: 'تغییر کاراکتر صعودی', en: 'ChoCH Bullish' },
    CHOCH_BEARISH: { fa: 'تغییر کاراکتر نزولی', en: 'ChoCH Bearish' },
    UNDEFINED: { fa: 'نامشخص', en: 'Undefined' },
  };
  const entry = labels[structure];
  return <span className="text-sm font-medium text-slate-300">{entry ? entry[lang] : structure}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-success-500' : score >= 70 ? 'bg-primary-500' : score >= 60 ? 'bg-warning-500' : 'bg-surface-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-surface-200 dark:bg-surface-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-semibold text-slate-200 tabular-nums">{score}</span>
    </div>
  );
}
