import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer, RefreshCw, Search, TrendingUp, TrendingDown, Clock, AlertTriangle } from 'lucide-react';
import { timeframeMs, quoteOf } from '@engine';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, ErrorState, EmptyState, LoadingSpinner, Disclaimer } from '@/components/UI';
import { ScoreBar, TrendBadge, RegimeBadge, SignalBadge } from '@/components/Badges';
import { Metric, TimeStamp, Chip, Pill, PillRow } from '@/components/Responsive';
import { QuoteChip, ConfluenceBadge } from '@/components/Quote';
import { computeConfluence, confluenceFor, isDualSignal, type Confluence } from '@/engine/confluence';
import { formatPrice, formatNumber, formatDate, timeAgo } from '@/i18n/format';
import type { TrendDirection, MarketRegime } from '@/types/signal';
import { fetchScanResults, fetchLatestScanRun, type ScanResultRow, type ScanRunRow } from '@/services/scanService';

type Tab = 'ACTION' | 'DUAL' | 'BUY' | 'SELL' | 'WAIT' | 'ALL';
type Pair = 'ALL' | 'USDT' | 'BTC';
type Sort = 'newest' | 'score' | 'rank';

const REFRESH_MS = 60_000;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const TF_ORDER = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

function isFresh(r: ScanResultRow): boolean {
  return (r.signal_type === 'BUY' || r.signal_type === 'SELL') && Date.now() - new Date(r.signal_since).getTime() < 2 * timeframeMs(r.timeframe);
}

function isStaleRow(r: ScanResultRow): boolean {
  return Date.now() - new Date(r.scanned_at).getTime() > 2 * timeframeMs(r.timeframe) + 3_600_000;
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
  const [sort, setSort] = useState<Sort>('newest');
  const [query, setQuery] = useState('');
  const [pair, setPair] = useState<Pair>('ALL');

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
    () => Array.from(new Set(results.map((r) => r.timeframe))).sort((a, b) => TF_ORDER.indexOf(a) - TF_ORDER.indexOf(b)),
    [results],
  );

  // confluence always looks at BOTH quotes of a coin, whatever pair filter is active
  const confluence = useMemo(
    () => computeConfluence(results.map((r) => ({ symbol: r.symbol, timeframe: r.timeframe, signalType: r.signal_type, score: r.score }))),
    [results],
  );

  const inTimeframe = useMemo(
    () => results.filter((r) => (timeframe === 'ALL' || r.timeframe === timeframe) && (pair === 'ALL' || quoteOf(r.symbol) === pair)),
    [results, timeframe, pair],
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
    const list = inTimeframe.filter((r) => {
      if (tab === 'ACTION' && r.signal_type !== 'BUY' && r.signal_type !== 'SELL') return false;
      if (tab === 'DUAL') {
        const c = confluenceFor(confluence, r.symbol, r.timeframe);
        if (!isDualSignal(c) || !c.aligned) return false;
      }
      if ((tab === 'BUY' || tab === 'SELL' || tab === 'WAIT') && r.signal_type !== tab) return false;
      if (q && !r.base_asset.toUpperCase().includes(q)) return false;
      return true;
    });
    const bySince = (a: ScanResultRow, b: ScanResultRow) => new Date(b.signal_since).getTime() - new Date(a.signal_since).getTime();
    return list.sort((a, b) => {
      if (sort === 'score') return b.score - a.score || bySince(a, b);
      if (sort === 'rank') return (a.market_rank ?? 999) - (b.market_rank ?? 999) || TF_ORDER.indexOf(a.timeframe) - TF_ORDER.indexOf(b.timeframe);
      return bySince(a, b) || b.score - a.score;
    });
  }, [inTimeframe, confluence, tab, query, sort]);

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
    { key: 'DUAL', label: lang === 'fa' ? 'هم‌پوشانی USDT+BTC' : 'USDT+BTC confluence' },
    { key: 'BUY', label: t('buy') },
    { key: 'SELL', label: t('asShort') },
    { key: 'WAIT', label: t('wait') },
    { key: 'ALL', label: t('all') },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Header />
        <button onClick={() => void load()} className="btn-secondary text-sm inline-flex items-center gap-2 shrink-0" aria-label={t('asRefresh')}>
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">{t('asRefresh')}</span>
        </button>
      </div>

      <p className="text-sm text-slate-400 leading-6">{t('asDescription')}</p>

      {loading && <LoadingSpinner />}
      {error && <ErrorState message={/scan_(results|runs)/.test(error) ? t('asTablesMissing') : error} onRetry={() => void load()} />}

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

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <Card className="!p-3 sm:!p-4">
              <div className="flex items-center gap-2 text-success-400 text-sm"><TrendingUp className="w-4 h-4" />{t('buy')}</div>
              <p className="text-2xl font-bold text-slate-100 mt-1 tabular-nums">{formatNumber(counts.BUY, lang, 0)}</p>
            </Card>
            <Card className="!p-3 sm:!p-4">
              <div className="flex items-center gap-2 text-error-400 text-sm"><TrendingDown className="w-4 h-4" />{t('asShort')}</div>
              <p className="text-2xl font-bold text-slate-100 mt-1 tabular-nums">{formatNumber(counts.SELL, lang, 0)}</p>
            </Card>
            <Card className="!p-3 sm:!p-4">
              <div className="flex items-center gap-2 text-warning-400 text-sm"><Clock className="w-4 h-4" />{t('wait')}</div>
              <p className="text-2xl font-bold text-slate-100 mt-1 tabular-nums">{formatNumber(counts.WAIT, lang, 0)}</p>
            </Card>
            <Card className="!p-3 sm:!p-4">
              <div className="text-slate-400 text-sm">{t('asLastScan')}</div>
              <p className="text-sm font-semibold text-slate-100 mt-1">{lastTime ? timeAgo(lastTime, lang) : '—'}</p>
              {run && (
                <p className="text-[11px] text-slate-500 mt-0.5 leading-4">
                  {formatNumber(run.symbols_total, lang, 0)} {t('asCoins')}
                  {run.timeframes_scanned && run.timeframes_scanned.length > 0 ? ` · ${run.timeframes_scanned.join('/').toUpperCase()}` : ''}
                </p>
              )}
            </Card>
          </div>

          <Card className="!p-3 sm:!p-4 space-y-3">
            <PillRow>
              {tabs.map((x) => (
                <Pill key={x.key} active={tab === x.key} onClick={() => setTab(x.key)}>{x.label}</Pill>
              ))}
            </PillRow>
            <PillRow>
              {(['ALL', 'USDT', 'BTC'] as Pair[]).map((p) => (
                <Pill key={p} active={pair === p} onClick={() => setPair(p)}>
                  {p === 'ALL' ? (lang === 'fa' ? 'همه جفت‌ها' : 'All pairs') : p}
                </Pill>
              ))}
            </PillRow>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:items-center">
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input-field text-sm sm:!w-auto" aria-label={t('sortBy')}>
                <option value="newest">{t('sortBy')}: {t('sortNewest')}</option>
                <option value="score">{t('sortBy')}: {t('sortScore')}</option>
                <option value="rank">{t('sortBy')}: {t('sortRank')}</option>
              </select>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="input-field text-sm sm:!w-auto" aria-label={t('timeframe')}>
                <option value="ALL">{t('timeframe')}: {t('all')}</option>
                {timeframes.map((tf) => (
                  <option key={tf} value={tf}>{tf.toUpperCase()}</option>
                ))}
              </select>
              <div className="relative col-span-2 sm:col-span-1 sm:ms-auto">
                <Search className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} className="input-field text-sm sm:!w-44 !ps-9" />
              </div>
            </div>
          </Card>

          <p className="text-[11px] text-slate-500">{t('closedCandleNote')}</p>

          {results.length === 0 ? (
            <EmptyState message={t('asNoData')} />
          ) : rows.length === 0 ? (
            <EmptyState message={t('noResults')} />
          ) : (
            <>
              {/* ---------- phones & small tablets: cards ---------- */}
              <div className="md:hidden space-y-2.5">
                {rows.map((r) => (
                  <ScanCard key={`${r.symbol}-${r.timeframe}`} r={r} c={confluenceFor(confluence, r.symbol, r.timeframe)} onOpen={() => navigate(`/asset/${r.symbol}?tf=${r.timeframe}`)} />
                ))}
              </div>

              {/* ---------- md+: table ---------- */}
              <div className="hidden md:block card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[980px]">
                    <thead className="bg-surface-100 dark:bg-surface-100 text-slate-400">
                      <tr>
                        {[t('asset'), t('timeframe'), t('signal'), t('score'), t('price'), t('entry'), t('stopLoss'), t('asTarget'), 'R/R', t('trend'), t('asSince'), t('candleClosed')].map((h) => (
                          <th key={h} className="px-3 py-3 text-start font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                      {rows.map((r) => (
                        <tr
                          key={`${r.symbol}-${r.timeframe}`}
                          onClick={() => navigate(`/asset/${r.symbol}?tf=${r.timeframe}`)}
                          className={`hover:bg-surface-100 dark:hover:bg-surface-100 transition-colors cursor-pointer ${isStaleRow(r) ? 'opacity-60' : ''}`}
                        >
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="font-semibold text-slate-100">{r.base_asset}</span>
                            <span className="ms-1.5"><QuoteChip quote={quoteOf(r.symbol)} /></span>
                            {r.market_rank !== null && <span className="text-xs text-slate-500 ms-2">#{r.market_rank}</span>}
                          </td>
                          <td className="px-3 py-3 text-slate-300 uppercase">{r.timeframe}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <SignalBadge type={r.signal_type} quote={quoteOf(r.symbol)} />
                              {r.signal_type === 'WAIT' && r.bias && (
                                <span className={`text-xs ${r.bias === 'LONG' ? 'text-success-400' : 'text-error-400'}`}>
                                  {r.bias === 'LONG' ? t('buy') : quoteOf(r.symbol) === 'BTC' ? t('sellToBtc') : t('asShort')}
                                </span>
                              )}
                              {isFresh(r) && <Chip tone="bg-primary-500/20 text-primary-300">{t('newBadge')}</Chip>}
                              {r.signal_type === 'SELL' && quoteOf(r.symbol) === 'USDT' && r.shortable === false && <Chip tone="bg-warning-500/20 text-warning-400">{t('noFutures')}</Chip>}
                              {(() => {
                                const c = confluenceFor(confluence, r.symbol, r.timeframe);
                                return isDualSignal(c) ? <ConfluenceBadge c={c} showLegs /> : null;
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-3"><ScoreBar score={r.score} /></td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(r.price, lang)}</td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">
                            {r.entry_low !== null && r.entry_high !== null ? `${formatPrice(r.entry_low, lang)} – ${formatPrice(r.entry_high, lang)}` : '—'}
                          </td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(r.stop_loss, lang)}</td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(r.target1, lang)}</td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums">{formatNumber(r.risk_reward, lang, 1)}</td>
                          <td className="px-3 py-3">
                            {r.trend ? <TrendBadge trend={r.trend as TrendDirection} /> : '—'}
                            {r.regime && <div className="mt-0.5"><RegimeBadge regime={r.regime as MarketRegime} /></div>}
                          </td>
                          <td className="px-3 py-3"><TimeStamp value={r.signal_since} /></td>
                          <td className="px-3 py-3"><TimeStamp value={r.candle_close_time} compact /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <Disclaimer />
    </div>
  );
}

function ScanCard({ r, c, onOpen }: { r: ScanResultRow; c: Confluence | null; onOpen: () => void }) {
  const { t, lang } = useSettings();
  const actionable = r.signal_type === 'BUY' || r.signal_type === 'SELL';
  const showPlan = actionable || r.signal_type === 'WAIT';
  return (
    <button
      onClick={onOpen}
      className={`card w-full text-start p-3 space-y-3 active:bg-surface-100 transition-colors ${isStaleRow(r) ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-slate-100">{r.base_asset}</span>
            <QuoteChip quote={quoteOf(r.symbol)} />
            <Chip>{r.timeframe}</Chip>
            {r.market_rank !== null && <span className="text-xs text-slate-500">#{r.market_rank}</span>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            <SignalBadge type={r.signal_type} quote={quoteOf(r.symbol)} />
            {r.signal_type === 'WAIT' && r.bias && (
              <span className={`text-xs ${r.bias === 'LONG' ? 'text-success-400' : 'text-error-400'}`}>{r.bias === 'LONG' ? t('buy') : quoteOf(r.symbol) === 'BTC' ? t('sellToBtc') : t('asShort')}</span>
            )}
            {isFresh(r) && <Chip tone="bg-primary-500/20 text-primary-300">{t('newBadge')}</Chip>}
            {r.signal_type === 'SELL' && quoteOf(r.symbol) === 'USDT' && r.shortable === false && <Chip tone="bg-warning-500/20 text-warning-400">{t('noFutures')}</Chip>}
            {isDualSignal(c) && <ConfluenceBadge c={c} showLegs />}
            {isStaleRow(r) && <Chip tone="bg-surface-300 text-slate-400">{t('staleRow')}</Chip>}
          </div>
        </div>
        <div className="text-end shrink-0">
          <ScoreBar score={r.score} />
          <p className="text-sm font-semibold text-slate-100 tabular-nums mt-1">{formatPrice(r.price, lang)}</p>
        </div>
      </div>

      {showPlan && (
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 rounded-lg bg-surface-100/60 p-2.5">
          <Metric
            label={t('entry')}
            value={r.entry_low !== null && r.entry_high !== null ? formatPrice(r.entry_low, lang) : '—'}
          />
          <Metric label={t('stopLoss')} value={formatPrice(r.stop_loss, lang)} tone="text-error-400" />
          <Metric label={t('asTarget')} value={formatPrice(r.target1, lang)} tone="text-success-400" />
          <Metric label="R/R" value={formatNumber(r.risk_reward, lang, 1)} />
          <Metric label={t('trend')} value={r.trend ? <TrendBadge trend={r.trend as TrendDirection} /> : '—'} />
          <Metric label={t('risk')} value={r.risk_level ?? '—'} />
        </div>
      )}

      <div className="flex items-start justify-between gap-3 border-t border-surface-200 pt-2">
        <TimeStamp value={r.signal_since} label={t('asSince')} />
        <div className="text-end">
          <span className="block text-[11px] leading-4 text-slate-500">{t('candleClosed')}</span>
          <span className="block text-xs text-slate-300">{r.candle_close_time ? formatDate(r.candle_close_time, lang) : '—'}</span>
        </div>
      </div>
    </button>
  );
}

function Header() {
  const { t } = useSettings();
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Timer className="w-6 h-6 text-primary-400 shrink-0" />
      <h1 className="text-xl sm:text-2xl font-bold text-slate-100 truncate">{t('autoScan')}</h1>
    </div>
  );
}
