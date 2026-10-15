import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchKlines, fetchTickers } from '@/services/marketData';
import { closedCandles, normalizeSymbol, quoteOf } from '@engine';
import {
  analyzeScalp,
  backtestScalp,
  htfBias as computeHtfBias,
  SCALP_HTF,
  DEFAULT_SCALP_CONFIG,
  type ScalpAnalysis,
  type ScalpBacktestStats,
  type ScalpConfig,
  type ScalpFactorKey,
  type ScalpTrade,
  type HtfBias,
} from '@scalp';
import type { Timeframe } from '@/types/market';
import { Card, EmptyState, ErrorState, LoadingSpinner, Disclaimer } from '@/components/UI';
import { SignalBadge, ScoreBar } from '@/components/Badges';
import { Metric, Chip, Pill, PillRow } from '@/components/Responsive';
import { VolumeProfileChart } from '@/components/VolumeProfileChart';
import { formatPrice, formatNumber, formatDate, formatCompact } from '@/i18n/format';
import { Zap, RefreshCw, FlaskConical } from 'lucide-react';

const SCALP_TFS: Timeframe[] = ['1m', '5m', '15m'];
const DEFAULT_SYMBOLS = 'BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, LINKUSDT, AVAXUSDT, SUIUSDT';
const CONCURRENCY = 4;
const AUTO_MS = 30_000;

interface Row {
  symbol: string;
  quoteVolume: number | null;
  htf: HtfBias | null;
  analysis: ScalpAnalysis;
}

interface BacktestResult {
  symbol: string;
  timeframe: Timeframe;
  stats: ScalpBacktestStats;
  trades: ScalpTrade[];
  candles: number;
  spanHours: number;
}

const FACTOR_LABEL: Record<ScalpFactorKey, { fa: string; en: string }> = {
  liquidity: { fa: 'نقدینگی', en: 'Liquidity' },
  structure: { fa: 'ساختار (MSS)', en: 'Structure (MSS)' },
  profile: { fa: 'ولیوم پروفایل', en: 'Volume Profile' },
  zone: { fa: 'FVG / اوردر بلاک', en: 'FVG / Order Block' },
  priceAction: { fa: 'پرایس اکشن', en: 'Price Action' },
  volume: { fa: 'حجم / جریان', en: 'Volume / Flow' },
  htf: { fa: 'تایم‌فریم بالا', en: 'Higher TF' },
};

const REJECT_LABEL: Record<string, { fa: string; en: string }> = {
  NO_PATTERN: { fa: 'کندل تأیید نیامد', en: 'No confirming candle' },
  LOW_VOLUME: { fa: 'حجم کم', en: 'Low volume' },
  LOW_SCORE: { fa: 'امتیاز کم', en: 'Low score' },
  TARGET_BLOCKED: { fa: 'سطح مقابل نزدیک', en: 'Wall too close' },
  COST_TOO_HIGH: { fa: 'کارمزد زیاد', en: 'Fees too high' },
  NET_RR_LOW: { fa: 'R/R خالص کم', en: 'Net R/R too low' },
  STOP_WIDE: { fa: 'استاپ دور', en: 'Stop too wide' },
  HTF_OPPOSED: { fa: 'خلاف تایم‌فریم بالا', en: 'Against higher TF' },
  FLOW_AGAINST: { fa: 'جریان خلاف جهت', en: 'Flow against' },
  SHORT_DISABLED: { fa: 'شورت غیرفعال', en: 'Shorts disabled' },
  HIGH_VOLATILITY: { fa: 'نوسان زیاد', en: 'High volatility' },
};

function parseSymbols(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    if (!raw.trim()) continue;
    const s = normalizeSymbol(raw); // "eth" -> ETHUSDT, "ETHBTC" stays a BTC pair
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 20);
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const rank = (r: Row) => (r.analysis.type === 'BUY' || r.analysis.type === 'SELL' ? 0 : r.analysis.type === 'WAIT' ? 1 : 2);

export function ScalpPage() {
  const { lang } = useSettings();
  const L = useCallback((fa: string, en: string) => (lang === 'fa' ? fa : en), [lang]);

  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS);
  const [useHtf, setUseHtf] = useState(true);
  const [costPct, setCostPct] = useState(DEFAULT_SCALP_CONFIG.costPct);
  const [minScore, setMinScore] = useState(DEFAULT_SCALP_CONFIG.minScore);
  const [riskPercent, setRiskPercent] = useState(DEFAULT_SCALP_CONFIG.riskPercent);
  const [minVolumeM, setMinVolumeM] = useState(50);
  const [auto, setAuto] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [btRunning, setBtRunning] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [bt, setBt] = useState<BacktestResult | null>(null);

  const config = useMemo<Partial<ScalpConfig>>(() => ({ costPct, minScore, riskPercent }), [costPct, minScore, riskPercent]);
  const busy = useRef(false);

  const scan = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const syms = parseSymbols(symbolsText);
      if (syms.length === 0) {
        setRows([]);
        return;
      }
      // "High volume" starts with liquidity: skip thin pairs before spending requests on them.
      const volumes = new Map<string, number>();
      try {
        const hasBtcPair = syms.some((x) => quoteOf(x) === 'BTC');
        const tickers = await fetchTickers(hasBtcPair ? [...syms, 'BTCUSDT'] : syms);
        const btcUsd = Number(tickers.find((t) => t.symbol === 'BTCUSDT')?.lastPrice ?? 0);
        // quote volume of a BTC pair is in BTC: convert to USD so one threshold works for every pair
        for (const t of tickers) volumes.set(t.symbol, Number(t.quoteVolume) * (quoteOf(t.symbol) === 'BTC' ? btcUsd : 1));
      } catch {
        /* tickers are optional; analysis still works without the liquidity filter */
      }
      const liquid = syms.filter((s) => !volumes.has(s) || (volumes.get(s) ?? 0) >= minVolumeM * 1_000_000);
      setSkipped(syms.filter((s) => !liquid.includes(s)));

      const htfTf = SCALP_HTF[timeframe] as Timeframe | undefined;
      const results = await mapPool(liquid, CONCURRENCY, async (symbol): Promise<Row | null> => {
        try {
          const [raw, rawHtf] = await Promise.all([
            fetchKlines(symbol, timeframe, 500),
            useHtf && htfTf ? fetchKlines(symbol, htfTf, 150) : Promise.resolve(null),
          ]);
          const bias = rawHtf ? computeHtfBias(closedCandles(rawHtf)) : null;
          const analysis = analyzeScalp(closedCandles(raw), { timeframe, config, htfBias: bias });
          if (!analysis) return null;
          return { symbol, quoteVolume: volumes.get(symbol) ?? null, htf: bias, analysis };
        } catch {
          return null;
        }
      });
      const ok = results.filter((r): r is Row => r !== null).sort((a, b) => rank(a) - rank(b) || b.analysis.score - a.analysis.score);
      if (ok.length === 0 && liquid.length > 0) setError(L('داده‌ای دریافت نشد. اتصال یا نام نمادها را بررسی کنید.', 'No data received. Check your connection or the symbols.'));
      setRows(ok);
      setLastRun(Date.now());
      setSelected((cur) => (cur && ok.some((r) => r.symbol === cur) ? cur : (ok[0]?.symbol ?? null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : L('خطا در دریافت داده', 'Failed to fetch data'));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [symbolsText, timeframe, useHtf, config, minVolumeM, L]);

  const scanRef = useRef(scan);
  useEffect(() => {
    scanRef.current = scan;
  }, [scan]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void scanRef.current(), AUTO_MS);
    return () => window.clearInterval(id);
  }, [auto]);

  const runBacktest = async (symbol: string) => {
    setBtRunning(true);
    setBtError(null);
    setBt(null);
    try {
      const htfTf = SCALP_HTF[timeframe] as Timeframe | undefined;
      const [raw, rawHtf] = await Promise.all([
        fetchKlines(symbol, timeframe, 1000),
        useHtf && htfTf ? fetchKlines(symbol, htfTf, 1000) : Promise.resolve(null),
      ]);
      const candles = closedCandles(raw);
      if (candles.length < 250) {
        setBtError(L('داده کافی برای بک‌تست نیست.', 'Not enough data for a backtest.'));
        return;
      }
      const { trades, stats } = backtestScalp(candles, { timeframe, config }, { htfCandles: rawHtf ? closedCandles(rawHtf) : undefined });
      setBt({
        symbol,
        timeframe,
        stats,
        trades,
        candles: candles.length,
        spanHours: (candles[candles.length - 1].closeTime - candles[0].openTime) / 3_600_000,
      });
    } catch (e) {
      setBtError(e instanceof Error ? e.message : L('خطا در دریافت داده', 'Failed to fetch data'));
    } finally {
      setBtRunning(false);
    }
  };

  const current = rows.find((r) => r.symbol === selected) ?? null;
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : fallback);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start gap-3">
        <Zap className="w-6 h-6 text-primary-400 shrink-0 mt-1" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100">{L('فست اسکالپ', 'Fast Scalp')}</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-6">
            {L(
              'ولیوم پروفایل + شکار نقدینگی/MSS/FVG/اوردر بلاک + پرایس اکشن، روی تایم‌فریم کوتاه. یک هدف کوچک، استاپ ساختاری و حذف معامله‌هایی که کارمزد سودشان را می‌خورد.',
              'Volume profile + liquidity sweep / MSS / FVG / order block + price action on short timeframes. One small target, a structural stop, and trades whose edge fees would eat are filtered out.',
            )}
          </p>
        </div>
      </div>

      <Card className="!p-3 sm:!p-5 space-y-3">
        <PillRow>
          {SCALP_TFS.map((tf) => (
            <Pill key={tf} active={timeframe === tf} onClick={() => setTimeframe(tf)}>
              {tf.toUpperCase()}
            </Pill>
          ))}
        </PillRow>

        <div>
          <label className="block text-xs text-slate-400 mb-1">{L('نمادها (جداشده با کاما)', 'Symbols (comma separated)')}</label>
          <input value={symbolsText} onChange={(e) => setSymbolsText(e.target.value)} className="input-field text-sm" dir="ltr" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{L('کارمزد رفت‌وبرگشت ٪', 'Round-trip fees %')}</label>
            <input type="number" step="0.01" min="0" value={costPct} onChange={(e) => setCostPct(num(e.target.value, DEFAULT_SCALP_CONFIG.costPct))} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{L('حداقل امتیاز', 'Min score')}</label>
            <input type="number" min="30" max="100" value={minScore} onChange={(e) => setMinScore(num(e.target.value, DEFAULT_SCALP_CONFIG.minScore))} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{L('ریسک هر معامله ٪', 'Risk per trade %')}</label>
            <input type="number" step="0.1" min="0.05" max="5" value={riskPercent} onChange={(e) => setRiskPercent(num(e.target.value, DEFAULT_SCALP_CONFIG.riskPercent))} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{L('حداقل حجم ۲۴س (میلیون $)', 'Min 24h volume ($M)')}</label>
            <input type="number" min="0" value={minVolumeM} onChange={(e) => setMinVolumeM(num(e.target.value, 50))} className="input-field text-sm" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={useHtf} onChange={(e) => setUseHtf(e.target.checked)} className="accent-primary-500" />
            {L(`فیلتر تایم‌فریم بالا (${SCALP_HTF[timeframe]})`, `Higher-TF filter (${SCALP_HTF[timeframe]})`)}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-primary-500" />
            {L('به‌روزرسانی خودکار هر ۳۰ ثانیه', 'Auto-refresh every 30 s')}
          </label>
          <button onClick={() => void scan()} disabled={loading} className="btn-primary text-sm ms-auto">
            <RefreshCw className={`w-4 h-4 inline me-1 ${loading ? 'animate-spin' : ''}`} />
            {loading ? L('در حال اسکن...', 'Scanning...') : L('اسکن', 'Scan')}
          </button>
        </div>
        {lastRun && (
          <p className="text-[11px] text-slate-500">
            {L('آخرین اسکن', 'Last scan')}: {formatDate(lastRun, lang)}
            {skipped.length > 0 && ` · ${L('رد شده به‌خاطر حجم کم', 'skipped for low volume')}: ${skipped.join(', ')}`}
          </p>
        )}
      </Card>

      {error && <ErrorState message={error} onRetry={() => void scan()} />}
      {loading && rows.length === 0 && <LoadingSpinner />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState message={L('برای شروع روی «اسکن» بزنید. فقط کندل‌های بسته‌شده تحلیل می‌شوند.', 'Press “Scan” to start. Only closed candles are analysed.')} />
      )}

      {rows.length > 0 && (
        <div className="grid gap-3">
          {rows.map((r) => (
            <SignalRow key={r.symbol} row={r} lang={lang} L={L} active={r.symbol === selected} onSelect={() => setSelected(r.symbol)} />
          ))}
        </div>
      )}

      {current && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-semibold text-slate-100" dir="ltr">
              {current.symbol} · {timeframe.toUpperCase()}
            </h2>
            <button onClick={() => void runBacktest(current.symbol)} disabled={btRunning} className="btn-secondary text-sm">
              <FlaskConical className="w-4 h-4 inline me-1" />
              {btRunning ? L('در حال بک‌تست...', 'Backtesting...') : L('بک‌تست این نماد', 'Backtest this symbol')}
            </button>
          </div>
          <Detail row={current} lang={lang} L={L} />
        </Card>
      )}

      {btError && <ErrorState message={btError} />}
      {bt && <BacktestPanel bt={bt} lang={lang} L={L} costPct={costPct} />}

      <Disclaimer />
    </div>
  );
}

type LFn = (fa: string, en: string) => string;
type Lang = 'fa' | 'en';

function tags(a: ScalpAnalysis, L: LFn): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  const good = 'bg-success-500/15 text-success-400';
  const info = 'bg-primary-500/15 text-primary-400';
  if (a.model) out.push({ text: a.model === 'REVERSAL' ? L('برگشتی', 'Reversal') : L('ادامه‌دهنده', 'Continuation'), tone: info });
  if (a.sweep) out.push({ text: a.sweep.equal ? 'Sweep EQ' : 'Sweep', tone: good });
  if (a.mss) out.push({ text: 'MSS', tone: good });
  if (a.fvg) out.push({ text: 'FVG', tone: good });
  if (a.orderBlock) out.push({ text: 'OB', tone: good });
  if (a.node) out.push({ text: a.node.kind, tone: good });
  if (a.valueReentry) out.push({ text: L('بازگشت به ارزش', 'VA re-entry'), tone: good });
  if (a.pattern) out.push({ text: a.pattern === 'ENGULFING' ? 'Engulfing' : a.pattern === 'PIN_BAR' ? 'Pin bar' : 'Momentum', tone: good });
  return out;
}

function SignalRow({ row, lang, L, active, onSelect }: { row: Row; lang: Lang; L: LFn; active: boolean; onSelect: () => void }) {
  const a = row.analysis;
  const live = a.type === 'BUY' || a.type === 'SELL';
  const plan = a.plan;
  return (
    <button
      onClick={onSelect}
      className={`card p-3 sm:p-4 text-start w-full transition-colors border ${active ? 'border-primary-500/60' : 'border-transparent hover:border-surface-300'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-semibold text-slate-100" dir="ltr">{row.symbol.replace(/USDT$/, '')}</span>
        <SignalBadge type={a.type} />
        <ScoreBar score={a.score} />
        {row.quoteVolume !== null && <span className="text-[11px] text-slate-500" dir="ltr">${formatCompact(row.quoteVolume, lang)}</span>}
        {row.htf && <Chip>{`HTF ${row.htf === 'BULLISH' ? '↑' : row.htf === 'BEARISH' ? '↓' : '→'}`}</Chip>}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {tags(a, L).map((tg) => (
          <Chip key={tg.text} tone={tg.tone}>{tg.text}</Chip>
        ))}
      </div>
      {live && plan ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-3">
          <Metric label={L('ورود', 'Entry')} value={formatPrice(plan.entry, lang)} />
          <Metric label={L('استاپ', 'Stop')} value={formatPrice(plan.stop, lang)} tone="text-error-400" />
          <Metric label={L('هدف', 'Target')} value={formatPrice(plan.target, lang)} tone="text-success-400" />
          <Metric label={L('R/R خالص', 'Net R/R')} value={`1:${formatNumber(plan.netRR, lang, 2)}`} />
          <Metric label={L('حجم پوزیشن', 'Size')} value={`$${formatNumber(plan.notional, lang, 0)}`} />
          <Metric label={L('خروج زمانی', 'Time stop')} value={`${plan.maxBars} ${L('کندل', 'bars')}`} />
        </div>
      ) : (
        a.reasons.length > 0 && (
          <p className="text-xs text-slate-400 mt-2 leading-5">{a.reasons.map((r) => (lang === 'fa' ? r.fa : r.en)).join(' · ')}</p>
        )
      )}
    </button>
  );
}

function Detail({ row, lang, L }: { row: Row; lang: Lang; L: LFn }) {
  const a = row.analysis;
  const live = a.type === 'BUY' || a.type === 'SELL';
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <VolumeProfileChart profile={a.profile} price={a.price} plan={live ? a.plan : null} />
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Metric label="ATR" value={`${formatNumber(a.atrPct, lang, 2)}%`} />
          <Metric label={L('حجم نسبی', 'Rel. volume')} value={a.relVolume === null ? '—' : `${formatNumber(a.relVolume, lang, 1)}×`} />
          <Metric label={L('دلتا', 'Delta')} value={a.delta === null ? '—' : `${formatNumber(a.delta * 100, lang, 0)}%`} />
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-2">{L('عوامل امتیاز', 'Score factors')}</h3>
          <ul className="space-y-1.5">
            {a.factors.map((f) => (
              <li key={f.key} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${f.positive ? 'bg-success-400' : 'bg-surface-400'}`} />
                <span className="min-w-0">
                  <span className="text-slate-200">{FACTOR_LABEL[f.key][lang]}</span>
                  <span className="text-slate-500"> · {f.score}/100 · w{f.weight}</span>
                  <span className="block text-xs text-slate-400">{lang === 'fa' ? f.fa : f.en}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {a.plan && (
          <div className="grid grid-cols-2 gap-3">
            <Metric label={L('فاصله استاپ', 'Stop distance')} value={`${formatNumber(a.plan.stopPct, lang, 2)}%`} />
            <Metric label={L('پاداش ناخالص', 'Gross reward')} value={`${formatNumber(a.plan.rewardR, lang, 2)}R`} />
            <Metric label={L('کارمزد از ۱R', 'Fees of 1R')} value={`${formatNumber(a.plan.costToRisk * 100, lang, 0)}%`} />
            <Metric label={L('نوع هدف', 'Target type')} value={a.plan.targetKind === 'R_MULTIPLE' ? L('ضریب R', 'R multiple') : a.plan.targetKind} />
          </div>
        )}

        {a.reasons.length > 0 && (
          <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
            <p className="text-xs font-semibold text-warning-400 mb-1">{L('چرا سیگنال نیست؟', 'Why not a signal?')}</p>
            <ul className="text-xs text-slate-300 space-y-0.5 list-disc ps-4">
              {a.reasons.map((r) => (
                <li key={r.code}>{lang === 'fa' ? r.fa : r.en}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function BacktestPanel({ bt, lang, L, costPct }: { bt: BacktestResult; lang: Lang; L: LFn; costPct: number }) {
  const s = bt.stats;
  const rejects = Object.entries(s.rejectCounts).sort((a, b) => b[1] - a[1]);
  const rejectMax = rejects[0]?.[1] ?? 1;
  const recent = bt.trades.slice(-12).reverse();
  const tone = s.expectancyR > 0 ? 'text-success-400' : s.expectancyR < 0 ? 'text-error-400' : 'text-slate-200';
  return (
    <Card>
      <h2 className="text-lg font-semibold text-slate-100 mb-1" dir="ltr">
        {L('بک‌تست', 'Backtest')} · {bt.symbol} · {bt.timeframe.toUpperCase()}
      </h2>
      <p className="text-[11px] text-slate-500 mb-4 leading-5">
        {L(
          `${bt.candles} کندل (حدود ${formatNumber(bt.spanHours, lang, 0)} ساعت). کارمزد ${costPct}٪ رفت‌وبرگشت کسر شده؛ استاپ قبل از هدف چک می‌شود؛ بعد از هر معامله ۳ کندل استراحت و سقف ضرر روزانه ۳R. این نمونه کوتاه است: نشانه است، نه اثبات.`,
          `${bt.candles} candles (~${formatNumber(bt.spanHours, lang, 0)} h). ${costPct}% round-trip fees deducted; stop is checked before target; 3-bar cooldown and a 3R daily loss cap. This is a short sample: an indication, not proof.`,
        )}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label={L('معاملات', 'Trades')} value={`${s.trades} (${s.wins}W / ${s.losses}L / ${s.expired}E)`} />
        <Metric label={L('درصد برد', 'Win rate')} value={`${formatNumber(s.winRate, lang, 1)}%`} />
        <Metric label={L('امید ریاضی', 'Expectancy')} value={`${formatNumber(s.expectancyR, lang, 2)}R`} tone={tone} />
        <Metric label={L('مجموع R', 'Total R')} value={`${formatNumber(s.totalR, lang, 2)}R`} tone={tone} />
        <Metric label="Profit factor" value={Number.isFinite(s.profitFactor) ? formatNumber(s.profitFactor, lang, 2) : '∞'} />
        <Metric label={L('حداکثر افت', 'Max drawdown')} value={`${formatNumber(s.maxDrawdownR, lang, 2)}R`} />
        <Metric label={L('میانگین نگهداری', 'Avg hold')} value={`${formatNumber(s.avgBars, lang, 1)} ${L('کندل', 'bars')}`} />
        <Metric label={L('ستاپ‌های دیده‌شده', 'Setups seen')} value={s.setupsSeen} />
      </div>

      {s.trades === 0 && (
        <p className="text-sm text-slate-300 mt-4 leading-6">
          {L(
            'در این بازه هیچ معامله‌ای همه‌ی فیلترها را رد نکرد. این خودش اطلاعات است: استراتژی انتخابی است و ترجیح می‌دهد معامله نکند.',
            'No setup passed every filter in this window. That is information too: the strategy is selective and prefers not to trade.',
          )}
        </p>
      )}

      {rejects.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">{L('ستاپ‌ها چرا معامله نشدند؟', 'Why setups did not become trades')}</h3>
          <ul className="space-y-1.5">
            {rejects.map(([code, count]) => (
              <li key={code} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 text-slate-300 truncate">{REJECT_LABEL[code]?.[lang] ?? code}</span>
                <span className="flex-1 h-1.5 rounded-full bg-surface-200 overflow-hidden">
                  <span className="block h-full bg-warning-500/70" style={{ width: `${(count / rejectMax) * 100}%` }} />
                </span>
                <span className="w-10 text-end tabular-nums text-slate-400">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">{L('آخرین معاملات', 'Latest trades')}</h3>
          <table className="w-full text-xs min-w-[460px]">
            <thead>
              <tr className="text-slate-500 text-start">
                <th className="text-start font-normal pb-1">{L('زمان', 'Time')}</th>
                <th className="text-start font-normal pb-1">{L('جهت', 'Side')}</th>
                <th className="text-start font-normal pb-1">{L('مدل', 'Model')}</th>
                <th className="text-start font-normal pb-1">{L('نتیجه', 'Result')}</th>
                <th className="text-end font-normal pb-1">R</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <tr key={t.entryTime} className="border-t border-surface-200">
                  <td className="py-1.5 text-slate-400">{formatDate(t.entryTime, lang)}</td>
                  <td className="py-1.5 text-slate-200">{t.direction === 'LONG' ? L('لانگ', 'Long') : L('شورت', 'Short')}</td>
                  <td className="py-1.5 text-slate-400">{t.model === 'REVERSAL' ? L('برگشتی', 'Reversal') : L('ادامه', 'Cont.')}</td>
                  <td className={`py-1.5 ${t.status === 'WIN' ? 'text-success-400' : t.status === 'LOSS' ? 'text-error-400' : 'text-slate-400'}`}>
                    {t.status === 'WIN' ? L('برد', 'Win') : t.status === 'LOSS' ? L('باخت', 'Loss') : t.status === 'EXPIRED' ? L('منقضی', 'Expired') : L('باز', 'Open')}
                  </td>
                  <td className="py-1.5 text-end tabular-nums text-slate-200">{t.rMultiple === null ? '—' : formatNumber(t.rMultiple, lang, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
