import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TestTubes, RefreshCw, Play } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { ScoreBar } from '@/components/Badges';
import { formatPrice, formatNumber, formatPercent, formatDate } from '@/i18n/format';
import {
  fetchOutcomes,
  evaluateOpenOutcomes,
  computeStats,
  type SignalOutcome,
  type OutcomeStatus,
} from '@/services/outcomeService';

type Tab = 'ALL' | 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED';

export function SignalLabPage() {
  const { t, lang } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<SignalOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [evalProgress, setEvalProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ALL');
  const [tf, setTf] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOutcomes(400);
      setRows(data);
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
  }, [authLoading, user, load]);

  const runEvaluate = async () => {
    setEvaluating(true);
    setEvalProgress('');
    try {
      const n = await evaluateOpenOutcomes((done, total) => {
        setEvalProgress(`${done}/${total}`);
      });
      setEvalProgress(lang === 'fa' ? `${n} به‌روزرسانی شد` : `${n} updated`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvaluating(false);
    }
  };

  const stats = useMemo(() => computeStats(rows), [rows]);

  const timeframes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.timeframe))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tab !== 'ALL' && r.status !== tab) return false;
      if (tf !== 'ALL' && r.timeframe !== tf) return false;
      return true;
    });
  }, [rows, tab, tf]);

  if (!authLoading && !user) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <p className="text-slate-300 text-sm mb-4">{t('asLoginRequired')}</p>
          <button className="btn-primary text-sm" onClick={() => navigate('/login')}>
            {t('signIn')}
          </button>
        </Card>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'ALL', label: t('all') },
    { key: 'OPEN', label: t('open') },
    { key: 'WIN', label: t('win') },
    { key: 'LOSS', label: t('loss') },
    { key: 'EXPIRED', label: t('slExpired') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Header />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void runEvaluate()}
            disabled={evaluating || loading}
            className="btn-primary text-sm inline-flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            {evaluating ? `${t('slEvaluating')} ${evalProgress}` : t('slEvaluate')}
          </button>
          <button onClick={() => void load()} className="btn-secondary text-sm inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            {t('asRefresh')}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-400">{t('slDescription')}</p>

      {loading && <LoadingSpinner size="lg" />}
      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label={t('slOpen')} value={String(stats.open)} />
            <Stat label={t('totalSignals')} value={String(stats.totalClosed)} />
            <Stat
              label={t('winRate')}
              value={formatPercent(stats.winRate, lang)}
              color={stats.winRate >= 50 ? 'text-success-400' : 'text-error-400'}
            />
            <Stat label={`${t('win')} / ${t('loss')}`} value={`${stats.wins} / ${stats.losses}`} />
            <Stat
              label={t('avgPnl')}
              value={formatPercent(stats.avgPnl, lang)}
              color={stats.avgPnl >= 0 ? 'text-success-400' : 'text-error-400'}
            />
            <Stat
              label={t('profitFactor')}
              value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
              color={stats.profitFactor >= 1 ? 'text-success-400' : 'text-error-400'}
            />
          </div>

          {(Object.keys(stats.byTimeframe).length > 0 || Object.keys(stats.byScoreBucket).length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <SectionTitle>{t('slByTimeframe')}</SectionTitle>
                <div className="space-y-2">
                  {Object.entries(stats.byTimeframe).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm">
                      <span className="text-slate-300 uppercase">{k}</span>
                      <span className="text-slate-400">
                        {v.wins}W / {v.losses}L · {formatPercent(v.winRate, lang)}
                      </span>
                    </div>
                  ))}
                  {Object.keys(stats.byTimeframe).length === 0 && (
                    <p className="text-sm text-slate-500">{t('noResults')}</p>
                  )}
                </div>
              </Card>
              <Card>
                <SectionTitle>{t('slByScore')}</SectionTitle>
                <div className="space-y-2">
                  {['80+', '70-79', '60-69', '<60'].filter((b) => stats.byScoreBucket[b]).map((k) => {
                    const v = stats.byScoreBucket[k];
                    return (
                      <div key={k} className="flex justify-between text-sm">
                        <span className="text-slate-300">{k}</span>
                        <span className="text-slate-400">
                          {v.wins}W / {v.losses}L · {formatPercent(v.winRate, lang)}
                        </span>
                      </div>
                    );
                  })}
                  {Object.keys(stats.byScoreBucket).length === 0 && (
                    <p className="text-sm text-slate-500">{t('noResults')}</p>
                  )}
                </div>
              </Card>
            </div>
          )}

          <Card className="!p-4">
            <div className="flex flex-wrap items-center gap-2">
              {tabs.map((x) => (
                <button
                  key={x.key}
                  onClick={() => setTab(x.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === x.key
                      ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-surface-100'
                  }`}
                >
                  {x.label}
                </button>
              ))}
              <div className="flex-1" />
              <select value={tf} onChange={(e) => setTf(e.target.value)} className="input-field text-sm !w-auto">
                <option value="ALL">{t('timeframe')}: {t('all')}</option>
                {timeframes.map((x) => (
                  <option key={x} value={x}>{x.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </Card>

          {rows.length === 0 ? (
            <EmptyState message={t('slNoData')} />
          ) : filtered.length === 0 ? (
            <EmptyState message={t('noResults')} />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-100 text-slate-400">
                    <tr>
                      <th className="px-3 py-3 text-start font-medium">{t('asset')}</th>
                      <th className="px-3 py-3 text-start font-medium">{t('timeframe')}</th>
                      <th className="px-3 py-3 text-start font-medium">{t('signal')}</th>
                      <th className="px-3 py-3 text-start font-medium">{t('score')}</th>
                      <th className="px-3 py-3 text-start font-medium">{t('price')}</th>
                      <th className="px-3 py-3 text-start font-medium hidden md:table-cell">{t('stopLoss')}</th>
                      <th className="px-3 py-3 text-start font-medium hidden md:table-cell">{t('asTarget')}</th>
                      <th className="px-3 py-3 text-start font-medium">{t('result')}</th>
                      <th className="px-3 py-3 text-start font-medium">PnL</th>
                      <th className="px-3 py-3 text-start font-medium hidden lg:table-cell">{t('date')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-200">
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        className="hover:bg-surface-100 cursor-pointer"
                        onClick={() =>
                          navigate(`/asset/${r.symbol}?tf=${encodeURIComponent(r.timeframe)}&outcome=${encodeURIComponent(r.id)}`)
                        }
                      >
                        <td className="px-3 py-3 font-semibold text-slate-100">{r.base_asset}</td>
                        <td className="px-3 py-3 text-slate-300 uppercase">{r.timeframe}</td>
                        <td className="px-3 py-3">
                          <span className={r.signal_type === 'BUY' ? 'signal-buy' : 'signal-sell'}>
                            {r.signal_type === 'BUY' ? t('buy') : t('asShort')}
                          </span>
                        </td>
                        <td className="px-3 py-3"><ScoreBar score={r.score} /></td>
                        <td className="px-3 py-3 text-slate-300 tabular-nums">{formatPrice(Number(r.price_at_signal), lang)}</td>
                        <td className="px-3 py-3 text-slate-300 tabular-nums hidden md:table-cell">
                          {formatPrice(Number(r.stop_loss), lang)}
                        </td>
                        <td className="px-3 py-3 text-slate-300 tabular-nums hidden md:table-cell">
                          {formatPrice(Number(r.target1), lang)}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={r.status} t={t} />
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {r.pnl_pct != null ? (
                            <span className={Number(r.pnl_pct) >= 0 ? 'text-success-400' : 'text-error-400'}>
                              {formatPercent(Number(r.pnl_pct), lang)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">
                          {formatDate(r.signal_at, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Disclaimer />
        </>
      )}
    </div>
  );
}

function Header() {
  const { t } = useSettings();
  return (
    <div className="flex items-center gap-3">
      <TestTubes className="w-6 h-6 text-primary-400" />
      <h1 className="text-2xl font-bold text-slate-100">{t('signalLab')}</h1>
    </div>
  );
}

function Stat({ label, value, color = 'text-slate-100' }: { label: string; value: string; color?: string }) {
  return (
    <Card className="!p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </Card>
  );
}

function StatusBadge({ status, t }: { status: OutcomeStatus; t: (k: string) => string }) {
  const map: Record<OutcomeStatus, string> = {
    OPEN: 'text-warning-400',
    WIN: 'text-success-400',
    LOSS: 'text-error-400',
    EXPIRED: 'text-slate-400',
    CANCELLED: 'text-slate-500',
  };
  const label: Record<OutcomeStatus, string> = {
    OPEN: t('open'),
    WIN: t('win'),
    LOSS: t('loss'),
    EXPIRED: t('slExpired'),
    CANCELLED: t('slCancelled'),
  };
  return <span className={`font-medium ${map[status]}`}>{label[status]}</span>;
}
