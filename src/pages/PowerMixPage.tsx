import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, RefreshCw } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { Chip, Pill, PillRow } from '@/components/Responsive';
import { Stat, BucketCard } from '@/components/LabStats';
import { DayChips } from '@/components/PowerMixChips';
import { PowerMixLiveCard } from '@/components/PowerMixLiveCard';
import { PowerMixCompare } from '@/components/PowerMixCompare';
import { PowerMixOriginalCard } from '@/components/PowerMixOriginalCard';
import { PowerMixSettingsPanel } from '@/components/PowerMixSettingsPanel';
import { ReversePlusSignalCard } from '@/components/ReversePlusSignalCard';
import { formatDate, formatNumber, formatPercent } from '@/i18n/format';
import { computeStats, type OutcomeStatus } from '@/services/outcomeService';
import { fetchLatestScanRun, type ScanRunRow } from '@/services/scanService';
import { FALLBACK_PUBLIC_CONFIG, fetchEvaluationsForIds, fetchPublicConfig, type EvaluationPair, type PlusPublicConfig } from '@/services/reversePlusService';
import { candleRangeFor, fetchBtcCandles, fetchMixPairs, fetchPowerMixConfig } from '@/services/powerMixService';
import { resolvePrefs } from '@/reversePlus/scenarioPrefs';
import { isReversePlusEnabled } from '@/reversePlus/featureFlag';
import { clearLocalOverride, loadLocalOverride, saveLocalOverride, DEFAULT_POWER_MIX_CONFIG, type PowerMixConfig } from '@/powerMix/config';
import { createDayAnalyzer, type BtcCandle } from '@/powerMix/dayPower';
import {
  buildMixRows, buildViews, displaySide, matchesDayFilter, outcomeOf, signalTimeMs,
  type DayFilter, type MixPair, type MixRow, type MixView,
} from '@/powerMix/mix';
import { DAY_MS } from '@/powerMix/tehranTime';

type StatusTab = 'ALL' | OutcomeStatus;
type Dir = 'ALL' | 'BUY' | 'SELL';

const PAGE = 40;
const REFRESH_MS = 60_000;
const DAY_FILTERS: DayFilter[] = ['ALL', 'VERY_STRONG', 'POWER', 'MIXED', 'NEUTRAL', 'DEAD', 'PENDING'];

function mergeCandles(prev: BtcCandle[], fresh: BtcCandle[]): BtcCandle[] {
  const m = new Map(prev.map((c) => [c.openTime, c]));
  for (const c of fresh) m.set(c.openTime, c);
  return [...m.values()].sort((a, b) => a.openTime - b.openTime);
}

export function PowerMixPage() {
  const { t, lang } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [pairs, setPairs] = useState<MixPair[]>([]);
  const [candles, setCandles] = useState<BtcCandle[]>([]);
  const [globalCfg, setGlobalCfg] = useState<PowerMixConfig>(DEFAULT_POWER_MIX_CONFIG);
  const [personal, setPersonal] = useState<PowerMixConfig | null>(() => loadLocalOverride());
  const [publicCfg, setPublicCfg] = useState<PlusPublicConfig>(FALLBACK_PUBLIC_CONFIG);
  const [run, setRun] = useState<ScanRunRow | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noCandles, setNoCandles] = useState(false);

  const [view, setView] = useState<MixView>('MIX');
  const [invert, setInvert] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>('ALL');
  const [tab, setTab] = useState<StatusTab>('ALL');
  const [tf, setTf] = useState('ALL');
  const [dir, setDir] = useState<Dir>('ALL');
  const [shown, setShown] = useState(PAGE);
  const [evals, setEvals] = useState<Map<string, EvaluationPair>>(new Map());

  const cfg = personal ?? globalCfg;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, g, pub, latest] = await Promise.all([
        fetchMixPairs(),
        fetchPowerMixConfig(),
        fetchPublicConfig().catch(() => null),
        fetchLatestScanRun().catch(() => null),
      ]);
      const now = Date.now();
      const times = p.map((x) => signalTimeMs(x.original)).filter(Number.isFinite);
      const range = candleRangeFor(times.length ? Math.min(...times) : null, now);
      let c: BtcCandle[] = [];
      try { c = await fetchBtcCandles(range.from, range.to); } catch { c = []; }
      setPairs(p);
      setGlobalCfg(g);
      if (pub) setPublicCfg(pub);
      setRun(latest);
      setCandles(c);
      setNoCandles(c.length === 0);
      setNowMs(now);
      setShown(PAGE);
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

  // keep today's status live: refresh only the last two days of BTC candles once a minute while the tab is visible
  const busy = useRef(false);
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      if (document.hidden || busy.current) return;
      busy.current = true;
      const now = Date.now();
      void fetchBtcCandles(now - 2 * DAY_MS, now)
        .then((fresh) => { setCandles((prev) => mergeCandles(prev, fresh)); setNowMs(now); setNoCandles(false); })
        .catch(() => undefined)
        .finally(() => { busy.current = false; });
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [user]);

  const analyzer = useMemo(() => createDayAnalyzer(candles, cfg, nowMs), [candles, cfg, nowMs]);
  const live = useMemo(() => analyzer.live(), [analyzer]);
  const rows = useMemo(() => buildMixRows(pairs, analyzer), [pairs, analyzer]);
  const dayRows = useMemo(() => rows.filter((r) => matchesDayFilter(r, dayFilter)), [rows, dayFilter]);
  const dayCounts = useMemo(() => Object.fromEntries(DAY_FILTERS.map((f) => [f, rows.filter((r) => matchesDayFilter(r, f)).length])) as Record<DayFilter, number>, [rows]);

  const views = useMemo(() => buildViews(dayRows, cfg, invert), [dayRows, cfg, invert]);
  const statsOriginal = useMemo(() => computeStats(views.original), [views]);
  const statsReverse = useMemo(() => computeStats(views.reverse), [views]);
  const statsMix = useMemo(() => computeStats(views.mix), [views]);
  const stats = view === 'MIX' ? statsMix : view === 'ORIGINAL' ? statsOriginal : statsReverse;
  const timeframes = useMemo(() => Array.from(new Set(dayRows.map((r) => r.original.timeframe))).sort(), [dayRows]);

  const list = useMemo(() => {
    const out: { row: MixRow; side: 'original' | 'reverse' }[] = [];
    for (const row of dayRows) {
      const side = displaySide(row, view, cfg, invert);
      if (!side) continue;
      if (tab !== 'ALL' && outcomeOf(row, side).status !== tab) continue;
      if (tf !== 'ALL' && row.original.timeframe !== tf) continue;
      if (dir !== 'ALL' && row.original.signal_type !== dir) continue;
      out.push({ row, side });
    }
    return out;
  }, [dayRows, view, cfg, invert, tab, tf, dir]);
  const visible = useMemo(() => list.slice(0, shown), [list, shown]);

  // Reverse Plus enrichment (suggested entry, quality) only for the reverse cards that are on screen
  const reverseIds = useMemo(() => visible.filter((x) => x.side === 'reverse').map((x) => x.row.reverse.id), [visible]);
  const idsKey = reverseIds.join(',');
  useEffect(() => {
    const missing = reverseIds.filter((id) => !evals.has(id));
    if (missing.length === 0) return;
    let alive = true;
    void fetchEvaluationsForIds(missing)
      .then((m) => { if (alive) setEvals((prev) => new Map([...prev, ...m])); })
      .catch(() => undefined); // enrichment is best-effort: the card renders without it
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const prefs = useMemo(() => resolvePrefs(publicCfg), [publicCfg, pairs]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRow = useCallback((row: MixRow, side: 'original' | 'reverse') => {
    const o = row.original;
    if (side === 'reverse') {
      navigate(isReversePlusEnabled()
        ? `/reverse-plus/signal/${encodeURIComponent(row.reverse.id)}`
        : `/asset/${row.reverse.symbol}?tf=${encodeURIComponent(row.reverse.timeframe)}&outcome=${encodeURIComponent(row.reverse.id)}&reverse=1`);
    } else {
      navigate(`/asset/${o.symbol}?tf=${encodeURIComponent(o.timeframe)}&outcome=${encodeURIComponent(o.id)}`);
    }
  }, [navigate]);

  const header = (
    <div className="flex items-center gap-3 min-w-0">
      <Layers className="w-6 h-6 text-primary-400 shrink-0" />
      <h1 className="text-xl sm:text-2xl font-bold text-slate-100 truncate">{t('powerMix')}</h1>
    </div>
  );

  if (!authLoading && !user) {
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

  const lastEval = run?.finished_at ?? run?.started_at ?? null;
  const ex = views.excluded;
  const excludedTotal = ex.pending + ex.noData + ex.none;
  const excludedText = t('pmExcludedDetail').replace('{p}', formatNumber(ex.pending, lang, 0)).replace('{d}', formatNumber(ex.noData, lang, 0)).replace('{n}', formatNumber(ex.none, lang, 0));

  const statusTabs: { key: StatusTab; label: string }[] = [
    { key: 'ALL', label: t('all') }, { key: 'OPEN', label: t('open') }, { key: 'WIN', label: t('win') },
    { key: 'LOSS', label: t('loss') }, { key: 'EXPIRED', label: t('slExpired') },
  ];
  const dayLabel = (f: DayFilter) => (f === 'ALL' ? t('pmAllDays') : f === 'DEAD' ? t('pmDead') : f === 'PENDING' ? t('pmPending') : t(`pmClass${f}`));

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        {header}
        <button onClick={() => void load()} className="btn-secondary text-sm inline-flex items-center gap-2 shrink-0" aria-label={t('asRefresh')}>
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">{t('asRefresh')}</span>
        </button>
      </div>

      {loading && <LoadingSpinner size="lg" />}
      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && (
        <>
          <PowerMixLiveCard live={live} cfg={cfg} />
          {noCandles && <p className="text-xs text-warning-400">{t('pmNoCandles')}</p>}

          <p className="text-sm text-slate-400 leading-6">{t('pmDescription')}</p>
          {lastEval && (
            <p className="text-[11px] text-slate-500">
              {t('lastScanOutcomes')}: {formatDate(lastEval, lang)}
              {run && run.outcomes_closed != null ? ` · +${formatNumber(run.outcomes_opened ?? 0, lang, 0)} / ✓${formatNumber(run.outcomes_closed, lang, 0)}` : ''}
            </p>
          )}

          {pairs.length === 0 ? (
            <EmptyState message={t('pmNoData')} />
          ) : (
            <>
              <Card className="!p-3 sm:!p-4 space-y-3">
                <PillRow>
                  {(['MIX', 'ORIGINAL', 'REVERSE'] as MixView[]).map((v) => (
                    <Pill key={v} active={view === v} onClick={() => { setView(v); setShown(PAGE); }}>
                      {t(v === 'MIX' ? 'pmViewMix' : v === 'ORIGINAL' ? 'pmViewOriginal' : 'pmViewReverse')}
                    </Pill>
                  ))}
                  <Pill active={invert} onClick={() => setInvert((x) => !x)}>{t('pmInvert')}</Pill>
                </PillRow>
                {invert && <p className="text-[11px] text-warning-400">{t('pmInvertOn')}</p>}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-500">{t('pmDayType')}</p>
                  <PillRow>
                    {DAY_FILTERS.map((f) => (
                      <Pill key={f} active={dayFilter === f} onClick={() => { setDayFilter(f); setShown(PAGE); }}>
                        {dayLabel(f)} ({formatNumber(dayCounts[f], lang, 0)})
                      </Pill>
                    ))}
                  </PillRow>
                  <p className="text-[11px] text-slate-500 leading-5">{t('pmHindsightNote')}</p>
                </div>
              </Card>

              <PowerMixCompare original={statsOriginal} reverse={statsReverse} mix={statsMix} active={view} />
              {view === 'MIX' && excludedTotal > 0 && (
                <p className="text-[11px] text-slate-500">{t('pmExcluded')}: {formatNumber(excludedTotal, lang, 0)} — {excludedText}</p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-3">
                <Stat label={t('slOpen')} value={formatNumber(stats.open, lang, 0)} />
                <Stat label={t('totalSignals')} value={formatNumber(stats.totalClosed, lang, 0)} />
                <Stat
                  label={t('winRate')} value={formatPercent(stats.winRate, lang)}
                  hint={`${t('breakEven')}: ${formatPercent(stats.breakEvenWinRate, lang)}`}
                  color={stats.winRate >= stats.breakEvenWinRate ? 'text-success-400' : 'text-error-400'}
                />
                <Stat label={`${t('win')} / ${t('loss')} / ${t('slExpired')}`} value={`${stats.wins} / ${stats.losses} / ${stats.expired}`} />
                <Stat
                  label={t('expectancyR')} value={`${stats.expectancyR >= 0 ? '+' : ''}${formatNumber(stats.expectancyR, lang, 2)}R`}
                  hint={t('netOfCosts')} color={stats.expectancyR >= 0 ? 'text-success-400' : 'text-error-400'}
                />
                <Stat label={t('avgPnl')} value={formatPercent(stats.avgPnl, lang)} color={stats.avgPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
                <Stat
                  label={t('profitFactor')} value={stats.profitFactor === Infinity ? '∞' : formatNumber(stats.profitFactor, lang, 2)}
                  color={stats.profitFactor >= 1 ? 'text-success-400' : 'text-error-400'}
                />
                <Stat label={t('totalPnl')} value={formatPercent(stats.totalPnl, lang)} color={stats.totalPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
              </div>

              {stats.totalClosed > 0 && stats.totalClosed < 30 && <p className="text-xs text-warning-400">{t('pmSmallSample')}</p>}

              {stats.totalClosed > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
                  <BucketCard title={t('slByTimeframe')} data={stats.byTimeframe} order={timeframes} upper />
                  <BucketCard title={t('slByScore')} data={stats.byScoreBucket} order={['80+', '70-79', '60-69', '<60']} />
                  <BucketCard title={t('byDirection')} data={stats.byDirection} order={['BUY', 'SELL']} labels={{ BUY: t('buy'), SELL: t('asShort') }} />
                </div>
              )}

              <Card className="!p-3 sm:!p-4 space-y-3">
                <PillRow>
                  {statusTabs.map((x) => (
                    <Pill key={x.key} active={tab === x.key} onClick={() => { setTab(x.key); setShown(PAGE); }}>{x.label}</Pill>
                  ))}
                </PillRow>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                  <select value={dir} onChange={(e) => { setDir(e.target.value as Dir); setShown(PAGE); }} className="input-field text-sm sm:!w-auto">
                    <option value="ALL">{t('pmOriginDirection')}: {t('all')}</option>
                    <option value="BUY">{t('buy')}</option>
                    <option value="SELL">{t('asShort')}</option>
                  </select>
                  <select value={tf} onChange={(e) => { setTf(e.target.value); setShown(PAGE); }} className="input-field text-sm sm:!w-auto">
                    <option value="ALL">{t('timeframe')}: {t('all')}</option>
                    {timeframes.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}
                  </select>
                </div>
              </Card>

              {list.length === 0 ? (
                <EmptyState message={t('noResults')} />
              ) : (
                <>
                  <p className="text-xs text-slate-400">{t('pmShown')} {formatNumber(visible.length, lang, 0)} {t('pmOf')} {formatNumber(list.length, lang, 0)}</p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                    {visible.map(({ row, side }) => (
                      <div key={row.id} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 px-1">
                          <DayChips info={row.day} />
                          {view === 'MIX' && row.day.state === 'FINAL' && (
                            <Chip tone={side === 'original' ? 'bg-success-500/10 text-success-400' : 'bg-primary-500/10 text-primary-300'}>
                              {side === 'original' ? t('pmPickOriginal') : t('pmPickReverse')}
                            </Chip>
                          )}
                        </div>
                        {side === 'reverse' ? (
                          <ReversePlusSignalCard
                            rev={row.reverse}
                            st={evals.get(row.reverse.id)?.signalTime ?? null}
                            live={evals.get(row.reverse.id)?.live ?? null}
                            cfg={publicCfg}
                            prefs={prefs}
                            onOpen={() => openRow(row, 'reverse')}
                          />
                        ) : (
                          <PowerMixOriginalCard row={row} cfg={publicCfg} prefs={prefs} onOpen={() => openRow(row, 'original')} />
                        )}
                      </div>
                    ))}
                  </div>
                  {list.length > visible.length && (
                    <div className="flex justify-center">
                      <button className="btn-secondary text-sm" onClick={() => setShown((n) => n + PAGE)}>{t('pmShowMore')}</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <PowerMixSettingsPanel
            value={cfg}
            personal={personal !== null}
            onSave={(c) => { saveLocalOverride(c); setPersonal(c); }}
            onReset={() => { clearLocalOverride(); setPersonal(null); }}
          />

          <Disclaimer />
        </>
      )}
    </div>
  );
}
