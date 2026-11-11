import { memo, useMemo } from 'react';
import { quoteOf } from '@engine';
import { QuoteChip } from '@/components/Quote';
import { Metric, Chip, TimeStamp } from '@/components/Responsive';
import { useSettings } from '@/contexts/SettingsContext';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import type { PlusEvaluation, PlusPublicConfig } from '@/services/reversePlusService';
import { computeSignalSummary } from '@/reversePlus/summary';
import { STATUS_CHIP_TONE } from '@/reversePlus/statusTone';
import type { ScenarioPrefs } from '@/reversePlus/scenarioPrefs';

const qualityTone = (q: number) => (q >= 65 ? 'text-success-400' : q >= 50 ? 'text-warning-400' : 'text-slate-300');

interface Props {
  rev: ReverseOutcome;
  /** SIGNAL_TIME evaluation (enrichment: suggested entry, quality). Optional. */
  st: PlusEvaluation | null;
  /** latest LIVE evaluation (only used for the last known price of OPEN signals). Optional. */
  live: PlusEvaluation | null;
  cfg: PlusPublicConfig;
  prefs: ScenarioPrefs;
  onOpen: (rev: ReverseOutcome) => void;
}

/**
 * THE one list card of Reverse Plus (Signals tab and Analysis center). It is a summary of the signal detail page:
 * the numbers come from the same pure function (`computeSignalSummary`) and the same local scenario.
 */
function CardImpl({ rev, st, live, cfg, prefs, onOpen }: Props) {
  const { t, lang } = useSettings();
  const s = useMemo(() => computeSignalSummary({ rev, st, live, cfg, prefs }), [rev, st, live, cfg, prefs]);
  const p = (v: number | null | undefined) => (v == null ? '—' : formatPrice(v, lang));
  const n = (v: number | null, d = 2) => (v == null ? '—' : formatNumber(v, lang, d));
  const isBuy = s.side === 'BUY';

  return (
    <button
      onClick={() => onOpen(rev)}
      className="card w-full text-start p-3 space-y-3 active:bg-surface-100 hover:bg-surface-100/80 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-slate-100">{rev.base_asset}</span>
            <QuoteChip quote={quoteOf(rev.symbol)} />
            <Chip>{rev.timeframe}</Chip>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={isBuy ? 'signal-buy' : 'signal-sell'}>{isBuy ? t('buy') : t('asShort')}</span>
            <Chip tone={STATUS_CHIP_TONE[s.status]}>{t(`rpSt${s.status}`)}</Chip>
          </div>
        </div>
        <div className="text-end shrink-0">
          <p className="text-[11px] text-slate-500">{t('rpQuality')}</p>
          {s.qualityPct === null
            ? <p className="text-sm text-slate-500">—</p>
            : <p className={`text-lg font-bold tabular-nums ${qualityTone(s.qualityPct)}`}>{formatNumber(s.qualityPct, lang, 0)}٪</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 rounded-lg bg-surface-100/60 p-2.5">
        <Metric label={s.priceLabel === 'CURRENT' ? t('rpCurrentPrice') : t('rpExitPrice')} value={p(s.price)} />
        <Metric label={t('rpRecommended')} value={p(s.entry)} tone="text-primary-300" />
        <div className="col-span-2 sm:col-span-1 min-w-0">
          <Metric label={t('rpEntryZone')} value={s.zoneLow != null && s.zoneHigh != null ? `${p(s.zoneLow)} – ${p(s.zoneHigh)}` : '—'} />
        </div>
        <Metric label={t('rpStopReverse')} value={p(s.stop)} tone="text-error-400" />
        <Metric label={t('rpTargetReverse')} value={p(s.target)} tone="text-success-400" />
        <Metric label={t('rpDistance')} value={s.distancePct == null ? '—' : formatPercent(s.distancePct, lang)} />
        <Metric label={t('rpRrNet')} value={n(s.rrNet)} />
        <Metric label={t('rpRrGross')} value={n(s.rrGross)} />
        <Metric label={t('rpLeverage')} value={`${formatNumber(s.leverage, lang, 0)}x`} tone="text-warning-400" />
        <Metric label={t('rpRiskUsd')} value={n(s.riskUsd, 2)} />
        <Metric label={t('rpNotional')} value={n(s.notional, 2)} />
        <Metric label={t('rpMargin')} value={n(s.margin, 2)} />
        <Metric label={t('rpLiq')} value={s.liq == null ? '—' : `≈ ${p(s.liq)}`} tone="text-warning-400" />
      </div>

      <div className="border-t border-surface-200 pt-2 flex items-center justify-between gap-2">
        <TimeStamp value={rev.candle_close_time ?? rev.signal_at} label={t('rpSignalTime')} compact />
        <span className="text-xs text-primary-400 shrink-0">{t('rpOpenDetails')}</span>
      </div>
    </button>
  );
}

export const ReversePlusSignalCard = memo(CardImpl);
