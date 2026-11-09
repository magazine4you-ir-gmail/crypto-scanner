import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Pause, Play, RefreshCw, SkipBack, SkipForward } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { Card, SectionTitle, LoadingSpinner, ErrorState } from '@/components/UI';
import { Metric, Chip, Pill, PillRow, TimeStamp } from '@/components/Responsive';
import { PriceChart, type ChartLine, type ChartMarker } from '@/components/PriceChart';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import { fetchReverseOutcomeById, type ReverseOutcome } from '@/services/reverseOutcomeService';
import { fetchBacktestFor, fetchEvaluationsFor, fetchPublicConfig, type PlusBacktest, type PlusEvaluation, type PlusPublicConfig } from '@/services/reversePlusService';
import { fetchKlinesRange } from '@/services/marketData';
import type { Candle, Timeframe } from '@/types/market';
import { isReversePlusEnabled } from '@/reversePlus/featureFlag';
import { rowToResult } from '@/reversePlus/backtestRows';
import {
  D, DEFAULT_LEVERAGES, COMPARE_LEVERAGES, EXPIRY_BARS_BY_TF, applyScenarioToBacktest, backtestSignal, buildScenario, compareLeverages, instructionFor, isHistoricalSignal,
  replayAt, replayEndCursor, toNumber, type BacktestResult, type BtCandle, type ScenarioParams, type SizingMode,
} from '../../supabase/functions/_shared/reversePlus/index';

const TF_MS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000, '1w': 604_800_000 };
const CHART_TFS: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
const normTf = (tf: string): Timeframe => (/^\d+M$/.test(tf) && Number(tf.slice(0, -1)) <= 30 ? (tf.toLowerCase() as Timeframe) : (tf as Timeframe));
const toBt = (c: Candle): BtCandle => ({ openTime: c.openTime, closeTime: c.closeTime, open: c.open, high: c.high, low: c.low, close: c.close });

const STATE_TONE: Record<string, string> = {
  ENTRY_ALLOWED: 'bg-success-500/10 border-success-500/30 text-success-400', TP_HIT: 'bg-success-500/10 border-success-500/30 text-success-400',
  POSITION_OPEN: 'bg-primary-600/10 border-primary-500/30 text-primary-300', APPROACHING_TP: 'bg-success-500/10 border-success-500/30 text-success-400',
  WAITING_FOR_ENTRY: 'bg-surface-100 border-surface-200 text-slate-300', APPROACHING_SL: 'bg-warning-500/10 border-warning-500/30 text-warning-400',
  SL_HIT: 'bg-error-500/10 border-error-500/30 text-error-400', INVALID: 'bg-error-500/10 border-error-500/30 text-error-400',
  NO_ENTRY: 'bg-surface-100 border-surface-200 text-slate-400', EXPIRED: 'bg-surface-100 border-surface-200 text-slate-400',
  AMBIGUOUS: 'bg-warning-500/10 border-warning-500/30 text-warning-400', UNKNOWN: 'bg-surface-100 border-surface-200 text-slate-400',
};

export function ReversePlusSignalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { lang } = useSettings();
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
  // scenario (LOCAL preview: never saved, never touches the public settings)
  const [lev, setLev] = useState(10);
  const [sizing, setSizing] = useState<SizingMode>('FIXED_RISK');
  const [amount, setAmount] = useState<string>('');
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
      if (!r) throw new Error('سیگنال پیدا نشد.');
      setRev(r); setSt(evs.signalTime); setLiveEval(evs.live); setStored(bt); setCfg(c);
      const stf = normTf(r.timeframe);
      const closeMs = r.candle_close_time ? Date.parse(r.candle_close_time) : Date.parse(r.signal_at);
      const stepMs = TF_MS[stf] ?? 3_600_000;
      const bars = EXPIRY_BARS_BY_TF[stf] ?? 48;
      const end = Math.min(Date.now(), closeMs + (bars * 2 + 5) * stepMs);
      const k = await fetchKlinesRange(r.symbol, stf, closeMs - 120 * stepMs, Math.max(end, Date.now() - 1), 1000);
      setAnalysis(k); setTf((prev) => prev ?? stf);
      if (c && !amount) setAmount(String(Math.min((c.account_balance * c.risk_pct) / 100, c.max_risk_per_trade)));
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

  const entryLevel = stored?.entry_level ?? st?.recommended_entry ?? null;
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
    if (!rev || entryLevel === null || stop === null || target === null || !cfg) return null;
    const a = Number(amount);
    return {
      side: rev.signal_type, entry: D(entryLevel), stop: D(stop), target: D(target), leverage: D(lev), mode: sizing, amount: Number.isFinite(a) && a > 0 ? D(a) : D(0),
      cost: { feePct: D(cfg.fee_pct), slippagePct: D(cfg.slippage_pct) }, assumedMmrPct: D(cfg.assumed_mmr_pct), liqSafetyFactor: D(cfg.liq_safety_factor), accountBalance: D(cfg.account_balance),
    };
  }, [rev, entryLevel, stop, target, cfg, lev, sizing, amount]);

  const scenario = useMemo(() => (params ? buildScenario(params) : null), [params]);
  const metrics = useMemo(() => (params && bt ? applyScenarioToBacktest(bt.r, params) : null), [params, bt]);
  const compare = useMemo(() => {
    if (!params) return null;
    const mk = (m: SizingMode, amt: number) => compareLeverages({ ...params, mode: m, amount: D(amt) }, COMPARE_LEVERAGES).map((x) => ({ ...x, m: bt ? applyScenarioToBacktest(bt.r, { ...params, mode: m, amount: D(amt), leverage: D(x.leverage) }) : null }));
    const riskAmt = cfg ? Math.min((cfg.account_balance * cfg.risk_pct) / 100, cfg.max_risk_per_trade) : 10;
    return { risk: mk('FIXED_RISK', sizing === 'FIXED_RISK' && Number(amount) > 0 ? Number(amount) : riskAmt), notional: mk('FIXED_NOTIONAL', sizing === 'FIXED_NOTIONAL' && Number(amount) > 0 ? Number(amount) : 1000) };
  }, [params, bt, sizing, amount, cfg]);

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

  if (!isReversePlusEnabled()) return <Card><p className="text-slate-300 text-sm">Reverse Plus غیرفعال است.</p></Card>;
  if (loading) return <LoadingSpinner />;
  if (error || !rev) return <ErrorState message={error ?? 'خطا'} onRetry={() => void load()} />;

  const p = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatPrice(v, lang));
  const dnum = (v: bigint | null, d = 4) => (v === null ? '—' : formatNumber(toNumber(v), lang, d));
  const isBuy = rev.signal_type === 'BUY';

  // chart content
  const lines: ChartLine[] = [];
  const zl = liveEval?.entry_range_low ?? st?.entry_range_low ?? rev.entry_low;
  const zh = liveEval?.entry_range_high ?? st?.entry_range_high ?? rev.entry_high;
  if (show.entry && entryLevel !== null) {
    lines.push({ price: Number(entryLevel), color: '#3b82f6', title: 'Entry', style: 0, width: 2 });
    if (zl != null) lines.push({ price: Number(zl), color: 'rgba(59,130,246,0.55)', title: 'Entry zone ↓', style: 3 });
    if (zh != null) lines.push({ price: Number(zh), color: 'rgba(59,130,246,0.55)', title: 'Entry zone ↑', style: 3 });
  }
  if (show.sl && stop !== null) lines.push({ price: stop, color: '#ef4444', title: 'SL', style: 2, width: 2 });
  if (show.tp && target !== null) lines.push({ price: target, color: '#10b981', title: 'TP', style: 2, width: 2 });
  if (show.liq && scenario) lines.push({ price: toNumber(scenario.liqPrice), color: '#f97316', title: `Liq ≈ ${lev}x`, style: 1 });
  if (show.price && lastPrice !== null && mode === 'LIVE') lines.push({ price: lastPrice, color: '#e2e8f0', title: 'Price', style: 0 });

  const markers: ChartMarker[] = [];
  if (signalClose) markers.push({ time: signalClose, position: isBuy ? 'belowBar' : 'aboveBar', color: '#a78bfa', shape: isBuy ? 'arrowUp' : 'arrowDown', text: 'Signal' });
  const evs = mode === 'REPLAY' ? replay?.events ?? [] : bt ? [
    ...(bt.r.entryTime ? [{ kind: 'ENTRY', time: bt.r.entryTime }] : []), ...(bt.r.exitTime && bt.r.exitReason ? [{ kind: bt.r.exitReason === 'TARGET' ? 'TARGET' : 'STOP', time: bt.r.exitTime }] : []),
  ] : [];
  for (const e of evs) {
    if (e.kind === 'ENTRY') markers.push({ time: e.time, position: 'belowBar', color: '#3b82f6', shape: 'circle', text: 'Entry' });
    if (e.kind === 'TARGET') markers.push({ time: e.time, position: 'aboveBar', color: '#10b981', shape: 'square', text: 'TP ✓' });
    if (e.kind === 'STOP') markers.push({ time: e.time, position: 'belowBar', color: '#ef4444', shape: 'square', text: 'SL ✗' });
  }
  const chartCandles: Candle[] = mode === 'REPLAY' && replay
    ? [...contextCandles, ...analysis.filter((c) => replay.visible.some((v) => v.openTime === c.openTime))]
    : view;

  const resultTone = (o?: string) => (o === 'WIN' ? 'bg-success-500/20 text-success-400' : o === 'LOSS' ? 'bg-error-500/20 text-error-400' : 'bg-surface-200 text-slate-300');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button className="text-xs text-primary-400 flex items-center gap-1 mb-2" onClick={() => navigate('/reverse-plus')}><ArrowRight className="w-3 h-3" />بازگشت به Reverse Plus</button>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            {rev.symbol}
            <Chip tone={isBuy ? 'bg-success-500/20 text-success-400' : 'bg-error-500/20 text-error-400'}>{isBuy ? 'LONG' : 'SHORT'}</Chip>
            <Chip>{rev.timeframe}</Chip>
            <Chip tone={histo ? 'bg-surface-200 text-slate-300' : 'bg-primary-600/20 text-primary-300'}>{histo ? 'HISTORICAL' : 'LIVE'}</Chip>
          </h1>
        </div>
        <button className="btn-secondary text-sm shrink-0" onClick={() => void load()} aria-label="refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {inst && (
        <div className={`p-3 rounded-lg border ${STATE_TONE[inst.state] ?? ''}`}>
          <p className="text-xs font-semibold mb-1">{inst.state}</p>
          <p className="text-sm leading-relaxed">{inst.text[lang]}</p>
          {st && st.status_reasons.length > 0 && inst.state === 'INVALID' && <p className="text-xs mt-1 opacity-80">{st.status_reasons.join(' · ')}</p>}
        </div>
      )}

      <Card className="!p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Symbol" value={rev.symbol} />
          <Metric label="Direction" value={isBuy ? 'LONG' : 'SHORT'} />
          <TimeStamp value={rev.signal_at} label="Signal Time" />
          <Metric label="Signal Price" value={p(rev.price_at_signal)} />
          <Metric label="Entry" value={p(entryLevel)} tone="text-primary-300" />
          <Metric label="Stop Loss" value={p(stop)} tone="text-error-400" />
          <Metric label="Take Profit" value={p(target)} tone="text-success-400" />
          <Metric label="Risk/Reward (net)" value={st?.rr_net == null ? '—' : formatNumber(st.rr_net, lang, 2)} />
          <Metric label="Timeframe" value={rev.timeframe} />
          <Metric label="Original Leverage" value={cfg ? `${cfg.leverage}x` : '—'} />
          <Metric label="Selected Leverage" value={`${lev}x`} tone="text-warning-400" />
          <Metric label="Current Price" value={p(lastPrice)} />
        </div>
        {st && <p className="text-[10px] text-slate-500 mt-2">وضعیت استراتژی هنگام صدور: {st.entry_status}{st.source === 'LEGACY_USER_COPY' ? ' · ارزیابی تاریخی قبلی (کپی‌شده از سوابق کاربران)' : ''}</p>}
      </Card>

      <Card className="!p-4 space-y-3">
        <PillRow>
          <Pill active={mode === 'LIVE'} onClick={() => setMode('LIVE')}>LIVE</Pill>
          <Pill active={mode === 'REPLAY'} onClick={() => { setMode('REPLAY'); if (signalTf) setTf(signalTf); }}>Historical Replay</Pill>
          <span className="w-px bg-surface-200 mx-1" />
          {CHART_TFS.map((x) => <Pill key={x} active={tf === x && mode === 'LIVE'} onClick={() => { setMode('LIVE'); setTf(x); }}>{x}</Pill>)}
        </PillRow>
        <div className="flex flex-wrap gap-2 text-xs">
          {([['entry', 'Entry'], ['tp', 'TP'], ['sl', 'SL'], ['liq', 'Liquidation'], ['price', 'Price']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1 text-slate-300"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{label}</label>
          ))}
          <button className="text-primary-400" onClick={() => setFit((n) => n + 1)}>نمایش کل محدوده</button>
          <button className="text-primary-400" onClick={() => setScroll((n) => n + 1)}>آخرین قیمت</button>
        </div>
        <p className="text-[10px] text-slate-500">زوم و جابه‌جایی با ماوس/لمس انجام می‌شود. تایم‌فریم نمودار با تایم‌فریم سیگنال ({rev.timeframe}) متفاوت می‌تواند باشد؛ بک‌تست همیشه روی تایم‌فریم سیگنال است.</p>
        {chartCandles.length === 0
          ? <p className="text-sm text-warning-400">Data Unavailable — کندل‌های این بازه از منبع بازار دریافت نشد.</p>
          : <PriceChart candles={chartCandles} showEMA20={false} showEMA50={false} showEMA200={false} extraLines={lines} markers={markers} fitSignal={fit} scrollSignal={scroll} heightClass="h-[360px] sm:h-[480px]" />}
        {mode === 'REPLAY' && (
          <div className="space-y-2">
            {!bt || afterCandles.length === 0 ? <p className="text-xs text-warning-400">برای بازپخش، کندل‌های بعد از سیگنال در دسترس نیست (Data Unavailable).</p> : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="btn-secondary text-sm" onClick={() => { setPlaying(false); setCursor((c) => Math.max(0, c - 1)); }} aria-label="prev"><SkipBack className="w-4 h-4" /></button>
                  <button className="btn-primary text-sm" onClick={() => { if (cursor >= endCursor) setCursor(0); setPlaying((x) => !x); }} aria-label="play">{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
                  <button className="btn-secondary text-sm" onClick={() => { setPlaying(false); setCursor((c) => Math.min(endCursor, c + 1)); }} aria-label="next"><SkipForward className="w-4 h-4" /></button>
                  {[1, 2, 4, 8].map((s) => <Pill key={s} active={speed === s} onClick={() => setSpeed(s)}>{s}x</Pill>)}
                  <span className="text-xs text-slate-400 tabular-nums">{cursor} / {endCursor} کندل</span>
                </div>
                <input type="range" className="w-full" min={0} max={endCursor} value={cursor} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} aria-label="replay position" />
                <p className="text-[11px] text-slate-400">وضعیت بازپخش: <b className="text-slate-200">{replay?.status}</b> — فقط کندل‌های واقعی نمایش داده می‌شوند؛ ورود و خروج هنگام رسیدن بازپخش به کندل مربوطه آشکار می‌شود.</p>
              </>
            )}
          </div>
        )}
      </Card>

      <Card className="!p-4 space-y-3">
        <SectionTitle className="!mb-0">اهرم و سناریو (پیش‌نمایش محلی؛ ذخیره نمی‌شود)</SectionTitle>
        <PillRow>{DEFAULT_LEVERAGES.map((l) => <Pill key={l} active={lev === l} onClick={() => setLev(l)}>{l}x</Pill>)}</PillRow>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className="input-field text-sm" value={sizing} onChange={(e) => { const m = e.target.value as SizingMode; setSizing(m); setAmount(m === 'FIXED_RISK' ? String(cfg ? Math.min((cfg.account_balance * cfg.risk_pct) / 100, cfg.max_risk_per_trade) : 10) : '1000'); }}>
            <option value="FIXED_RISK">Fixed Risk Amount (ریسک ثابت)</option>
            <option value="FIXED_NOTIONAL">Fixed Notional (حجم ثابت)</option>
          </select>
          <input className="input-field text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={sizing === 'FIXED_RISK' ? 'Risk (USDT)' : 'Notional (USDT)'} />
        </div>
        <p className="text-[11px] text-slate-500">تغییر اهرم هرگز Entry / TP / SL را تغییر نمی‌دهد و تنظیمات عمومی را عوض نمی‌کند. ریسک دلاری مستقل از اهرم است؛ اهرم فقط مارجین و قیمت لیکویید را تغییر می‌دهد.</p>
        {scenario && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="Initial Margin" value={dnum(scenario.margin)} />
              <Metric label="Position Notional" value={dnum(scenario.notional, 2)} />
              <Metric label="Risk Amount" value={dnum(scenario.riskAmount)} />
              <Metric label="Quantity" value={dnum(scenario.qty, 6)} />
              <Metric label="Est. Liquidation" value={`≈ ${p(toNumber(scenario.liqPrice))}`} tone="text-warning-400" />
              <Metric label="Liquidation Safety" value={`${formatNumber(toNumber(scenario.liqSafetyRatio), lang, 2)}× فاصله SL`} />
              <Metric label="Max Safe Leverage" value={`${formatNumber(toNumber(scenario.maxSafeLeverage), lang, 0)}x`} />
              <Metric label="Liq قبل از SL؟" value={scenario.stopBeforeLiq ? 'خیر' : 'بله'} tone={scenario.stopBeforeLiq ? 'text-success-400' : 'text-error-400'} />
              <Metric label="Net PnL @TP" value={dnum(scenario.netAtTarget)} tone="text-success-400" />
              <Metric label="Net PnL @SL" value={dnum(scenario.netAtStop)} tone="text-error-400" />
              <Metric label="ROI @TP (روی مارجین)" value={formatPercent(toNumber(scenario.roiAtTargetPct), lang)} />
              <Metric label="ROI @SL (روی مارجین)" value={formatPercent(toNumber(scenario.roiAtStopPct), lang)} />
            </div>
            <p className={`text-xs ${scenario.valid ? 'text-success-400' : 'text-error-400'}`}>
              {scenario.valid ? 'استراتژی با این اهرم قابل اجراست.' : `استراتژی با این اهرم نامعتبر است: ${scenario.issues.map((i) => ({ LIQ_BEFORE_STOP: 'لیکوییدیشن پیش از Stop Loss رخ می‌دهد', MARGIN_EXCEEDS_BALANCE: 'مارجین از موجودی مرجع بیشتر است', LEVERAGE_ABOVE_EXCHANGE_MAX: 'اهرم از سقف قرارداد بیشتر است', BAD_GEOMETRY: 'ترتیب Entry/TP/SL معتبر نیست', BAD_SIZE: 'حجم/ریسک نامعتبر است' }[i])).join('، ')}`}
            </p>
          </>
        )}
      </Card>

      {compare && (
        <Card className="!p-4 space-y-4">
          <SectionTitle className="!mb-0">مقایسه اهرم‌ها</SectionTitle>
          {([['risk', 'A) Fixed Risk Amount'], ['notional', 'B) Fixed Notional']] as const).map(([k, title]) => (
            <div key={k}>
              <p className="text-xs text-slate-300 mb-1 font-semibold">{title} — دو حالت با هم مخلوط نمی‌شوند</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead><tr className="text-slate-500"><th className="text-start py-1">Lev</th><th className="text-start">Margin</th><th className="text-start">Liq ≈</th><th className="text-start">Safety</th><th className="text-start">Net PnL</th><th className="text-start">ROI</th><th className="text-start">وضعیت</th></tr></thead>
                  <tbody>{compare[k].map((x) => (
                    <tr key={x.leverage} className="text-slate-200">
                      <td className="py-1">{x.leverage}x</td><td>{dnum(x.scenario.margin, 2)}</td><td>{p(toNumber(x.scenario.liqPrice))}</td>
                      <td>{formatNumber(toNumber(x.scenario.liqSafetyRatio), lang, 2)}×</td>
                      <td>{x.m?.netPnl != null ? dnum(x.m.netPnl, 2) : '—'}</td><td>{x.m?.roiPct != null ? formatPercent(toNumber(x.m.roiPct), lang) : '—'}</td>
                      <td className={x.scenario.valid ? 'text-success-400' : 'text-error-400'}>{x.m?.liquidated ? 'لیکوییدشده' : x.scenario.valid ? 'معتبر' : 'نامعتبر'}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">PnL/ROI فقط وقتی نمایش داده می‌شود که نتیجه واقعی (WIN/LOSS) موجود باشد. فاندینگ لحاظ نشده و قیمت لیکویید تخمینی است.</p>
        </Card>
      )}

      <Card className="!p-4 space-y-3">
        <SectionTitle className="!mb-0">نتیجه بک‌تست</SectionTitle>
        {!bt ? <p className="text-sm text-warning-400">Data Unavailable — سطح ورود برای این سیگنال ثبت نشده یا داده کافی نیست.</p> : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip tone={resultTone(bt.r.outcome)}>{bt.r.outcome}</Chip><Chip>{bt.r.reason}</Chip>
              <span className="text-[11px] text-slate-500">{bt.source === 'CENTRAL' ? 'نتیجه مرکزی ذخیره‌شده (برای همه یکسان)' : 'محاسبه محلی از کندل‌های واقعی (هنوز نتیجه مرکزی ثبت نشده)'}{bt.r.lowerTfUsed ? ' · ترتیب درون‌کندلی با تایم‌فریم پایین‌تر تعیین شد' : ''}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <TimeStamp value={bt.r.entryTime} label="Entry Time" />
              <Metric label="Entry Price" value={p(bt.r.entryPrice ? toNumber(bt.r.entryPrice) : null)} />
              <TimeStamp value={bt.r.exitTime} label="Exit Time" />
              <Metric label="Exit Price" value={p(bt.r.exitPrice ? toNumber(bt.r.exitPrice) : null)} />
              <Metric label="Gross PnL" value={dnum(metrics?.grossPnl ?? null)} />
              <Metric label="Fees" value={dnum(metrics?.fees ?? null)} />
              <Metric label="Slippage" value={dnum(metrics?.slippage ?? null)} />
              <Metric label="Net PnL" value={dnum(metrics?.netPnl ?? null)} tone={metrics?.netPnl != null && metrics.netPnl < 0n ? 'text-error-400' : 'text-success-400'} />
              <Metric label="ROI on Margin" value={metrics?.roiPct != null ? formatPercent(toNumber(metrics.roiPct), lang) : '—'} />
              <Metric label="R Multiple" value={metrics?.rMultiple != null ? formatNumber(toNumber(metrics.rMultiple), lang, 2) : '—'} />
              <Metric label="Holding" value={metrics?.holdingMs != null ? `${formatNumber(metrics.holdingMs / 3_600_000, lang, 1)} h` : '—'} />
              <Metric label="MFE / MAE (R)" value={metrics?.mfeR != null ? `${formatNumber(toNumber(metrics.mfeR), lang, 2)} / ${metrics?.maeR != null ? formatNumber(toNumber(metrics.maeR), lang, 2) : '—'}` : '—'} />
            </div>
            {metrics?.liquidated && <p className="text-xs text-error-400">با اهرم {lev}x قبل از خروج لیکویید می‌شد؛ زیان برابر کل مارجین فرض شده است (کارمزد لیکوییدیشن لحاظ نشده).</p>}
            <p className="text-[11px] text-slate-500 leading-relaxed">
              فرض‌ها: ورود با سفارش Limit در سطح Entry و فقط وقتی کندل واقعاً به آن برسد؛ برخورد SL/TP در یک کندل بدون ترتیب مشخص «نامشخص» ثبت می‌شود؛ گپ SL با قیمت باز (بدتر) و TP با قیمت TP محاسبه می‌شود؛
              کارمزد {cfg?.fee_pct}% و لغزش {cfg?.slippage_pct}% برای هر سمت فرض شده‌اند؛ فاندینگ لحاظ نشده (داده در دسترس نیست). معاملهٔ فرضی تاریخی هرگز PAPER یا LIVE ساخته نمی‌شود.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
