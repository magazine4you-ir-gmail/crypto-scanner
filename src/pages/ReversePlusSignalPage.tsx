import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Pause, Play, RefreshCw, SkipBack, SkipForward } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { Card, SectionTitle, LoadingSpinner, ErrorState } from '@/components/UI';
import { Metric, Chip, Pill, PillRow, TimeStamp } from '@/components/Responsive';
import { STATUS_CHIP_TONE } from '@/reversePlus/statusTone';
import { PriceChart, type ChartLine, type ChartMarker } from '@/components/PriceChart';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import { fetchReverseOutcomeById, type ReverseOutcome } from '@/services/reverseOutcomeService';
import { FALLBACK_PUBLIC_CONFIG, fetchBacktestFor, fetchEvaluationsFor, fetchPublicConfig, type PlusBacktest, type PlusEvaluation, type PlusPublicConfig } from '@/services/reversePlusService';
import { fetchKlinesRange } from '@/services/marketData';
import type { Candle, Timeframe } from '@/types/market';
import { isReversePlusEnabled } from '@/reversePlus/featureFlag';
import { rowToResult } from '@/reversePlus/backtestRows';
import { computeSignalSummary, entryOf, scenarioParams } from '@/reversePlus/summary';
import { useScenario } from '@/reversePlus/useScenario';
import {
  D, DEFAULT_LEVERAGES, COMPARE_LEVERAGES, EXPIRY_BARS_BY_TF, applyScenarioToBacktest, backtestSignal, buildScenario, compareLeverages, instructionFor, isHistoricalSignal,
  replayAt, replayEndCursor, toNumber, type BacktestResult, type BtCandle, type ScenarioParams, type SizingMode,
} from '../../supabase/functions/_shared/reversePlus/index';

const TF_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000, '1w': 604_800_000 };
const CHART_TFS: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
const normTf = (tf: string): Timeframe => (/^\d+M$/.test(tf) && Number(tf.slice(0, -1)) <= 30 ? (tf.toLowerCase() as Timeframe) : (tf as Timeframe));
const toBt = (c: Candle): BtCandle => ({ openTime: c.openTime, closeTime: c.closeTime, open: c.open, high: c.high, low: c.low, close: c.close });

// Guidance tones for an OPEN signal only (the primary status is the Reverse Lab status, shown separately).
const GUIDE_STATES = new Set(['WAITING_FOR_ENTRY', 'ENTRY_ALLOWED', 'POSITION_OPEN', 'APPROACHING_TP', 'APPROACHING_SL']);
const GUIDE_TONE: Record<string, string> = {
  ENTRY_ALLOWED: 'bg-success-500/10 border-success-500/30 text-success-400',
  POSITION_OPEN: 'bg-primary-600/10 border-primary-500/30 text-primary-300',
  APPROACHING_TP: 'bg-success-500/10 border-success-500/30 text-success-400',
  APPROACHING_SL: 'bg-warning-500/10 border-warning-500/30 text-warning-400',
  WAITING_FOR_ENTRY: 'bg-surface-100 border-surface-200 text-slate-300',
};
const BANNER_TONE: Record<string, string> = {
  OPEN: 'bg-warning-500/10 border-warning-500/30 text-warning-400',
  WIN: 'bg-success-500/10 border-success-500/30 text-success-400',
  LOSS: 'bg-error-500/10 border-error-500/30 text-error-400',
  EXPIRED: 'bg-surface-100 border-surface-200 text-slate-400',
  CANCELLED: 'bg-surface-100 border-surface-200 text-slate-400',
};

export function ReversePlusSignalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { lang, t } = useSettings();
  const [rev, setRev] = useState<ReverseOutcome | null>(null);
  const [st, setSt] = useState<PlusEvaluation | null>(null);
  const [liveEval, setLiveEval] = useState<PlusEvaluation | null>(null);
  const [stored, setStored] = useState<PlusBacktest | null>(null);
  const [cfg, setCfg] = useState<PlusPublicConfig | null>(null);
  const [analysis, setAnalysis] = useState<Candle[]>([]);   // signal timeframe: context before + candles after the signal
  const [view, setView] = useState<Candle[]>([]);           // display timeframe
  const [tf, setTf] = useState<Timeframe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'LIVE' | 'REPLAY'>('LIVE');
  const [show, setShow] = useState({ entry: true, tp: true, sl: true, liq: true, price: true });
  const [fit, setFit] = useState(0);
  const [scroll, setScroll] = useState(0);
  // scenario: LOCAL controls (leverage / sizing / amount) drive every calculation; optionally remembered in THIS browser only
  const cfgEff = cfg ?? FALLBACK_PUBLIC_CONFIG;
  const sc = useScenario(cfgEff);
  const { lev, sizing } = sc;
  // replay
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const signalTf = rev ? normTf(rev.timeframe) : null;
  const signalClose = rev?.candle_close_time ? Date.parse(rev.candle_close_time) : null;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const [r, evs, bt, c] = await Promise.all([fetchReverseOutcomeById(id), fetchEvaluationsFor(id), fetchBacktestFor(id), fetchPublicConfig()]);
      if (!r) throw new Error(t('rpNotFound'));
      setRev(r); setSt(evs.signalTime); setLiveEval(evs.live); setStored(bt); setCfg(c);
      const stf = normTf(r.timeframe);
      const closeMs = r.candle_close_time ? Date.parse(r.candle_close_time) : Date.parse(r.signal_at);
      const stepMs = TF_MS[stf] ?? 3_600_000;
      const bars = EXPIRY_BARS_BY_TF[stf] ?? 48;
      const end = Math.min(Date.now(), closeMs + (bars * 2 + 5) * stepMs);
      const k = await fetchKlinesRange(r.symbol, stf, closeMs - 120 * stepMs, Math.max(end, Date.now() - 1), 1000);
      setAnalysis(k); setTf((prev) => prev ?? stf);
      const histo = isHistoricalSignal(r.signal_at, c?.public_since);
      setMode(histo ? 'REPLAY' : 'LIVE');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // display timeframe candles (re-used from the analysis series when equal to the signal timeframe)
  useEffect(() => {
    if (!rev || !tf || !signalTf || !signalClose) return;
    if (tf === signalTf) { setView(analysis); return; }
    let alive = true;
    const step = TF_MS[tf] ?? 3_600_000;
    void fetchKlinesRange(rev.symbol, tf, signalClose - 120 * step, Date.now(), 1000).then((k) => { if (alive) setView(k); }).catch(() => { if (alive) setView([]); });
    return () => { alive = false; };
  }, [tf, analysis, rev, signalTf, signalClose]);

  // LIVE mode: refresh the latest price/candles
  useEffect(() => {
    if (mode !== 'LIVE' || !rev || !tf) return;
    const t = setInterval(() => {
      const step = TF_MS[tf] ?? 3_600_000;
      void fetchKlinesRange(rev.symbol, tf, Date.now() - 3 * step, Date.now()).then((k) => {
        setView((prev) => {
          const map = new Map(prev.map((c) => [c.openTime, c]));
          for (const c of k) map.set(c.openTime, c);
          return [...map.values()].sort((a, b) => a.openTime - b.openTime);
        });
      }).catch(() => undefined);
    }, 20_000);
    return () => clearInterval(t);
  }, [mode, rev, tf]);

  const entryLevel = rev ? entryOf(rev, st, stored?.entry_level ?? null) : null;
  const stop = rev ? Number(rev.stop_loss) : null;
  const target = rev ? Number(rev.target1) : null;
  const histo = !!rev && isHistoricalSignal(rev.signal_at, cfg?.public_since);

  // candles AFTER the signal, closed only, signal timeframe
  const afterCandles = useMemo<BtCandle[]>(() => {
    if (!signalClose) return [];
    const now = Date.now();
    return analysis.filter((c) => c.openTime > signalClose && c.closeTime <= now).map(toBt);
  }, [analysis, signalClose]);
  const contextCandles = useMemo(() => (signalClose ? analysis.filter((c) => c.closeTime <= signalClose) : []), [analysis, signalClose]);

  // result: stored central backtest (with lower-TF ordering) if present, else computed locally from the candles
  const bt: { r: BacktestResult; source: 'CENTRAL' | 'LOCAL' } | null = useMemo(() => {
    if (!rev || entryLevel === null || stop === null || target === null || !signalClose) return null;
    if (stored) return { r: rowToResult(stored), source: 'CENTRAL' };
    const tfk = normTf(rev.timeframe);
    const bars = EXPIRY_BARS_BY_TF[tfk] ?? 48;
    const r = backtestSignal({ side: rev.signal_type, entry: D(entryLevel), stop: D(stop), target: D(target), signalCloseTime: signalClose, candles: afterCandles, entryWindowBars: bars, maxHoldBars: bars });
    return { r, source: 'LOCAL' };
  }, [rev, stored, entryLevel, stop, target, signalClose, afterCandles]);

  const params = useMemo<ScenarioParams | null>(() => {
    if (!rev || entryLevel === null || stop === null || target === null) return null;
    return scenarioParams(rev, entryLevel, cfgEff, sc.prefs);
  }, [rev, entryLevel, stop, target, cfgEff, sc.prefs]);

  const scenario = useMemo(() => (params ? buildScenario(params) : null), [params]);
  const metrics = useMemo(() => (params && bt ? applyScenarioToBacktest(bt.r, params) : null), [params, bt]);
  const summary = useMemo(
    () => (rev ? computeSignalSummary({ rev, st, live: liveEval, cfg: cfgEff, prefs: sc.prefs, backtestEntry: stored?.entry_level ?? null }) : null),
    [rev, st, liveEval, cfgEff, sc.prefs, stored],
  );
  const compare = useMemo(() => {
    if (!params) return null;
    const mk = (m: SizingMode, amt: number) => compareLeverages({ ...params, mode: m, amount: D(Number.isFinite(amt) && amt > 0 ? amt : 0) }, COMPARE_LEVERAGES)
      .map((x) => ({ ...x, m: bt ? applyScenarioToBacktest(bt.r, { ...params, mode: m, amount: D(Number.isFinite(amt) && amt > 0 ? amt : 0), leverage: D(x.leverage) }) : null }));
    return { risk: mk('FIXED_RISK', Number(sc.riskValue)), notional: mk('FIXED_NOTIONAL', Number(sc.notionalValue)) };
  }, [params, bt, sc.riskValue, sc.notionalValue]);

  // replay
  const endCursor = useMemo(() => (bt ? replayEndCursor(afterCandles, bt.r) : 0), [afterCandles, bt]);
  useEffect(() => { setCursor(0); setPlaying(false); }, [id, mode]);
  useEffect(() => {
    if (!playing) return;
    if (cursor >= endCursor) { setPlaying(false); return; }
    const t = setTimeout(() => setCursor((c) => Math.min(endCursor, c + 1)), 800 / speed);
    return () => clearTimeout(t);
  }, [playing, cursor, endCursor, speed]);

  const replay = useMemo(() => (bt && signalClose ? replayAt(afterCandles, bt.r, signalClose, cursor) : null), [afterCandles, bt, signalClose, cursor]);

  const lastPrice = view.length ? view[view.length - 1].close : null;
  const inst = useMemo(() => {
    if (!rev) return null;
    const useBt = mode === 'REPLAY' ? (replay && replay.finished && bt ? bt.r.outcome : null) : (bt && ['WIN', 'LOSS', 'NO_ENTRY', 'EXPIRED', 'AMBIGUOUS'].includes(bt.r.outcome) ? bt.r.outcome : null);
    const open = mode === 'REPLAY' ? replay?.status === 'POSITION_OPEN' : !!bt && bt.r.entryTime !== null && !useBt;
    return instructionFor({
      mode: histo ? 'HISTORICAL' : 'LIVE', evalStatus: (mode === 'LIVE' ? liveEval?.entry_status : st?.entry_status) ?? st?.entry_status ?? null, backtest: useBt, positionOpen: open,
      pctToTarget: lastPrice && target ? (Math.abs(target - lastPrice) / lastPrice) * 100 : null, pctToStop: lastPrice && stop ? (Math.abs(stop - lastPrice) / lastPrice) * 100 : null,
      approachPct: cfg?.approach_pct,
    });
  }, [rev, mode, replay, bt, histo, liveEval, st, lastPrice, target, stop, cfg]);

  if (!isReversePlusEnabled()) return <Card><p className="text-slate-300 text-sm">{t('rpDisabledPage')}</p></Card>;
  if (loading) return <LoadingSpinner />;
  if (error || !rev) return <ErrorState message={error ?? t('rpError')} onRetry={() => void load()} />;

  const p = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatPrice(v, lang));
  const dnum = (v: bigint | null, d = 4) => (v === null ? '—' : formatNumber(toNumber(v), lang, d));
  const n2 = (v: number | null | undefined) => (v == null ? '—' : formatNumber(v, lang, 2));
  const isBuy = rev.signal_type === 'BUY';
  const sideLabel = isBuy ? t('rpLong') : t('rpShort');
  const outLabel = (o: string) => { const k = `rpOut${o}`; return t(k) === k ? '—' : t(k); };
  const stateLabel = (s: string) => { const k = `rpSim${s}`; return t(k) === k ? '—' : t(k); };
  const guide = rev.status === 'OPEN' && inst && GUIDE_STATES.has(inst.state) ? inst : null;

  // chart content
  const lines: ChartLine[] = [];
  const zl = rev.entry_low ?? liveEval?.entry_range_low ?? st?.entry_range_low ?? null;
  const zh = rev.entry_high ?? liveEval?.entry_range_high ?? st?.entry_range_high ?? null;
  if (show.entry && entryLevel !== null) {
    lines.push({ price: Number(entryLevel), color: '#3b82f6', title: t('rpChartEntry'), style: 0, width: 2 });
    if (zl != null) lines.push({ price: Number(zl), color: 'rgba(59,130,246,0.55)', title: `${t('rpChartEntry')} ↓`, style: 3 });
    if (zh != null) lines.push({ price: Number(zh), color: 'rgba(59,130,246,0.55)', title: `${t('rpChartEntry')} ↑`, style: 3 });
  }
  if (show.sl && stop !== null) lines.push({ price: stop, color: '#ef4444', title: t('rpChartSl'), style: 2, width: 2 });
  if (show.tp && target !== null) lines.push({ price: target, color: '#10b981', title: t('rpChartTp'), style: 2, width: 2 });
  if (show.liq && scenario) lines.push({ price: toNumber(scenario.liqPrice), color: '#f97316', title: `${t('rpChartLiq')} ≈ ${lev}x`, style: 1 });
  if (show.price && lastPrice !== null && mode === 'LIVE') lines.push({ price: lastPrice, color: '#e2e8f0', title: t('rpChartPrice'), style: 0 });

  const markers: ChartMarker[] = [];
  if (signalClose) markers.push({ time: signalClose, position: isBuy ? 'belowBar' : 'aboveBar', color: '#a78bfa', shape: isBuy ? 'arrowUp' : 'arrowDown', text: t('rpChartSignal') });
  const evs = mode === 'REPLAY' ? replay?.events ?? [] : bt ? [
    ...(bt.r.entryTime ? [{ kind: 'ENTRY', time: bt.r.entryTime }] : []), ...(bt.r.exitTime && bt.r.exitReason ? [{ kind: bt.r.exitReason === 'TARGET' ? 'TARGET' : 'STOP', time: bt.r.exitTime }] : []),
  ] : [];
  for (const e of evs) {
    if (e.kind === 'ENTRY') markers.push({ time: e.time, position: 'belowBar', color: '#3b82f6', shape: 'circle', text: t('rpChartEntry') });
    if (e.kind === 'TARGET') markers.push({ time: e.time, position: 'aboveBar', color: '#10b981', shape: 'square', text: `${t('rpChartTp')} ✓` });
    if (e.kind === 'STOP') markers.push({ time: e.time, position: 'belowBar', color: '#ef4444', shape: 'square', text: `${t('rpChartSl')} ✗` });
  }
  const chartCandles: Candle[] = mode === 'REPLAY' && replay
    ? [...contextCandles, ...analysis.filter((c) => replay.visible.some((v) => v.openTime === c.openTime))]
    : view;

  const resultTone = (o?: string) => (o === 'WIN' ? 'bg-success-500/20 text-success-400' : o === 'LOSS' ? 'bg-error-500/20 text-error-400' : 'bg-surface-200 text-slate-300');
  const noteOf = (i: string) => { const k = `rpNote${i}`; return t(k) === k ? null : t(k); };
  const notes = scenario ? scenario.issues.map(noteOf).filter((x): x is string => !!x) : [];
  const amountMissing = !!scenario && scenario.issues.includes('BAD_SIZE');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button className="text-xs text-primary-400 flex items-center gap-1 mb-2" onClick={() => navigate('/reverse-plus')}><ArrowRight className="w-3 h-3" />{t('rpBack')}</button>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            {rev.symbol}
            <Chip tone={isBuy ? 'bg-success-500/20 text-success-400' : 'bg-error-500/20 text-error-400'}>{sideLabel}</Chip>
            <Chip>{rev.timeframe}</Chip>
            <Chip tone={STATUS_CHIP_TONE[rev.status]}>{t(`rpSt${rev.status}`)}</Chip>
          </h1>
        </div>
        <button className="btn-secondary text-sm shrink-0" onClick={() => void load()} aria-label={t('rpRefresh')}><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className={`p-3 rounded-lg border ${BANNER_TONE[rev.status] ?? ''}`}>
        <p className="text-sm font-semibold">{t(`rpSt${rev.status}`)}</p>
        <p className="text-sm leading-relaxed mt-0.5">{t(`rpBanner${rev.status}`)}</p>
        {guide && <p className={`text-sm leading-relaxed mt-2 pt-2 border-t border-current/20 ${GUIDE_TONE[guide.state]?.split(' ').pop() ?? ''}`}>{guide.text[lang]}</p>}
      </div>

      <Card className="!p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label={t('rpSymbol')} value={rev.symbol} />
          <Metric label={t('rpDirection')} value={sideLabel} />
          <TimeStamp value={rev.signal_at} label={t('rpSignalTime')} />
          <Metric label={t('rpSignalPrice')} value={p(rev.price_at_signal)} />
          <Metric label={t('rpRecommended')} value={p(entryLevel)} tone="text-primary-300" />
          <Metric label={t('rpStopReverse')} value={p(stop)} tone="text-error-400" />
          <Metric label={t('rpTargetReverse')} value={p(target)} tone="text-success-400" />
          <Metric label={t('rpEntryZone')} value={zl != null && zh != null ? `${p(Number(zl))} – ${p(Number(zh))}` : '—'} />
          <Metric label={t('rpRrNet')} value={n2(summary?.rrNet)} />
          <Metric label={t('rpRrGross')} value={n2(summary?.rrGross)} />
          <Metric label={t('rpTimeframe')} value={rev.timeframe} />
          <Metric label={t('rpSelectedLeverage')} value={`${lev}x`} tone="text-warning-400" />
          <Metric label={rev.status === 'OPEN' ? t('rpCurrentPrice') : t('rpExitPrice')} value={p(rev.status === 'OPEN' ? (lastPrice ?? summary?.price) : rev.exit_price)} />
          <Metric label={t('rpQuality')} value={summary?.qualityPct == null ? '—' : `${formatNumber(summary.qualityPct, lang, 0)}٪`} />
        </div>
        <p className="text-[11px] text-slate-500 mt-3">{t('rpRrBasis')}</p>
      </Card>

      <Card className="!p-4 space-y-3">
        <PillRow>
          <Pill active={mode === 'LIVE'} onClick={() => setMode('LIVE')}>{t('rpLive')}</Pill>
          <Pill active={mode === 'REPLAY'} onClick={() => { setMode('REPLAY'); if (signalTf) setTf(signalTf); }}>{t('rpReplay')}</Pill>
          <span className="w-px bg-surface-200 mx-1" />
          {CHART_TFS.map((x) => <Pill key={x} active={tf === x && mode === 'LIVE'} onClick={() => { setMode('LIVE'); setTf(x); }}>{x}</Pill>)}
        </PillRow>
        <div className="flex flex-wrap gap-2 text-xs">
          {([['entry', t('rpChartEntry')], ['tp', t('rpChartTp')], ['sl', t('rpChartSl')], ['liq', t('rpChartLiq')], ['price', t('rpChartPrice')]] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1 text-slate-300"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{label}</label>
          ))}
          <button className="text-primary-400" onClick={() => setFit((n) => n + 1)}>{t('rpChartFit')}</button>
          <button className="text-primary-400" onClick={() => setScroll((n) => n + 1)}>{t('rpChartLast')}</button>
        </div>
        <p className="text-[10px] text-slate-500">{t('rpChartHint')}</p>
        {chartCandles.length === 0
          ? <p className="text-sm text-warning-400">{t('rpDataUnavailable')} — {t('rpChartNoCandles')}</p>
          : <PriceChart candles={chartCandles} showEMA20={false} showEMA50={false} showEMA200={false} extraLines={lines} markers={markers} fitSignal={fit} scrollSignal={scroll} heightClass="h-[360px] sm:h-[480px]" />}
        {mode === 'REPLAY' && (
          <div className="space-y-2">
            {!bt || afterCandles.length === 0 ? <p className="text-xs text-warning-400">{t('rpDataUnavailable')} — {t('rpReplayNoCandles')}</p> : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="btn-secondary text-sm" onClick={() => { setPlaying(false); setCursor((c) => Math.max(0, c - 1)); }} aria-label="prev"><SkipBack className="w-4 h-4" /></button>
                  <button className="btn-primary text-sm" onClick={() => { if (cursor >= endCursor) setCursor(0); setPlaying((x) => !x); }} aria-label="play">{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
                  <button className="btn-secondary text-sm" onClick={() => { setPlaying(false); setCursor((c) => Math.min(endCursor, c + 1)); }} aria-label="next"><SkipForward className="w-4 h-4" /></button>
                  {[1, 2, 4, 8].map((s) => <Pill key={s} active={speed === s} onClick={() => setSpeed(s)}>{s}x</Pill>)}
                  <span className="text-xs text-slate-400 tabular-nums">{cursor} / {endCursor} {t('rpReplayCandles')}</span>
                </div>
                <input type="range" className="w-full" min={0} max={endCursor} value={cursor} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} aria-label="replay position" />
                <p className="text-[11px] text-slate-400">{t('rpReplayState')}: <b className="text-slate-200">{replay ? stateLabel(replay.status) : '—'}</b> — {t('rpReplayNote')}</p>
              </>
            )}
          </div>
        )}
      </Card>

      <Card className="!p-4 space-y-3">
        <SectionTitle className="!mb-0">{t('rpScenarioTitle')}</SectionTitle>
        <PillRow>{DEFAULT_LEVERAGES.map((l) => <Pill key={l} active={lev === l} onClick={() => sc.setLev(l)}>{l}x</Pill>)}</PillRow>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className="input-field text-sm" value={sizing} onChange={(e) => sc.setSizing(e.target.value as SizingMode)} aria-label={t('rpScenarioTitle')}>
            <option value="FIXED_RISK">{t('rpSizingRisk')}</option>
            <option value="FIXED_NOTIONAL">{t('rpSizingNotional')}</option>
          </select>
          <input className="input-field text-sm" inputMode="decimal" value={sc.amount} onChange={(e) => sc.setAmount(e.target.value)} placeholder={sizing === 'FIXED_RISK' ? t('rpAmountRisk') : t('rpAmountNotional')} aria-label={sizing === 'FIXED_RISK' ? t('rpAmountRisk') : t('rpAmountNotional')} />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={sc.remember} onChange={(e) => sc.toggleRemember(e.target.checked)} />{t('rpRemember')}
          </label>
          <button className="text-xs text-primary-400" onClick={sc.reset}>{t('rpResetScenario')}</button>
        </div>
        {sc.remember && <p className="text-[11px] text-success-400">{t('rpRememberOn')}</p>}
        <p className="text-[11px] text-slate-500">{t('rpScenarioNote')}</p>
        {scenario && (
          <>
            {amountMissing && <p className="text-xs text-warning-400">{t('rpEnterAmount')}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label={t('rpInitialMargin')} value={amountMissing ? '—' : dnum(scenario.margin)} />
              <Metric label={t('rpNotional')} value={amountMissing ? '—' : dnum(scenario.notional, 2)} />
              <Metric label={t('rpRiskUsd')} value={amountMissing ? '—' : dnum(scenario.riskAmount)} />
              <Metric label={t('rpQty')} value={amountMissing ? '—' : dnum(scenario.qty, 6)} />
              <Metric label={t('rpLiq')} value={`≈ ${p(toNumber(scenario.liqPrice))}`} tone="text-warning-400" />
              <Metric label={t('rpLiqSafety')} value={`${formatNumber(toNumber(scenario.liqSafetyRatio), lang, 2)} ${t('rpLiqSafetyUnit')}`} />
              <Metric label={t('rpMaxSafeLev')} value={`${formatNumber(toNumber(scenario.maxSafeLeverage), lang, 0)}x`} />
              <Metric label={t('rpLiqBeforeStop')} value={scenario.stopBeforeLiq ? t('rpNo') : t('rpYes')} tone={scenario.stopBeforeLiq ? 'text-success-400' : 'text-warning-400'} />
              <Metric label={t('rpNetAtTp')} value={amountMissing ? '—' : dnum(scenario.netAtTarget)} tone="text-success-400" />
              <Metric label={t('rpNetAtSl')} value={amountMissing ? '—' : dnum(scenario.netAtStop)} tone="text-error-400" />
              <Metric label={t('rpRoiAtTp')} value={amountMissing ? '—' : formatPercent(toNumber(scenario.roiAtTargetPct), lang)} />
              <Metric label={t('rpRoiAtSl')} value={amountMissing ? '—' : formatPercent(toNumber(scenario.roiAtStopPct), lang)} />
            </div>
            {notes.length > 0
              ? <p className="text-xs text-warning-400">{t('rpNotePrefix')} {notes.join('، ')}.</p>
              : <p className="text-xs text-success-400">{t('rpNoteSafeOk')}</p>}
            <p className="text-[11px] text-slate-500">{t('rpEstimateNote')}</p>
          </>
        )}
      </Card>

      {compare && (
        <Card className="!p-4 space-y-4">
          <SectionTitle className="!mb-0">{t('rpCompareTitle')}</SectionTitle>
          {([['risk', t('rpCompareRisk')], ['notional', t('rpCompareNotional')]] as const).map(([k, title]) => (
            <div key={k}>
              <p className="text-xs text-slate-300 mb-1 font-semibold">{title} — {t('rpCompareSeparate')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead><tr className="text-slate-500"><th className="text-start py-1">{t('rpColLev')}</th><th className="text-start">{t('rpMargin')}</th><th className="text-start">{t('rpLiq')}</th><th className="text-start">{t('rpLiqSafety')}</th><th className="text-start">{t('rpColNet')}</th><th className="text-start">ROI</th><th className="text-start">{t('rpColNote')}</th></tr></thead>
                  <tbody>{compare[k].map((x) => (
                    <tr key={x.leverage} className="text-slate-200">
                      <td className="py-1">{x.leverage}x</td><td>{dnum(x.scenario.margin, 2)}</td><td>{p(toNumber(x.scenario.liqPrice))}</td>
                      <td>{formatNumber(toNumber(x.scenario.liqSafetyRatio), lang, 2)}×</td>
                      <td>{x.m?.netPnl != null ? dnum(x.m.netPnl, 2) : '—'}</td><td>{x.m?.roiPct != null ? formatPercent(toNumber(x.m.roiPct), lang) : '—'}</td>
                      <td className={x.m?.liquidated || !x.scenario.stopBeforeLiq ? 'text-warning-400' : 'text-slate-400'}>{x.m?.liquidated ? t('rpLiquidated') : x.scenario.stopBeforeLiq ? t('rpStopFirst') : t('rpLiqFirst')}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">{t('rpCompareNote')}</p>
        </Card>
      )}

      <Card className="!p-4 space-y-3">
        <SectionTitle className="!mb-0">{t('rpSimTitle')}</SectionTitle>
        {!bt ? <p className="text-sm text-warning-400">{t('rpDataUnavailable')}</p> : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip tone={resultTone(bt.r.outcome)}>{outLabel(bt.r.outcome)}</Chip>
              <span className="text-[11px] text-slate-500">{bt.source === 'CENTRAL' ? t('rpSimCentral') : t('rpSimLocal')}{bt.r.lowerTfUsed ? ` · ${t('rpSimLowerTf')}` : ''}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <TimeStamp value={bt.r.entryTime} label={t('rpEntryTime')} />
              <Metric label={t('rpEntryPrice')} value={p(bt.r.entryPrice ? toNumber(bt.r.entryPrice) : null)} />
              <TimeStamp value={bt.r.exitTime} label={t('rpExitTime')} />
              <Metric label={t('rpExitPrice')} value={p(bt.r.exitPrice ? toNumber(bt.r.exitPrice) : null)} />
              <Metric label={t('rpGrossPnl')} value={dnum(metrics?.grossPnl ?? null)} />
              <Metric label={t('rpFees')} value={dnum(metrics?.fees ?? null)} />
              <Metric label={t('rpSlippage')} value={dnum(metrics?.slippage ?? null)} />
              <Metric label={t('rpNetPnl')} value={dnum(metrics?.netPnl ?? null)} tone={metrics?.netPnl != null && metrics.netPnl < 0n ? 'text-error-400' : 'text-success-400'} />
              <Metric label={t('rpRoiMargin')} value={metrics?.roiPct != null ? formatPercent(toNumber(metrics.roiPct), lang) : '—'} />
              <Metric label={t('rpRMultiple')} value={metrics?.rMultiple != null ? formatNumber(toNumber(metrics.rMultiple), lang, 2) : '—'} />
              <Metric label={t('rpHolding')} value={metrics?.holdingMs != null ? `${formatNumber(metrics.holdingMs / 3_600_000, lang, 1)} ${t('rpHoursShort')}` : '—'} />
              <Metric label={t('rpMfeMae')} value={metrics?.mfeR != null ? `${formatNumber(toNumber(metrics.mfeR), lang, 2)} / ${metrics?.maeR != null ? formatNumber(toNumber(metrics.maeR), lang, 2) : '—'}` : '—'} />
            </div>
            {metrics?.liquidated && <p className="text-xs text-warning-400">{t('rpLiquidatedNote')}</p>}
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {t('rpSimAssumptions')} {t('rpFeeAssumption')}: {cfgEff.fee_pct}٪ · {t('rpSlipAssumption')}: {cfgEff.slippage_pct}٪.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
