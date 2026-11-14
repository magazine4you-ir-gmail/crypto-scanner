import { memo, useMemo } from 'react';
import { quoteOf } from '@engine';
import { QuoteChip } from '@/components/Quote';
import { ScoreBar } from '@/components/Badges';
import { Metric, Chip, TimeStamp } from '@/components/Responsive';
import { useSettings } from '@/contexts/SettingsContext';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import type { PlusPublicConfig } from '@/services/reversePlusService';
import { computeSignalSummary } from '@/reversePlus/summary';
import { STATUS_CHIP_TONE } from '@/reversePlus/statusTone';
import type { ScenarioPrefs } from '@/reversePlus/scenarioPrefs';
import type { MixRow } from '@/powerMix/mix';

interface Props {
  row: MixRow;
  cfg: PlusPublicConfig;
  prefs: ScenarioPrefs;
  onOpen: (row: MixRow) => void;
}

/**
 * The ORIGINAL (normal) signal in the exact template of the Reverse Plus signal card — same grid, same executable numbers
 * (RR, leverage, risk, notional, margin, liquidation) computed by the same pure function and the same local scenario.
 * Reverse-side signals use the Reverse Plus card itself.
 */
function CardImpl({ row, cfg, prefs, onOpen }: Props) {
  const { t, lang } = useSettings();
  const o = row.original;
  const s = useMemo(() => {
    // computeSignalSummary only needs side / entry / stop / target / status, so the original trade is passed in the same shape
    const asTrade = {
      ...row.reverse, signal_type: o.signal_type, stop_loss: o.stop_loss, target1: o.target1, status: o.status,
      exit_price: o.exit_price, entry_low: o.entry_low, entry_high: o.entry_high, price_at_signal: o.price_at_signal,
    } as unknown as ReverseOutcome;
    return computeSignalSummary({ rev: asTrade, st: null, live: null, cfg, prefs });
  }, [row.reverse, o, cfg, prefs]);

  const p = (v: number | null | undefined) => (v == null ? '—' : formatPrice(v, lang));
  const n = (v: number | null, d = 2) => (v == null ? '—' : formatNumber(v, lang, d));
  const isBuy = o.signal_type === 'BUY';
  const pnl = o.pnl_pct == null ? null : Number(o.pnl_pct);

  return (
    <button
      onClick={() => onOpen(row)}
      className="card w-full text-start p-3 space-y-3 active:bg-surface-100 hover:bg-surface-100/80 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-slate-100">{o.base_asset}</span>
            <QuoteChip quote={quoteOf(o.symbol)} />
            <Chip>{o.timeframe}</Chip>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={isBuy ? 'signal-buy' : 'signal-sell'}>{isBuy ? t('buy') : t('asShort')}</span>
            <Chip tone={STATUS_CHIP_TONE[o.status]}>{t(`rpSt${o.status}`)}</Chip>
          </div>
        </div>
        <div className="text-end shrink-0 space-y-0.5">
          <ScoreBar score={o.score} />
          {pnl === null
            ? <p className="text-sm text-slate-500">—</p>
            : <p className={`text-sm font-semibold tabular-nums ${pnl >= 0 ? 'text-success-400' : 'text-error-400'}`}>{formatPercent(pnl, lang)}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 rounded-lg bg-surface-100/60 p-2.5">
        <Metric label={t('price')} value={p(Number(o.price_at_signal))} />
        <Metric label={t('rpExitPrice')} value={o.status === 'OPEN' ? '—' : p(o.exit_price)} />
        <div className="col-span-2 sm:col-span-1 min-w-0">
          <Metric label={t('rpEntryZone')} value={s.zoneLow != null && s.zoneHigh != null ? `${p(s.zoneLow)} – ${p(s.zoneHigh)}` : '—'} />
        </div>
        <Metric label={t('stopLoss')} value={p(s.stop)} tone="text-error-400" />
        <Metric label={t('asTarget')} value={p(s.target)} tone="text-success-400" />
        <Metric label="R" value={o.r_multiple == null ? '—' : `${Number(o.r_multiple) >= 0 ? '+' : ''}${formatNumber(Number(o.r_multiple), lang, 2)}`} />
        <Metric label={t('rpRrNet')} value={n(s.rrNet)} />
        <Metric label={t('rpRrGross')} value={n(s.rrGross)} />
        <Metric label={t('rpLeverage')} value={`${formatNumber(s.leverage, lang, 0)}x`} tone="text-warning-400" />
        <Metric label={t('rpRiskUsd')} value={n(s.riskUsd, 2)} />
        <Metric label={t('rpNotional')} value={n(s.notional, 2)} />
        <Metric label={t('rpMargin')} value={n(s.margin, 2)} />
        <Metric label={t('rpLiq')} value={s.liq == null ? '—' : `≈ ${p(s.liq)}`} tone="text-warning-400" />
      </div>

      <div className="border-t border-surface-200 pt-2 flex items-center justify-between gap-2">
        <TimeStamp value={o.candle_close_time ?? o.signal_at} label={t('rpSignalTime')} compact />
        <span className="text-xs text-primary-400 shrink-0">{t('rpOpenDetails')}</span>
      </div>
    </button>
  );
}

export const PowerMixOriginalCard = memo(CardImpl);
