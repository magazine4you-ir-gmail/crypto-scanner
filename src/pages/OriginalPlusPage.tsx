import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleDot, RefreshCw } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, LoadingSpinner, ErrorState, EmptyState } from '@/components/UI';
import { Pill, PillRow, Chip, Metric, TimeStamp } from '@/components/Responsive';
import { ScoreBar } from '@/components/Badges';
import { QuoteChip } from '@/components/Quote';
import { quoteOf } from '@engine';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import { fetchOutcomes, type SignalOutcome, type OutcomeStatus } from '@/services/outcomeService';
import { STATUS_CHIP_TONE } from '@/reversePlus/statusTone';

type StatusTab = 'ALL' | OutcomeStatus;

export function OriginalPlusPage() {
  const { t, lang } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SignalOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StatusTab>('OPEN');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOutcomes(500);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    void load();
  }, [authLoading, user, load]);

  const filtered = useMemo(
    () => (tab === 'ALL' ? rows : rows.filter((r) => r.status === tab)),
    [rows, tab],
  );

  const counts = useMemo(() => ({
    ALL: rows.length,
    OPEN: rows.filter((r) => r.status === 'OPEN').length,
    WIN: rows.filter((r) => r.status === 'WIN').length,
    LOSS: rows.filter((r) => r.status === 'LOSS').length,
    EXPIRED: rows.filter((r) => r.status === 'EXPIRED').length,
  }), [rows]);

  const header = (
    <div className="min-w-0">
      <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
        <CircleDot className="w-5 h-5 text-primary-400" />
        {t('originalPlus')}
      </h1>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('opSubtitle')}</p>
    </div>
  );

  if (authLoading) return <div className="space-y-6">{header}<LoadingSpinner /></div>;
  if (!user) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <p className="text-slate-300 text-sm mb-4">{t('asLoginRequired')}</p>
          <button className="btn-primary text-sm" onClick={() => navigate('/login')}>{t('signIn')}</button>
        </Card>
      </div>
    );
  }

  const tabs: { key: StatusTab; label: string }[] = [
    { key: 'ALL', label: t('all') },
    { key: 'OPEN', label: t('open') },
    { key: 'WIN', label: t('win') },
    { key: 'LOSS', label: t('loss') },
    { key: 'EXPIRED', label: t('slExpired') },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        {header}
        <button className="btn-secondary text-sm shrink-0 inline-flex items-center gap-2" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">{t('rpRefresh')}</span>
        </button>
      </div>

      <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
        <p className="text-xs text-primary-300 leading-relaxed">{t('opNote')}</p>
      </div>

      <PillRow>
        {tabs.map((x) => (
          <Pill key={x.key} active={tab === x.key} onClick={() => setTab(x.key)}>
            {x.label} ({formatNumber(counts[x.key] ?? 0, lang, 0)})
          </Pill>
        ))}
      </PillRow>

      {loading && <LoadingSpinner />}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && filtered.length === 0 && <EmptyState message={t('opNoMatch')} />}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {filtered.map((o) => {
            const isBuy = o.signal_type === 'BUY';
            const pnl = o.pnl_pct == null ? null : Number(o.pnl_pct);
            return (
              <button
                key={o.id}
                onClick={() => navigate(`/original-plus/signal/${encodeURIComponent(o.id)}`)}
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
                  <Metric label={t('price')} value={formatPrice(Number(o.price_at_signal), lang)} />
                  <Metric label={t('stopLoss')} value={formatPrice(Number(o.stop_loss), lang)} tone="text-error-400" />
                  <Metric label={t('asTarget')} value={formatPrice(Number(o.target1), lang)} tone="text-success-400" />
                </div>
                <div className="border-t border-surface-200 pt-2 flex items-center justify-between gap-2">
                  <TimeStamp value={o.candle_close_time ?? o.signal_at} label={t('rpSignalTime')} compact />
                  <span className="text-xs text-primary-400 shrink-0">{t('rpOpenDetails')}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">{t('disclaimer')}</p>
    </div>
  );
}
