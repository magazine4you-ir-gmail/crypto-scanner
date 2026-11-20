import { memo, useMemo } from 'react';
import { quoteOf } from '@engine';
import { QuoteChip } from '@/components/Quote';
import { ScoreBar } from '@/components/Badges';
import { Metric, Chip, TimeStamp } from '@/components/Responsive';
import { useSettings } from '@/contexts/SettingsContext';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import type { PlusEvaluation, PlusPublicConfig } from '@/services/reversePlusService';
import { computeSignalSummary } from '@/reversePlus/summary';
import type { ScenarioPrefs } from '@/reversePlus/scenarioPrefs';
import type { MixTrade, TradeStatus } from '@/powerMix/tradeCalc';

const STATUS_TONE: Record<TradeStatus, string> = {
  OPEN: 'bg-warning-500/20 text-warning-400',
  WIN: 'bg-success-500/20 text-success-400',
  LOSS: 'bg-error-500/20 text-error-400',
  EXPIRED: 'bg-surface-200 text-slate-300',
  NO_ENTRY: 'bg-surface-200 text-slate-400',
  UNKNOWN: 'bg-surface-200 text-slate-400',
};

const qualityTone = (q: number) => (q >= 65 ? 'text-success-400' : q >= 50 ? 'text-warning-400' : 'text-slate-300');
const tone = (v: number | null) => (v === null ? 'text-slate-500' : v >= 0 ? 'text-success-400' : 'text-error-400');

interface Props {
  trade: MixTrade;
  cfg: PlusPublicConfig;
  prefs: ScenarioPrefs;
  /** Reverse Plus SIGNAL_TIME evaluation (reverse side only; enrichment: entry quality) */
  st?: PlusEvaluation | null;
  onOpen: (trade: MixTrade) => void;
}

/**
 * THE one signal card of Power Mix — original and reverse use exactly this template, so the loop looks the same:
 * header = symbol / timeframe / direction / status · score · net P&L %; body = the same metric grid for both sides.
 * The numbers come from `MixTrade` (one model for both sides) and `computeSignalSummary` (executable plan figures).
 */
function CardImpl({ trade, cfg, prefs, st = null, onOpen }: Props) {
  const { t, lang } = useSettings();
  const o = trade.outcome;
  const s = useMemo(
    () => computeSignalSummary({ rev: o as unknown as ReverseOutcome, st: trade.side === 'reverse' ? st : null, live: null, cfg, prefs, backtestEntry: trade.side === 'reverse' ? trade.entry : null }),
    [o, st, trade.side, trade.entry, cfg, prefs],
  );
  const p = (v: number | null | undefined) => (v == null ? '—' : formatPrice(v, lang));
  const n = (v: number | null | undefined, d = 2) => (v == null ? '—' : formatNumber(v, lang, d));
  const signed = (v: number | null, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${formatNumber(v, lang, d)}`);
  const isBuy = o.signal_type === 'BUY';
  const decided = trade.status === 'WIN' || trade.status === 'LOSS' || trade.status === 'EXPIRED';
  const quality = trade.side === 'reverse' && st?.quality_score != null ? Math.round(st.quality_score) : null;

  return (
    <button
      onClick={() => onOpen(trade)}
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
            <Chip tone={STATUS_TONE[trade.status]}>{t(`pmSt${trade.status}`)}</Chip>
            {trade.liquidated && <Chip tone="bg-error-500/20 text-error-400">{t('pmLiquidated')}</Chip>}
          </div>
        </div>
        <div className="text-end shrink-0 space-y-0.5">
          <ScoreBar score={o.score} />
          {decided && trade.pnlPct !== null
            ? <p className={`text-sm font-semibold tabular-nums ${tone(trade.pnlPct)}`}>{formatPercent(trade.pnlPct, lang)}</p>
            : <p className="text-sm text-slate-500">—</p>}
          {decided && trade.netUsd !== null && <p className={`text-[11px] tabular-nums ${tone(trade.netUsd)}`}>{signed(trade.netUsd)} USDT</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 rounded-lg bg-surface-100/60 p-2.5">
        <Metric label={t('pmEntryUsed')} value={p(trade.entry ?? s.entry)} tone="text-primary-300" />
        <Metric label={t('pmExit')} value={trade.status === 'OPEN' ? '—' : p(trade.exit)} />
        <div className="col-span-2 sm:col-span-1 min-w-0">
          <Metric label={t('rpEntryZone')} value={s.zoneLow != null && s.zoneHigh != null ? `${p(s.zoneLow)} – ${p(s.zoneHigh)}` : '—'} />
        </div>
        <Metric label={t('stopLoss')} value={p(s.stop)} tone="text-error-400" />
        <Metric label={t('asTarget')} value={p(s.target)} tone="text-success-400" />
        <Metric label="R" value={decided ? signed(trade.r) : '—'} tone={decided ? tone(trade.r) : undefined} />
        <Metric label={t('rpRrNet')} value={n(s.rrNet)} />
        <Metric label={t('rpRrGross')} value={n(s.rrGross)} />
        <Metric label={t('rpLeverage')} value={`${formatNumber(s.leverage, lang, 0)}x`} tone="text-warning-400" />
        <Metric label={t('rpRiskUsd')} value={n(s.riskUsd)} />
        <Metric label={t('rpNotional')} value={n(s.notional)} />
        <Metric label={t('rpMargin')} value={n(s.margin)} />
        <Metric label={t('rpLiq')} value={s.liq == null ? '—' : `≈ ${p(s.liq)}`} tone="text-warning-400" />
        <Metric label={t('pmNetPnlUsd')} value={decided ? signed(trade.netUsd) : '—'} tone={decided ? tone(trade.netUsd) : undefined} />
        <Metric label={t('pmRoi')} value={decided && trade.roiPct !== null ? formatPercent(trade.roiPct, lang) : '—'} tone={decided ? tone(trade.roiPct) : undefined} />
        {quality !== null && <Metric label={t('pmQuality')} value={<span className={qualityTone(quality)}>{formatNumber(quality, lang, 0)}٪</span>} />}
      </div>

      <div className="border-t border-surface-200 pt-2 flex items-center justify-between gap-2">
        <TimeStamp value={o.candle_close_time ?? o.signal_at} label={t('rpSignalTime')} compact />
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-slate-500">{t(`pmSource${trade.source}`)}</span>
          <span className="text-xs text-primary-400">{t('rpOpenDetails')}</span>
        </span>
      </div>
    </button>
  );
}

export const PowerMixSignalCard = memo(CardImpl);
