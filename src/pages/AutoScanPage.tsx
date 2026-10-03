import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer, RefreshCw, Search, TrendingUp, TrendingDown, Clock, AlertTriangle } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, ErrorState, EmptyState, LoadingSpinner, Disclaimer } from '@/components/UI';
import { ScoreBar, TrendBadge, RegimeBadge } from '@/components/Badges';
import { formatPrice, formatNumber, formatDate } from '@/i18n/format';
import type { TrendDirection, MarketRegime } from '@/types/signal';
import {
  fetchScanResults,
  fetchLatestScanRun,
  type ScanResultRow,
  type ScanRunRow,
  type ScanSignalType,
} from '@/services/scanService';

type Tab = 'ACTION' | 'BUY' | 'SELL' | 'WAIT' | 'ALL';

const REFRESH_MS = 60_000;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // warn if no finished scan for 2 hours

function ScanBadge({ type }: { type: ScanSignalType }) {
  const { t } = useSettings();
  const map: Record<ScanSignalType, { label: string; cls: string }> = {
    BUY: { label: t('buy'), cls: 'signal-buy' },
    SELL: { label: t('asShort'), cls: 'signal-sell' },
    WAIT: { label: t('wait'), cls: 'signal-wait' },
    NO_TRADE: { label: t('noTrade'), cls: 'signal-no-trade' },
  };
  return <span className={map[type].cls}>{map[type].label}</span>;
}

function timeAgo(iso: string, lang: 'fa' | 'en'): string {
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang === 'fa' ? 'fa' : 'en', { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

export function AutoScanPage() {
  const { t, lang } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [results, setResults] = useState<ScanResultRow[]>([]);
  const [run, setRun] = useState<ScanRunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('ACTION');
  const [timeframe, setTimeframe] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [rows, latest] = await Promise.all([fetchScanResults(), fetchLatestScanRun()]);
      setResults(rows);
      setRun(latest);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [authLoading, user, load]);

  const timeframes = useMemo(
    () => Array.from(new Set(results.map((r) => r.timeframe))).sort((a, b) => order(a) - order(b)),
    [results],
  );

  const inTimeframe = useMemo(
    () => results.filter((r) => timeframe === 'ALL' || r.timeframe === timeframe),
    [results, timeframe],
  );

  const counts = useMemo(
    () => ({
      BUY: inTimeframe.filter((r) => r.signal_type === 'BUY').length,
      SELL: inTimeframe.filter((r) => r.signal_type === 'SELL').length,
      WAIT: inTimeframe.filter((r) => r.signal_type === 'WAIT').length,
    }),
    [inTimeframe],
  );

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return inTimeframe
      .filter((r) => {
        if (tab === 'ACTION' && r.signal_type !== 'BUY' && r.signal_type !== 'SELL') return false;
        if ((tab === 'BUY' || tab === 'SELL' || tab === 'WAIT') && r.signal_type !== tab) return false;
        if (q && !r.base_asset.toUpperCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score || (a.market_rank ?? 999) - (b.market_rank ?? 999));
  }, [inTimeframe, tab, query]);

  const lastTime = run?.finished_at ?? run?.started_at ?? null;
  const stale =
    run !== null && (run.status === 'failed' || Date.now() - new Date(run.finished_at ?? run.started_at).getTime() > STALE_AFTER_MS);

  if (!authLoading && !user) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <p className="text-slate-300 text-sm mb-4">{t('asLoginRequired')}</p>
          <button className="btn-primary text-sm" onClick={() => navigate('/login')}>{t('signIn')}</button>
        </Card>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'ACTION', label: t('asBuyAndShort') },
    { key: 'BUY', label: t('buy') },
    { key: 'SELL', label: t('asShort') },
    { key: 'WAIT', label: t('wait') },
    { key: 'ALL', label: t('all') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Header />
        <button onClick={() => void load()} className="btn-secondary text-sm inline-flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          {t('asRefresh')}
        </button>
      </div>

      <p className="text-sm text-slate-400">{t('asDescription')}</p>

      {loading && <LoadingSpinner />}
      {error && (
        <ErrorState message={/scan_(results|runs)/.test(error) ? t('asTablesMissing') : error} onRetry={() => void load()} />
      )}

      {!loading && !error && (
        <>
          {stale && (
            <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning-400 mt-0.5 shrink-0" />
              <p className="text-xs text-warning-400 leading-relaxed">
                {run?.status === 'failed' ? `${t('asLastFailed')}${run.error ? ` — ${run.error}` : ''}` : t('asStale')}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="!p-4">
              <div className="flex items-center gap-2 text-success-400 text-sm"><TrendingUp className="w-4 h-4" />{t('buy')}</div>
              <p className="text-2xl font-bold text-slate-100 mt-1 tabular-nums">{formatNumber(counts.BUY, lang, 0)}</p>
            </Card>
            <Card className="!p-4">
              <div className="flex items-center gap-2 text-error-400 text-sm"><TrendingDown className="w-4 h-4" />{t('asShort')}</div>
              <p className="text-2xl font-bold text-slate-100 mt-1 tabular-nums">{formatNumber(counts.SELL, lang, 0)}</p>
            </Card>
            <Card className="!p-4">
              <div className="flex items-center gap-2 text-warning-400 text-sm"><Clock className="w-4 h-4" />{t('wait')}</div>
              <p className="text-2xl font-bold text-slate-100 mt-1 tabular-nums">{formatNumber(counts.WAIT, lang, 0)}</p>
            </Card>
            <Card className="!p-4">
              <div className="text-slate-400 text-sm">{t('asLastScan')}</div>
              <p className="text-sm font-semibold text-slate-100 mt-1">{lastTime ? timeAgo(lastTime, lang) : '—'}</p>
              {run && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatNumber(run.symbols_total, lang, 0)} {t('asCoins')} · {run.timeframes.join(' / ').toUpperCase()}
                </p>
              )}
            </Card>
          </div>

          <Card className="!p-4">
            <div className="flex flex-wrap items-center gap-2">
              {tabs.map((x) => (
                <button
                  key={x.key}
                  onClick={() => setTab(x.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === x.key ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-surface-100'
                  }`}
                >
                  {x.label}
                </button>
              ))}
              <div className="flex-1" />
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="input-field text-sm !w-auto">
                <option value="ALL">{t('timeframe')}: {t('all')}</option>
                {timeframes.map((tf) => (
                  <option key={tf} value={tf}>{tf.toUpperCase()}</option>
                ))}
              </select>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('search')}
                  className="input-field text-sm !w-36 !ps-9"
                />
              </div>
            </div>
          </Card>

          {results.length === 0 ? (
            <EmptyState message={t('asNoData')} />
          ) : rows.length === 0 ? (
            <EmptyState message={t('noResults')} />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-100 dark:bg-surface-100 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-start font-medium">{t('asset')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('timeframe')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('signal')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('score')}</th>
                      <th className="px-4 py-3 text-start font-medium">{t('price')}</th>
                      <th className="px-4 py-3 text-start font-medium hidden md:table-cell">{t('entry')}</th>
                      <th className="px-4 py-3 text-start font-medium hidden md:table-cell">{t('stopLoss')}</th>
                      <th className="px-4 py-3 text-start font-medium hidden lg:table-cell">{t('asTarget')}</th>
                      <th className="px-4 py-3 text-start font-medium hidden lg:table-cell">R/R</th>
                      <th className="px-4 py-3 text-start font-medium hidden xl:table-cell">{t('trend')}</th>
                      <th className="px-4 py-3 text-start font-medium hidden xl:table-cell">{t('asSince')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                    {rows.map((r) => (
                      <tr
                        key={`${r.symbol}-${r.timeframe}`}
                        onClick={() => navigate(`/asset/${r.symbol}`)}
                        className="hover:bg-surface-100 dark:hover:bg-surface-100 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-100">{r.base_asset}</span>
                          {r.market_rank !== null && <span className="text-xs text-slate-500 ms-2">#{r.market_rank}</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-300 uppercase">{r.timeframe}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ScanBadge type={r.signal_type} />
                            {r.signal_type === 'WAIT' && r.bias && (
                              <span className={`text-xs ${r.bias === 'LONG' ? 'text-success-400' : 'text-error-400'}`}>
                                {r.bias === 'LONG' ? t('buy') : t('asShort')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3"><ScoreBar score={r.score} /></td>
                        <td className="px-4 py-3 text-slate-300 tabular-nums">{formatPrice(r.price, lang)}</td>
                        <td className="px-4 py-3 text-slate-300 tabular-nums hidden md:table-cell">
                          {r.entry_low !== null && r.entry_high !== null ? `${formatPrice(r.entry_low, lang)} – ${formatPrice(r.entry_high, lang)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-300 tabular-nums hidden md:table-cell">{formatPrice(r.stop_loss, lang)}</td>
                        <td className="px-4 py-3 text-slate-300 tabular-nums hidden lg:table-cell">{formatPrice(r.target1, lang)}</td>
                        <td className="px-4 py-3 text-slate-300 tabular-nums hidden lg:table-cell">{formatNumber(r.risk_reward, lang, 1)}</td>
                        <td className="px-4 py-3 hidden xl:table-cell">
                          {r.trend ? <TrendBadge trend={r.trend as TrendDirection} /> : '—'}
                          {r.regime && <div className="mt-0.5"><RegimeBadge regime={r.regime as MarketRegime} /></div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 hidden xl:table-cell" title={formatDate(r.signal_since, lang)}>
                          {timeAgo(r.signal_since, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <Disclaimer />
    </div>
  );
}

function order(tf: string): number {
  return ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].indexOf(tf);
}

function Header() {
  const { t } = useSettings();
  return (
    <div className="flex items-center gap-3">
      <Timer className="w-6 h-6 text-primary-400" />
      <h1 className="text-2xl font-bold text-slate-100">{t('autoScan')}</h1>
    </div>
  );
}
