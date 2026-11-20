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
import { PowerMixSignalCard } from '@/components/PowerMixSignalCard';
import { PowerMixSettingsPanel } from '@/components/PowerMixSettingsPanel';
import { PowerMixScenarioBar } from '@/components/PowerMixScenarioBar';
import { PowerMixDateRange } from '@/components/PowerMixDateRange';
import { PowerMixDayHistory } from '@/components/PowerMixDayHistory';
import { MarketThermometer } from '@/components/MarketThermometer';
import { formatDate, formatNumber, formatPercent } from '@/i18n/format';
import { fetchLatestScanRun, type ScanRunRow } from '@/services/scanService';
import { FALLBACK_PUBLIC_CONFIG, fetchEvaluationsForIds, fetchPublicConfig, type EvaluationPair, type PlusBacktest, type PlusPublicConfig } from '@/services/reversePlusService';
import { MAX_MIX_ROWS, candleRangeFor, fetchBacktestsForIds, fetchBtcCandles, fetchMixPairs, fetchPowerMixConfig } from '@/services/powerMixService';
import { clearStoredPrefs, defaultPrefs, loadStoredPrefs, saveStoredPrefs, type ScenarioPrefs } from '@/reversePlus/scenarioPrefs';
import { isReversePlusEnabled } from '@/reversePlus/featureFlag';
import { clearLocalOverride, loadLocalOverride, saveLocalOverride, DEFAULT_POWER_MIX_CONFIG, type PowerMixConfig } from '@/powerMix/config';
import { createDayAnalyzer, type BtcCandle } from '@/powerMix/dayPower';
import { buildMixRows, buildViews, dayOf, displaySide, matchesDayFilter, signalTimeMs, type DayFilter, type MixMode, type MixPair, type MixRow, type MixView } from '@/powerMix/mix';
import { ALL_TIME, isOrdered, keyInRange, singleDay, type DateRange } from '@/powerMix/dateRange';
import { buildDayHistory } from '@/powerMix/history';
import { readThermo } from '@/powerMix/thermo';
import { buildTradeBook, computeMixStats, type MixTrade, type TradeBook, type TradeStatus } from '@/powerMix/tradeCalc';
import { DAY_MS } from '@/powerMix/tehranTime';

type StatusTab = 'ALL' | 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED';
type Dir = 'ALL' | 'BUY' | 'SELL';

const PAGE = 40;
const REFRESH_MS = 60_000;
const LATEST_ROWS = 200; // the periodic refresh re-reads only the newest signals
const DAY_FILTERS: DayFilter[] = ['ALL', 'VERY_STRONG', 'STRONG', 'POWER', 'MIXED', 'NEUTRAL', 'DEAD', 'PENDING'];

function mergeCandles(prev: BtcCandle[], fresh: BtcCandle[]): BtcCandle[] {
  const m = new Map(prev.map((c) => [c.openTime, c]));
  for (const c of fresh) m.set(c.openTime, c);
  return [...m.values()].sort((a, b) => a.openTime - b.openTime);
}

/** New / changed signals replace the old copy (their status moves OPEN -> WIN / LOSS); the order stays newest first. */
function mergePairs(prev: MixPair[], fresh: MixPair[]): MixPair[] {
  const m = new Map(prev.map((p) => [p.reverse.id, p]));
  for (const p of fresh) m.set(p.reverse.id, p);
  return [...m.values()].sort((a, b) => signalTimeMs(b.original) - signalTimeMs(a.original));
}

export function PowerMixPage() {
  const { t, lang } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [pairs, setPairs] = useState<MixPair[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [candles, setCandles] = useState<BtcCandle[]>([]);
  const [backtests, setBacktests] = useState<Map<string, PlusBacktest>>(new Map());
  const [btFailed, setBtFailed] = useState(false);
  const [globalCfg, setGlobalCfg] = useState<PowerMixConfig>(DEFAULT_POWER_MIX_CONFIG);
  const [personal, setPersonal] = useState<PowerMixConfig | null>(() => loadLocalOverride());
  const [publicCfg, setPublicCfg] = useState<PlusPublicConfig>(FALLBACK_PUBLIC_CONFIG);
  // the Reverse Plus scenario (leverage / sizing / amount): the SAME browser value the Reverse Plus pages use
  const [userPrefs, setUserPrefs] = useState<ScenarioPrefs | null>(() => loadStoredPrefs());
  const [run, setRun] = useState<ScanRunRow | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noCandles, setNoCandles] = useState(false);

  const [view, setView] = useState<MixView>('MIX');
  const [mixMode, setMixMode] = useState<MixMode>('executable');
  const [invert, setInvert] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>('ALL');
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [tab, setTab] = useState<StatusTab>('ALL');
  const [tf, setTf] = useState('ALL');
  const [dir, setDir] = useState<Dir>('ALL');
  const [shown, setShown] = useState(PAGE);
  const [evals, setEvals] = useState<Map<string, EvaluationPair>>(new Map());

  const cfg = personal ?? globalCfg;
  const prefs = useMemo(() => userPrefs ?? defaultPrefs(publicCfg), [userPrefs, publicCfg]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, g, pub, latest] = await Promise.all([
        fetchMixPairs(),
        fetchPowerMixConfig(),
        fetchPublicConfig().catch(() => null),
        fetchLatestScanRun().catch(() => null),
      ]);
      const now = Date.now();
      const times = res.pairs.map((x) => signalTimeMs(x.original)).filter(Number.isFinite);
      const rng = candleRangeFor(times.length ? Math.min(...times) : null, now);
      let c: BtcCandle[] = [];
      try { c = await fetchBtcCandles(rng.from, rng.to); } catch { c = []; }
      let bts = new Map<string, PlusBacktest>();
      let failed = false;
      try { bts = await fetchBacktestsForIds(res.pairs.map((p) => p.reverse.id)); } catch { failed = true; }
      setPairs(res.pairs);
      setTruncated(res.truncated);
      setGlobalCfg(g);
      if (pub) setPublicCfg(pub);
      setRun(latest);
      setCandles(c);
      setBacktests(bts);
      setBtFailed(failed);
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

  // keep the page live once a minute while the tab is visible: today's BTC candles, the newest signals (new ones appear, open ones
  // resolve) and the backtests of signals that did not have one yet. Nothing is re-read in full.
  const busy = useRef(false);
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  const btRef = useRef(backtests);
  btRef.current = backtests;
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      if (document.hidden || busy.current) return;
      busy.current = true;
      const now = Date.now();
      void (async () => {
        try {
          const [fresh, latest] = await Promise.all([
            fetchBtcCandles(now - 2 * DAY_MS, now).catch(() => null),
            fetchMixPairs(LATEST_ROWS).catch(() => null),
          ]);
          if (fresh) { setCandles((prev) => mergeCandles(prev, fresh)); setNoCandles(false); }
          if (latest) {
            const merged = mergePairs(pairsRef.current, latest.pairs);
            setPairs(merged);
            const need = merged.slice(0, 300).map((p) => p.reverse.id).filter((rid) => !btRef.current.has(rid)).slice(0, 100);
            if (need.length) {
              const got = await fetchBacktestsForIds(need).catch(() => null);
              if (got && got.size) setBacktests((prev) => new Map([...prev, ...got]));
            }
          }
          setNowMs(now);
        } finally {
          busy.current = false;
        }
      })();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [user]);

  const analyzer = useMemo(() => createDayAnalyzer(candles, cfg, nowMs), [candles, cfg, nowMs]);
  const live = useMemo(() => analyzer.live(), [analyzer]);
  const rows = useMemo(() => buildMixRows(pairs, analyzer), [pairs, analyzer]);

  // ONE trade model for both sides: reverse = Reverse Plus backtest + the local scenario, original = its lab result in the same scenario
  const book: TradeBook = useMemo(() => buildTradeBook(pairs, { cfg: publicCfg, prefs, backtests }), [pairs, publicCfg, prefs, backtests]);
  const tradesOf = useCallback((row: MixRow) => book.get(row.id)!, [book]);

  const rangeOk = isOrdered(range);
  const dateRows = useMemo(
    () => (rangeOk ? rows.filter((r) => keyInRange(dayOf(r, mixMode).dayKey, range)) : rows),
    [rows, range, rangeOk, mixMode],
  );
  const dayRows = useMemo(() => dateRows.filter((r) => matchesDayFilter(r, dayFilter, mixMode)), [dateRows, dayFilter, mixMode]);
  const dayCounts = useMemo(
    () => Object.fromEntries(DAY_FILTERS.map((f) => [f, dateRows.filter((r) => matchesDayFilter(r, f, mixMode)).length])) as Record<DayFilter, number>,
    [dateRows, mixMode],
  );

  const views = useMemo(() => buildViews(dayRows, cfg, invert, mixMode, tradesOf), [dayRows, cfg, invert, mixMode, tradesOf]);
  const statsOriginal = useMemo(() => computeMixStats(views.original), [views]);
  const statsReverse = useMemo(() => computeMixStats(views.reverse), [views]);
  const statsMix = useMemo(() => computeMixStats(views.mix), [views]);
  const stats = view === 'MIX' ? statsMix : view === 'ORIGINAL' ? statsOriginal : statsReverse;
  const timeframes = useMemo(() => Array.from(new Set(dayRows.map((r) => r.original.timeframe))).sort(), [dayRows]);

  const history = useMemo(
    () => buildDayHistory(dateRows, analyzer, cfg, invert, mixMode, tradesOf),
    [dateRows, analyzer, cfg, invert, mixMode, tradesOf],
  );
  const missingBacktests = useMemo(() => dateRows.filter((r) => !backtests.has(r.id)).length, [dateRows, backtests]);

  const list = useMemo(() => {
    const out: { row: MixRow; trade: MixTrade }[] = [];
    for (const row of dayRows) {
      const side = displaySide(row, view, cfg, invert, mixMode);
      if (!side) continue;
      const trade = tradesOf(row)[side];
      if (tab !== 'ALL' && (trade.status as TradeStatus) !== tab) continue;
      if (tf !== 'ALL' && row.original.timeframe !== tf) continue;
      if (dir !== 'ALL' && row.original.signal_type !== dir) continue;
      out.push({ row, trade });
    }
    return out;
  }, [dayRows, view, cfg, invert, mixMode, tab, tf, dir, tradesOf]);
  const visible = useMemo(() => list.slice(0, shown), [list, shown]);

  // Reverse Plus enrichment (entry quality) only for the reverse cards that are on screen
  const reverseIds = useMemo(() => visible.filter((x) => x.trade.side === 'reverse').map((x) => x.row.reverse.id), [visible]);
  const idsKey = reverseIds.join(',');
  useEffect(() => {
    const missing = reverseIds.filter((id) => !evals.has(id));
    if (missing.length === 0) return;
    let alive = true;
    void fetchEvaluationsForIds(missing)
      .then((m) => { if (alive) setEvals((prev) => new Map([...prev, ...m])); })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const openTrade = useCallback((trade: MixTrade) => {
    const o = trade.outcome;
    if (trade.side === 'reverse') {
      navigate(isReversePlusEnabled()
        ? `/reverse-plus/signal/${encodeURIComponent(o.id)}`
        : `/asset/${o.symbol}?tf=${encodeURIComponent(o.timeframe)}&outcome=${encodeURIComponent(o.id)}&reverse=1`);
    } else {
      navigate(`/original-plus/signal/${encodeURIComponent(o.id)}`);
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
  const excludedText = t('pmExcludedDetail')
    .replace('{p}', formatNumber(ex.pending, lang, 0))
    .replace('{d}', formatNumber(ex.noData, lang, 0))
    .replace('{n}', formatNumber(ex.none, lang, 0));

  const statusTabs: { key: StatusTab; label: string }[] = [
    { key: 'ALL', label: t('all') }, { key: 'OPEN', label: t('open') }, { key: 'WIN', label: t('win') },
    { key: 'LOSS', label: t('loss') }, { key: 'EXPIRED', label: t('slExpired') },
  ];
  const dayLabel = (f: DayFilter) => (
    f === 'ALL' ? t('pmAllDays') : f === 'DEAD' ? t('pmDead') : f === 'PENDING' ? t('pmPending') : t(`pmClass${f}`)
  );
  const dayFilters = cfg.strongPct > 0 ? DAY_FILTERS : DAY_FILTERS.filter((f) => f !== 'STRONG'); // the Strong tier only exists while it is switched on
  const focusKey = range.from !== null && range.from === range.to ? range.from : null;
  const usd = (v: number) => `${v >= 0 ? '+' : ''}${formatNumber(v, lang, 2)}`;

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
          {/* تنظیمات — بالای صفحه */}
          <PowerMixSettingsPanel
            value={cfg}
            personal={personal !== null}
            onSave={(c) => { saveLocalOverride(c); setPersonal(c); }}
            onReset={() => { clearLocalOverride(); setPersonal(null); }}
          />

          <PowerMixLiveCard live={live} cfg={cfg} />
          {noCandles && <p className="text-xs text-warning-400">{t('pmNoCandles')}</p>}

          <PowerMixScenarioBar
            prefs={prefs}
            custom={userPrefs !== null}
            onSave={(p) => { saveStoredPrefs(p); setUserPrefs(p); }}
            onReset={() => { clearStoredPrefs(); setUserPrefs(null); }}
          />

          <p className="text-sm text-slate-400 leading-6">{t('pmDescription')}</p>
          {lastEval && (
            <p className="text-[11px] text-slate-500">
              {t('lastScanOutcomes')}: {formatDate(lastEval, lang)}
              {run && run.outcomes_closed != null ? ` · +${formatNumber(run.outcomes_opened ?? 0, lang, 0)} / ✓${formatNumber(run.outcomes_closed, lang, 0)}` : ''}
            </p>
          )}
          {truncated && <p className="text-xs text-warning-400">{t('pmTruncated').replace('{n}', formatNumber(MAX_MIX_ROWS, lang, 0))}</p>}
          {btFailed && <p className="text-xs text-warning-400">{t('pmBtFailed')}</p>}
          {!btFailed && missingBacktests > 0 && <p className="text-[11px] text-slate-500">{t('pmNoBacktest').replace('{n}', formatNumber(missingBacktests, lang, 0))}</p>}

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

                {/* بازهٔ تاریخ — بر اساس تقویم (شمسی / میلادی) */}
                <PowerMixDateRange value={range} nowMs={nowMs} onChange={(r) => { setRange(r); setShown(PAGE); }} />

                {view === 'MIX' && (
                  <div className="space-y-1.5">
                    <PillRow>
                      <Pill active={mixMode === 'executable'} onClick={() => { setMixMode('executable'); setShown(PAGE); }}>
                        {t('pmMixModeExecutable')}
                      </Pill>
                      <Pill active={mixMode === 'locked'} onClick={() => { setMixMode('locked'); setShown(PAGE); }}>
                        {t('pmMixModeLocked')}
                      </Pill>
                    </PillRow>
                    <p className="text-[11px] text-slate-500 leading-5">
                      {mixMode === 'executable' ? t('pmMixModeHintExecutable') : t('pmMixModeHintLocked')}
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-500">{t('pmDayType')}</p>
                  <PillRow>
                    {dayFilters.map((f) => (
                      <Pill key={f} active={dayFilter === f} onClick={() => { setDayFilter(f); setShown(PAGE); }}>
                        {dayLabel(f)} ({formatNumber(dayCounts[f], lang, 0)})
                      </Pill>
                    ))}
                  </PillRow>
                  {mixMode === 'locked' && (
                    <p className="text-[11px] text-slate-500 leading-5">{t('pmHindsightNote')}</p>
                  )}
                </div>
              </Card>

              <PowerMixDayHistory
                rows={history}
                cfg={cfg}
                focusKey={focusKey}
                onPick={(key) => { setRange(focusKey === key ? ALL_TIME : singleDay(key)); setShown(PAGE); }}
              />

              <PowerMixCompare original={statsOriginal} reverse={statsReverse} mix={statsMix} active={view} />
              {view === 'MIX' && excludedTotal > 0 && (
                <p className="text-[11px] text-slate-500">{t('pmExcluded')}: {formatNumber(excludedTotal, lang, 0)} — {excludedText}</p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <Stat label={t('slOpen')} value={formatNumber(stats.open, lang, 0)} />
                <Stat label={t('pmClosed')} value={formatNumber(stats.totalClosed, lang, 0)} hint={stats.noEntry ? `${t('pmNoEntry')}: ${formatNumber(stats.noEntry, lang, 0)}` : undefined} />
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
                <Stat label={t('pmNetUsd')} value={usd(stats.netUsd)} hint={`${t('pmTotalR')}: ${stats.totalR >= 0 ? '+' : ''}${formatNumber(stats.totalR, lang, 2)}`} color={stats.netUsd >= 0 ? 'text-success-400' : 'text-error-400'} />
                <Stat label={t('pmMaxDd')} value={formatNumber(stats.maxDrawdownUsd, lang, 2)} color={stats.maxDrawdownUsd > 0 ? 'text-warning-400' : 'text-slate-100'} />
                <Stat
                  label={t('pmBestWorst')}
                  value={stats.bestUsd === null || stats.worstUsd === null ? '—' : `${usd(stats.bestUsd)} / ${usd(stats.worstUsd)}`}
                />
                <Stat label={t('pmRoi')} value={formatPercent(stats.avgRoiPct, lang)} hint={stats.liquidations ? `${t('pmLiqCount')}: ${formatNumber(stats.liquidations, lang, 0)}` : undefined} color={stats.avgRoiPct >= 0 ? 'text-success-400' : 'text-error-400'} />
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
                    {visible.map(({ row, trade }) => {
                      const info = dayOf(row, mixMode);
                      return (
                        <div key={row.id} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 px-1">
                            <DayChips info={info} />
                            {view === 'MIX' && info.state === 'FINAL' && (
                              <Chip tone={trade.side === 'original' ? 'bg-success-500/10 text-success-400' : 'bg-primary-500/10 text-primary-300'}>
                                {trade.side === 'original' ? t('pmPickOriginal') : t('pmPickReverse')}
                              </Chip>
                            )}
                          </div>
                          <div className="px-1 w-28"><MarketThermometer reading={readThermo(info, cfg)} cfg={cfg} compact /></div>
                          <PowerMixSignalCard
                            trade={trade}
                            cfg={publicCfg}
                            prefs={prefs}
                            st={trade.side === 'reverse' ? evals.get(row.reverse.id)?.signalTime ?? null : null}
                            onOpen={openTrade}
                          />
                        </div>
                      );
                    })}
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

          <Disclaimer />
        </>
      )}
    </div>
  );
}
