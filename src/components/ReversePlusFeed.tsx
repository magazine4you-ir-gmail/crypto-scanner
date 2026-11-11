import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { Card, LoadingSpinner, ErrorState, EmptyState } from '@/components/UI';
import { Pill, PillRow } from '@/components/Responsive';
import { ReversePlusSignalCard } from '@/components/ReversePlusSignalCard';
import { formatNumber } from '@/i18n/format';
import {
  fetchReverseOutcomeCounts, fetchReverseOutcomePage,
  type ReverseCounts, type ReverseOutcome, type ReverseStatusFilter,
} from '@/services/reverseOutcomeService';
import {
  FALLBACK_PUBLIC_CONFIG, fetchEvaluationsForIds, fetchPublicConfig,
  type EvaluationPair, type PlusPublicConfig,
} from '@/services/reversePlusService';
import { resolvePrefs } from '@/reversePlus/scenarioPrefs';

export const PAGE_SIZE = 100;

interface Props {
  /** 'signals': status filters + list.  'analysis': adds trustworthy counts and symbol / timeframe / direction filters. */
  variant: 'signals' | 'analysis';
}

const FILTERS: ReverseStatusFilter[] = ['ALL', 'OPEN', 'WIN', 'LOSS', 'EXPIRED'];
const FILTER_KEY: Record<ReverseStatusFilter, string> = { ALL: 'all', OPEN: 'open', WIN: 'win', LOSS: 'loss', EXPIRED: 'slExpired' };
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d'];

/**
 * The single list of Reverse Plus. Rows come from `reverse_signal_outcomes` (Reverse Signal Lab's own table), server-side
 * filtered and paged, newest first. Default view = OPEN signals only. Evaluations are only enrichment for the visible page.
 */
export function ReversePlusFeed({ variant }: Props) {
  const { t, lang } = useSettings();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReverseStatusFilter>('OPEN');
  const [page, setPage] = useState(0);
  const [symbol, setSymbol] = useState('');
  const [debouncedSymbol, setDebouncedSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [side, setSide] = useState<'' | 'BUY' | 'SELL'>('');

  const [rows, setRows] = useState<ReverseOutcome[]>([]);
  const [total, setTotal] = useState(0);
  const [evals, setEvals] = useState<Map<string, EvaluationPair>>(new Map());
  const [counts, setCounts] = useState<ReverseCounts | null>(null);
  const [cfg, setCfg] = useState<PlusPublicConfig>(FALLBACK_PUBLIC_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSymbol(symbol), 300);
    return () => clearTimeout(id);
  }, [symbol]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const [pageRes, cfgRes, cnt] = await Promise.all([
        fetchReverseOutcomePage({
          status, page, pageSize: PAGE_SIZE,
          symbol: variant === 'analysis' ? debouncedSymbol : undefined,
          timeframe: variant === 'analysis' && timeframe ? timeframe : undefined,
          side: variant === 'analysis' && side ? side : undefined,
        }),
        fetchPublicConfig().catch(() => null),
        fetchReverseOutcomeCounts().catch(() => null),
      ]);
      // enrichment is best-effort: a signal is listed even when it has no evaluation yet
      const ev = await fetchEvaluationsForIds(pageRes.rows.map((r) => r.id)).catch(() => new Map<string, EvaluationPair>());
      if (my !== seq.current) return; // a newer request superseded this one
      setRows(pageRes.rows);
      setTotal(pageRes.total);
      setEvals(ev);
      setCounts(cnt);
      if (cfgRes) setCfg(cfgRes);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [status, page, variant, debouncedSymbol, timeframe, side]);

  useEffect(() => { void load(); }, [load]);

  // the remembered leverage / amount of this browser (read again on every load so a change on the detail page shows up)
  const prefs = useMemo(() => resolvePrefs(cfg), [cfg, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback((r: ReverseOutcome) => navigate(`/reverse-plus/signal/${encodeURIComponent(r.id)}`), [navigate]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const num = (v: number) => formatNumber(v, lang, 0);
  const setFilter = (f: ReverseStatusFilter) => { setStatus(f); setPage(0); };

  const countOf = (f: ReverseStatusFilter): number | null => {
    if (!counts) return null;
    return f === 'ALL' ? counts.total : f === 'OPEN' ? counts.open : f === 'WIN' ? counts.win : f === 'LOSS' ? counts.loss : counts.expired;
  };

  return (
    <div className="space-y-4">
      {variant === 'analysis' && (
        <Card className="!p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['OPEN', 'WIN', 'LOSS', 'EXPIRED'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg p-3 text-start border transition-colors ${status === f ? 'border-primary-500/40 bg-primary-600/10' : 'border-transparent bg-surface-100 hover:bg-surface-100/70'}`}
              >
                <p className="text-xs text-slate-400">{t(FILTER_KEY[f])}</p>
                <p className={`text-lg font-bold tabular-nums ${f === 'WIN' ? 'text-success-400' : f === 'LOSS' ? 'text-error-400' : f === 'OPEN' ? 'text-warning-400' : 'text-slate-300'}`}>
                  {counts ? num(countOf(f) ?? 0) : '—'}
                </p>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{t('rpCountsHint')}</p>
        </Card>
      )}

      <Card className="!p-3 sm:!p-4 space-y-3">
        <PillRow>
          {FILTERS.map((f) => (
            <Pill key={f} active={status === f} onClick={() => setFilter(f)}>
              {t(FILTER_KEY[f])}{countOf(f) !== null ? ` (${num(countOf(f) as number)})` : ''}
            </Pill>
          ))}
        </PillRow>
        {variant === 'analysis' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <input
              className="input-field text-sm col-span-2 sm:col-span-1"
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value); setPage(0); }}
              placeholder={t('rpSearchSymbol')}
              aria-label={t('rpSearchSymbol')}
            />
            <select className="input-field text-sm" value={side} onChange={(e) => { setSide(e.target.value as '' | 'BUY' | 'SELL'); setPage(0); }}>
              <option value="">{t('rpAllDirections')}</option>
              <option value="BUY">{t('buy')}</option>
              <option value="SELL">{t('asShort')}</option>
            </select>
            <select className="input-field text-sm" value={timeframe} onChange={(e) => { setTimeframe(e.target.value); setPage(0); }}>
              <option value="">{t('rpAllTimeframes')}</option>
              {TIMEFRAMES.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
            </select>
          </div>
        )}
        <p className="text-[11px] text-slate-500">{t('rpListHint')}</p>
      </Card>

      {loading ? <LoadingSpinner /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : rows.length === 0 ? (
        <EmptyState message={status === 'OPEN' && !debouncedSymbol && !timeframe && !side ? t('rpNoOpen') : t('rpNoMatch')} />
      ) : (
        <>
          <p className="text-xs text-slate-400">{num(total)} {t('rpResults')}</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {rows.map((r) => (
              <ReversePlusSignalCard
                key={r.id}
                rev={r}
                st={evals.get(r.id)?.signalTime ?? null}
                live={evals.get(r.id)?.live ?? null}
                cfg={cfg}
                prefs={prefs}
                onOpen={open}
              />
            ))}
          </div>
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3">
              <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>{t('rpPrev')}</button>
              <span className="text-xs text-slate-400 tabular-nums">{t('rpPage')} {num(page + 1)} {t('rpOf')} {num(pageCount)}</span>
              <button className="btn-secondary text-xs" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>{t('rpNext')}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
