import { QuoteChip } from '@/components/Quote';
import { quoteOf } from '@engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { ScoreBar } from '@/components/Badges';
import { Metric, TimeStamp, Chip, Pill, PillRow } from '@/components/Responsive';
import { formatPrice, formatNumber, formatPercent, formatDate } from '@/i18n/format';
import { computeStats, type OutcomeStats, type OutcomeStatus } from '@/services/outcomeService';
import { fetchReverseOutcomes, originalsOf, type ReverseOutcome } from '@/services/reverseOutcomeService';
import { fetchLatestScanRun, type ScanRunRow } from '@/services/scanService';

type Tab = 'ALL' | 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED';
type Dir = 'ALL' | 'BUY' | 'SELL';
type Source = 'auto_scan' | 'manual_track' | 'ALL';

export function ReverseLabPage() {
  const { t, lang } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<ReverseOutcome[]>([]);
  const [run, setRun] = useState<ScanRunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ALL');
  const [tf, setTf] = useState('ALL');
  const [dir, setDir] = useState<Dir>('ALL');
  const [source, setSource] = useState<Source>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, latest] = await Promise.all([fetchReverseOutcomes(400), fetchLatestScanRun().catch(() => null)]);
      setRows(data);
      setRun(latest);
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

  // statistics follow the selected source (auto scan and manual tracking are never mixed by default)
  const sourceRows = useMemo(() => rows.filter((r) => source === 'ALL' || r.source === source), [rows, source]);
  const stats = useMemo(() => computeStats(sourceRows), [sourceRows]);
  // the SAME trades scored with their original direction / stop / target, for the side-by-side comparison
  const originalStats = useMemo(() => computeStats(originalsOf(sourceRows)), [sourceRows]);
  const timeframes = useMemo(() => Array.from(new Set(sourceRows.map((r) => r.timeframe))).sort(), [sourceRows]);

  const filtered = useMemo(
    () =>
      sourceRows.filter((r) => {
        if (tab !== 'ALL' && r.status !== tab) return false;
        if (tf !== 'ALL' && r.timeframe !== tf) return false;
        if (dir !== 'ALL' && r.signal_type !== dir) return false;
        return true;
      }),
    [sourceRows, tab, tf, dir],
  );

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
    { key: 'ALL', label: t('all') },
    { key: 'OPEN', label: t('open') },
    { key: 'WIN', label: t('win') },
    { key: 'LOSS', label: t('loss') },
    { key: 'EXPIRED', label: t('slExpired') },
  ];
  const open = (r: ReverseOutcome) =>
    navigate(`/asset/${r.symbol}?tf=${encodeURIComponent(r.timeframe)}&outcome=${encodeURIComponent(r.id)}&reverse=1`);
  const lastEval = run?.finished_at ?? run?.started_at ?? null;
  const sideLabel = (side: string) => (side === 'BUY' ? t('buy') : t('asShort'));
  const rText = (v: number | null | undefined) =>
    v != null ? `${Number(v) >= 0 ? '+' : ''}${formatNumber(Number(v), lang, 2)}` : '—';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Header />
        <button onClick={() => void load()} className="btn-secondary text-sm inline-flex items-center gap-2 shrink-0" aria-label={t('asRefresh')}>
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">{t('asRefresh')}</span>
        </button>
      </div>

      <p className="text-sm text-slate-400 leading-6">{t('rlDescription')}</p>
      <p className="text-xs text-slate-500 leading-5">{t('rlRule')}</p>
      <PillRow>
        {([
          ['auto_scan', t('slSourceAuto')],
          ['manual_track', t('slSourceManual')],
          ['ALL', t('slSourceAll')],
        ] as [Source, string][]).map(([key, label]) => (
          <Pill key={key} active={source === key} onClick={() => setSource(key)}>{label}</Pill>
        ))}
      </PillRow>
      {lastEval && (
        <p className="text-[11px] text-slate-500">{t('lastScanOutcomes')}: {formatDate(lastEval, lang)}</p>
      )}

      {loading && <LoadingSpinner size="lg" />}
      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && (
        <>
          {stats.totalClosed > 0 && <ComparePanel original={originalStats} reverse={stats} />}

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-3">
            <Stat label={t('slOpen')} value={formatNumber(stats.open, lang, 0)} />
            <Stat label={t('totalSignals')} value={formatNumber(stats.totalClosed, lang, 0)} />
            <Stat
              label={t('winRate')}
              value={formatPercent(stats.winRate, lang)}
              hint={`${t('breakEven')}: ${formatPercent(stats.breakEvenWinRate, lang)}`}
              color={stats.winRate >= stats.breakEvenWinRate ? 'text-success-400' : 'text-error-400'}
            />
            <Stat label={`${t('win')} / ${t('loss')} / ${t('slExpired')}`} value={`${stats.wins} / ${stats.losses} / ${stats.expired}`} />
            <Stat
              label={t('expectancyR')}
              value={`${stats.expectancyR >= 0 ? '+' : ''}${formatNumber(stats.expectancyR, lang, 2)}R`}
              hint={t('netOfCosts')}
              color={stats.expectancyR >= 0 ? 'text-success-400' : 'text-error-400'}
            />
            <Stat label={t('avgPnl')} value={formatPercent(stats.avgPnl, lang)} color={stats.avgPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
            <Stat
              label={t('profitFactor')}
              value={stats.profitFactor === Infinity ? '∞' : formatNumber(stats.profitFactor, lang, 2)}
              color={stats.profitFactor >= 1 ? 'text-success-400' : 'text-error-400'}
            />
            <Stat label={t('totalPnl')} value={formatPercent(stats.totalPnl, lang)} color={stats.totalPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
          </div>

          {stats.totalClosed > 0 && stats.totalClosed < 30 && (
            <p className="text-xs text-warning-400">
              {lang === 'fa' ? 'نمونه هنوز کوچک است (کمتر از ۳۰ معامله بسته‌شده)؛ به این آمار تکیه نکنید.' : 'Sample is still small (< 30 closed trades); do not rely on these numbers yet.'}
            </p>
          )}

          {stats.totalClosed > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
              <BucketCard title={t('slByTimeframe')} data={stats.byTimeframe} order={timeframes} upper />
              <BucketCard title={t('slByScore')} data={stats.byScoreBucket} order={['80+', '70-79', '60-69', '<60']} />
              <BucketCard title={t('byDirection')} data={stats.byDirection} order={['BUY', 'SELL']} labels={{ BUY: t('buy'), SELL: t('asShort') }} />
            </div>
          )}

          <Card className="!p-3 sm:!p-4 space-y-3">
            <PillRow>
              {tabs.map((x) => (
                <Pill key={x.key} active={tab === x.key} onClick={() => setTab(x.key)}>{x.label}</Pill>
              ))}
            </PillRow>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <select value={dir} onChange={(e) => setDir(e.target.value as Dir)} className="input-field text-sm sm:!w-auto">
                <option value="ALL">{t('rlReverseSignal')}: {t('all')}</option>
                <option value="BUY">{t('buy')}</option>
                <option value="SELL">{t('asShort')}</option>
              </select>
              <select value={tf} onChange={(e) => setTf(e.target.value)} className="input-field text-sm sm:!w-auto">
                <option value="ALL">{t('timeframe')}: {t('all')}</option>
                {timeframes.map((x) => (
                  <option key={x} value={x}>{x.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </Card>

          {sourceRows.length === 0 ? (
            <EmptyState message={t('rlNoData')} />
          ) : filtered.length === 0 ? (
            <EmptyState message={t('noResults')} />
          ) : (
            <>
              {/* phones: cards, newest first */}
              <div className="md:hidden space-y-2.5">
                {filtered.map((r) => (
                  <button key={r.id} onClick={() => open(r)} className="card w-full text-start p-3 space-y-3 active:bg-surface-100">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-slate-100">{r.base_asset}</span>
                          <QuoteChip quote={quoteOf(r.symbol)} />
                          <Chip>{r.timeframe}</Chip>
                          {r.source === 'manual_track' && <Chip tone="bg-primary-500/20 text-primary-300">{t('slManualBadge')}</Chip>}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs text-slate-500">{sideLabel(r.origin_signal_type)} →</span>
                          <span className={r.signal_type === 'BUY' ? 'signal-buy' : 'signal-sell'}>{sideLabel(r.signal_type)}</span>
                          <StatusBadge status={r.status} t={t} />
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <ScoreBar score={r.score} />
                        <PnlText r={r} lang={lang} />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-x-3 gap-y-2 rounded-lg bg-surface-100/60 p-2.5">
                      <Metric label={t('price')} value={formatPrice(Number(r.price_at_signal), lang)} />
                      <Metric label={t('stopLoss')} value={formatPrice(Number(r.stop_loss), lang)} tone="text-error-400" />
                      <Metric label={t('asTarget')} value={formatPrice(Number(r.target1), lang)} tone="text-success-400" />
                      <Metric label="R" value={rText(r.r_multiple)} />
                      <Metric label={t('rlOriginalResult')} value={r.origin ? statusLabel(r.origin.status, t) : '—'} />
                      <Metric label={t('barsHeld')} value={r.bars_held ?? '—'} />
                    </div>
                    <div className="border-t border-surface-200 pt-2">
                      <TimeStamp value={r.candle_close_time ?? r.signal_at} label={t('signalTime')} />
                    </div>
                  </button>
                ))}
              </div>

              <div className="hidden md:block card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[1080px]">
                    <thead className="bg-surface-100 text-slate-400">
                      <tr>
                        {[
                          t('asset'), t('timeframe'), t('rlOriginalSignal'), t('rlReverseSignal'), t('score'), t('price'),
                          t('stopLoss'), t('asTarget'), t('rlOriginalResult'), t('rlReverseResult'), 'PnL', 'R', t('signalTime'),
                        ].map((h) => (
                          <th key={h} className="px-3 py-3 text-start font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-200">
                      {filtered.map((r) => (
                        <tr key={r.id} className="hover:bg-surface-100 cursor-pointer" onClick={() => open(r)}>
                          <td className="px-3 py-3 font-semibold text-slate-100 whitespace-nowrap">
                            {r.base_asset} <QuoteChip quote={quoteOf(r.symbol)} />
                            {r.source === 'manual_track' && <span className="ms-2 align-middle"><Chip tone="bg-primary-500/20 text-primary-300">{t('slManualBadge')}</Chip></span>}
                          </td>
                          <td className="px-3 py-3 text-slate-300 uppercase">{r.timeframe}</td>
                          <td className="px-3 py-3 text-slate-400">{sideLabel(r.origin_signal_type)}</td>
                          <td className="px-3 py-3">
                            <span className={r.signal_type === 'BUY' ? 'signal-buy' : 'signal-sell'}>{sideLabel(r.signal_type)}</span>
                          </td>
                          <td className="px-3 py-3"><ScoreBar score={r.score} /></td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(Number(r.price_at_signal), lang)}</td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(Number(r.stop_loss), lang)}</td>
                          <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(Number(r.target1), lang)}</td>
                          <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{r.origin ? statusLabel(r.origin.status, t) : '—'}</td>
                          <td className="px-3 py-3"><StatusBadge status={r.status} t={t} /></td>
                          <td className="px-3 py-3 tabular-nums"><PnlText r={r} lang={lang} /></td>
                          <td className="px-3 py-3 tabular-nums text-slate-300">{rText(r.r_multiple)}</td>
                          <td className="px-3 py-3"><TimeStamp value={r.candle_close_time ?? r.signal_at} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <Disclaimer />
        </>
      )}
    </div>
  );
}

function PnlText({ r, lang }: { r: ReverseOutcome; lang: 'fa' | 'en' }) {
  if (r.pnl_pct == null) return <span className="text-slate-500 text-sm">—</span>;
  const v = Number(r.pnl_pct);
  return <span className={`text-sm font-semibold tabular-nums ${v >= 0 ? 'text-success-400' : 'text-error-400'}`}>{formatPercent(v, lang)}</span>;
}

function Header() {
  const { t } = useSettings();
  return (
    <div className="flex items-center gap-3 min-w-0">
      <ArrowLeftRight className="w-6 h-6 text-primary-400 shrink-0" />
      <h1 className="text-xl sm:text-2xl font-bold text-slate-100 truncate">{t('reverseLab')}</h1>
    </div>
  );
}

function Stat({ label, value, hint, color = 'text-slate-100' }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <Card className="!p-3 sm:!p-4">
      <p className="text-xs text-slate-400 mb-1 truncate">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{hint}</p>}
    </Card>
  );
}

/** Original vs reverse on exactly the same trades. */
function ComparePanel({ original, reverse }: { original: OutcomeStats; reverse: OutcomeStats }) {
  const { t, lang } = useSettings();
  const pf = (v: number) => (v === Infinity ? '∞' : formatNumber(v, lang, 2));
  const rr = (v: number) => `${v >= 0 ? '+' : ''}${formatNumber(v, lang, 2)}R`;
  const lines: { label: string; o: string; r: string; oGood: boolean; rGood: boolean }[] = [
    { label: t('winRate'), o: formatPercent(original.winRate, lang), r: formatPercent(reverse.winRate, lang), oGood: original.winRate >= original.breakEvenWinRate, rGood: reverse.winRate >= reverse.breakEvenWinRate },
    { label: t('expectancyR'), o: rr(original.expectancyR), r: rr(reverse.expectancyR), oGood: original.expectancyR >= 0, rGood: reverse.expectancyR >= 0 },
    { label: t('avgPnl'), o: formatPercent(original.avgPnl, lang), r: formatPercent(reverse.avgPnl, lang), oGood: original.avgPnl >= 0, rGood: reverse.avgPnl >= 0 },
    { label: t('profitFactor'), o: pf(original.profitFactor), r: pf(reverse.profitFactor), oGood: original.profitFactor >= 1, rGood: reverse.profitFactor >= 1 },
    { label: t('totalPnl'), o: formatPercent(original.totalPnl, lang), r: formatPercent(reverse.totalPnl, lang), oGood: original.totalPnl >= 0, rGood: reverse.totalPnl >= 0 },
  ];
  const tone = (good: boolean) => (good ? 'text-success-400' : 'text-error-400');
  return (
    <Card className="!p-4">
      <SectionTitle className="!text-base !mb-1">{t('rlCompareTitle')}</SectionTitle>
      <p className="text-xs text-slate-500 mb-3">{t('rlCompareHint')}</p>
      <div className="grid grid-cols-3 gap-y-2 text-sm">
        <span />
        <span className="text-slate-400 text-end font-medium">{t('rlOriginalLab')}</span>
        <span className="text-slate-400 text-end font-medium">{t('reverseLab')}</span>
        {lines.map((l) => (
          <div key={l.label} className="contents">
            <span className="text-slate-300">{l.label}</span>
            <span className={`text-end tabular-nums font-semibold ${tone(l.oGood)}`}>{l.o}</span>
            <span className={`text-end tabular-nums font-semibold ${tone(l.rGood)}`}>{l.r}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BucketCard({
  title,
  data,
  order,
  upper = false,
  labels = {},
}: {
  title: string;
  data: Record<string, { wins: number; losses: number; expired: number; winRate: number; avgR: number }>;
  order: string[];
  upper?: boolean;
  labels?: Record<string, string>;
}) {
  const { lang } = useSettings();
  const keys = order.filter((k) => data[k]);
  return (
    <Card className="!p-4">
      <SectionTitle className="!text-base !mb-3">{title}</SectionTitle>
      <div className="space-y-2">
        {keys.length === 0 && <p className="text-sm text-slate-500">—</p>}
        {keys.map((k) => {
          const v = data[k];
          return (
            <div key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className={`text-slate-300 ${upper ? 'uppercase' : ''}`}>{labels[k] ?? k}</span>
              <span className="text-slate-400 text-xs sm:text-sm text-end">
                {v.wins}W / {v.losses}L{v.expired ? ` / ${v.expired}E` : ''} · {formatPercent(v.winRate, lang)} ·{' '}
                <span className={v.avgR >= 0 ? 'text-success-400' : 'text-error-400'}>{v.avgR >= 0 ? '+' : ''}{formatNumber(v.avgR, lang, 2)}R</span>
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function statusLabel(status: OutcomeStatus, t: (k: string) => string): string {
  const label: Record<OutcomeStatus, string> = {
    OPEN: t('open'),
    WIN: t('win'),
    LOSS: t('loss'),
    EXPIRED: t('slExpired'),
    CANCELLED: t('slCancelled'),
  };
  return label[status];
}

function StatusBadge({ status, t }: { status: OutcomeStatus; t: (k: string) => string }) {
  const map: Record<OutcomeStatus, string> = {
    OPEN: 'text-warning-400',
    WIN: 'text-success-400',
    LOSS: 'text-error-400',
    EXPIRED: 'text-slate-400',
    CANCELLED: 'text-slate-500',
  };
  return <span className={`text-sm font-medium ${map[status]}`}>{statusLabel(status, t)}</span>;
}
