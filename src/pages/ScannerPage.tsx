import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { fetchKlinesValidated, fetchScanUniverse } from '@/services/marketData';
import { analyze, optionsFromSettings } from '@/engine/signalEngine';
import type { SignalResult } from '@/types/signal';
import type { Timeframe } from '@/types/market';
import { TIMEFRAMES } from '@/types/market';
import { Card, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { SignalBadge, TrendBadge, RiskBadge, ScoreBar } from '@/components/Badges';
import { Metric, TimeStamp, Chip } from '@/components/Responsive';
import { TrackButton } from '@/components/TrackButton';
import { formatPrice, formatNumber, formatDate } from '@/i18n/format';
import { Radar, Filter, ChevronRight, History } from 'lucide-react';
import {
  createManualScanRun,
  finishManualScanRun,
  insertManualScanResults,
  listManualScanRuns,
  fetchManualScanResults,
  fetchManualScanRun,
  saveLastScanLocal,
  loadLastScanLocal,
  type ManualScanRun,
  type ManualScanResultRow,
} from '@/services/manualScanService';

const UNIVERSE_OPTIONS = [10, 20, 50, 100];
const CONCURRENCY = 5;

type Sort = 'score' | 'newest' | 'rank';

interface Row {
  result: SignalResult;
  rank: number;
}

function rowFromDb(r: ManualScanResultRow, timeframeFallback: string): Row {
  if (r.payload) {
    return { result: r.payload, rank: r.market_rank ?? 0 };
  }
  const result: SignalResult = {
    symbol: r.symbol,
    timeframe: timeframeFallback,
    signalType: r.signal_type as SignalResult['signalType'],
    bias: (r.bias as SignalResult['bias']) ?? 'LONG',
    score: r.score,
    regime: (r.regime as SignalResult['regime']) ?? 'UNCLEAR',
    trend: (r.trend as SignalResult['trend']) ?? 'NEUTRAL',
    structure: (r.structure as SignalResult['structure']) ?? 'UNDEFINED',
    riskLevel: (r.risk_level as SignalResult['riskLevel']) ?? 'HIGH',
    priceAtSignal: Number(r.price),
    factors: [],
    reasons: [],
    risk:
      r.stop_loss != null
        ? {
            entryLow: Number(r.entry_low ?? r.price),
            entryHigh: Number(r.entry_high ?? r.price),
            invalidation: Number(r.stop_loss),
            stopLoss: Number(r.stop_loss),
            target1: Number(r.target1 ?? r.price),
            target2: Number(r.target2 ?? r.price),
            target3: Number(r.target3 ?? r.price),
            riskReward: Number(r.risk_reward ?? 0),
            riskLevel: (r.risk_level as SignalResult['riskLevel']) ?? 'HIGH',
            positionSize: 0,
            riskPct: 0,
            obstacle: null,
          }
        : null,
    explanationFa: '',
    explanationEn: '',
    generatedAt: Date.now(),
    candleCloseTime: r.candle_close_time ? new Date(r.candle_close_time).getTime() : null,
    dataQualityOk: true,
  };
  return { result, rank: r.market_rank ?? 0 };
}

export function ScannerPage() {
  const { t, lang, settings } = useSettings();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [universe, setUniverse] = useState<number>(() => {
    const n = Number(String(settings?.asset_universe ?? 'top20').replace('top', ''));
    return UNIVERSE_OPTIONS.includes(n) ? n : 20;
  });
  const [timeframe, setTimeframe] = useState<Timeframe>((settings?.default_timeframe as Timeframe) ?? '1d');
  const [minScore, setMinScore] = useState(0);
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [signalFilter, setSignalFilter] = useState('ALL');
  const [sort, setSort] = useState<Sort>('score');
  const [sharePublic, setSharePublic] = useState(false);

  const [results, setResults] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [history, setHistory] = useState<ManualScanRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const runId = useRef(0);

  const reloadHistory = useCallback(async () => {
    if (!user) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      setHistory(await listManualScanRuns(40));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  // بازیابی آخرین اسکن از localStorage + تاریخچه ابری
  useEffect(() => {
    const local = loadLastScanLocal();
    if (local?.results?.length) {
      setUniverse(local.universe);
      setTimeframe(local.timeframe as Timeframe);
      setResults(local.results);
      setSkipped(local.skipped ?? 0);
      setScanned(true);
    }
    void reloadHistory();
  }, [reloadHistory]);

  const openRun = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const [rows, run] = await Promise.all([fetchManualScanResults(id), fetchManualScanRun(id)]);
        const tf = (run?.timeframe as Timeframe) ?? timeframe;
        const mapped = rows.map((r) => rowFromDb(r, tf));
        setResults(mapped);
        setActiveRunId(id);
        setScanned(true);
        setSkipped(run?.failed ?? 0);
        if (run) {
          setUniverse(run.universe);
          setTimeframe(tf);
        }
        saveLastScanLocal({
          universe: run?.universe ?? universe,
          timeframe: tf,
          results: mapped,
          skipped: run?.failed ?? 0,
          at: Date.now(),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t('fetchError'));
      } finally {
        setLoading(false);
      }
    },
    [timeframe, universe, t],
  );

  const handleScan = useCallback(async () => {
    const myRun = ++runId.current;
    setLoading(true);
    setError(null);
    // نتایج قبلی را تا پایان اسکن جدید نگه می‌داریم (پاک نمی‌کنیم)
    setProgress(0);
    setSkipped(0);

    let dbRunId: string | null = null;

    try {
      const coins = await fetchScanUniverse(universe);
      if (coins.length === 0) {
        setError(t('fetchError'));
        return;
      }

      if (user) {
        try {
          dbRunId = await createManualScanRun({
            universe,
            timeframe,
            symbolsTotal: coins.length,
            isPublic: sharePublic,
            settingsSnapshot: {
              thresholds: {
                strong: settings?.signal_threshold_strong,
                buy: settings?.signal_threshold_buy,
                watch: settings?.signal_threshold_watch,
              },
              risk_percent: settings?.risk_percent,
              min_risk_reward: settings?.min_risk_reward,
            },
          });
          setActiveRunId(dbRunId);
        } catch {
          dbRunId = null;
        }
      }

      const options = optionsFromSettings(settings);
      const out: Row[] = [];
      let done = 0;
      let skip = 0;
      let next = 0;

      const worker = async () => {
        while (runId.current === myRun) {
          const i = next++;
          if (i >= coins.length) return;
          const coin = coins[i];
          try {
            const { candles, validation } = await fetchKlinesValidated(coin.symbol, timeframe, 300);
            if ((!validation.isValid && validation.issues.length > 3) || candles.length < 50) {
              skip++;
            } else {
              out.push({ result: analyze(coin.symbol, timeframe, candles, options), rank: coin.rank });
            }
          } catch {
            skip++;
          }
          done++;
          if (runId.current === myRun) setProgress(Math.round((done / coins.length) * 100));
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (runId.current !== myRun) return;

      setResults(out);
      setSkipped(skip);
      setScanned(true);

      saveLastScanLocal({ universe, timeframe, results: out, skipped: skip, at: Date.now() });

      if (dbRunId && user) {
        const buy = out.filter((x) => x.result.signalType === 'BUY').length;
        const sell = out.filter((x) => x.result.signalType === 'SELL').length;
        const wait = out.filter((x) => x.result.signalType === 'WAIT').length;
        const noTrade = out.filter((x) => x.result.signalType === 'NO_TRADE').length;
        try {
          await insertManualScanResults(dbRunId, out);
          await finishManualScanRun(dbRunId, {
            status: skip > 0 && out.length > 0 ? 'partial' : out.length ? 'ok' : 'failed',
            scanned: out.length,
            failed: skip,
            buy_count: buy,
            sell_count: sell,
            wait_count: wait,
            no_trade_count: noTrade,
          });
          await reloadHistory();
        } catch (e) {
          console.warn('save manual scan failed', e);
        }
      }
    } catch (e) {
      if (runId.current === myRun) setError(e instanceof Error ? e.message : t('fetchError'));
      if (dbRunId) {
        try {
          await finishManualScanRun(dbRunId, {
            status: 'failed',
            scanned: 0,
            failed: 0,
            buy_count: 0,
            sell_count: 0,
            wait_count: 0,
            no_trade_count: 0,
            error: e instanceof Error ? e.message : 'failed',
          });
        } catch {
          /* ignore */
        }
      }
    } finally {
      if (runId.current === myRun) setLoading(false);
    }
  }, [universe, timeframe, settings, t, user, sharePublic, reloadHistory]);

  const filtered = useMemo(() => {
    const list = results.filter(({ result: r }) => {
      if (minScore > 0 && r.score < minScore) return false;
      if (riskFilter !== 'ALL' && r.riskLevel !== riskFilter) return false;
      if (signalFilter !== 'ALL' && r.signalType !== signalFilter) return false;
      return true;
    });
    const weight = (r: SignalResult) =>
      r.signalType === 'BUY' || r.signalType === 'SELL' ? 2 : r.signalType === 'WAIT' ? 1 : 0;
    return list.sort((a, b) => {
      if (sort === 'rank') return a.rank - b.rank;
      if (sort === 'newest')
        return (b.result.candleCloseTime ?? 0) - (a.result.candleCloseTime ?? 0) || b.result.score - a.result.score;
      return weight(b.result) - weight(a.result) || b.result.score - a.result.score;
    });
  }, [results, minScore, riskFilter, signalFilter, sort]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <Radar className="w-6 h-6 text-primary-400 shrink-0" />
        <h1 className="text-xl sm:text-2xl font-bold text-slate-100">{t('scannerTitle')}</h1>
      </div>

      <Card className="!p-3 sm:!p-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">{t('assetUniverse')}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 sm:gap-3">
          <select value={universe} onChange={(e) => setUniverse(Number(e.target.value))} className="input-field text-sm">
            {UNIVERSE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {t(`top${n}`)}
              </option>
            ))}
          </select>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} className="input-field text-sm">
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf.toUpperCase()}
              </option>
            ))}
          </select>
          <select value={String(minScore)} onChange={(e) => setMinScore(Number(e.target.value))} className="input-field text-sm">
            <option value="0">
              {t('score')}: {t('all')}
            </option>
            <option value="60">{t('watch')} (60+)</option>
            <option value="70">{t('buy')} (70+)</option>
            <option value="80">{t('strong')} (80+)</option>
          </select>
          <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="input-field text-sm">
            <option value="ALL">
              {t('risk')}: {t('all')}
            </option>
            <option value="LOW">{t('low')}</option>
            <option value="MEDIUM">{t('medium')}</option>
            <option value="HIGH">{t('high')}</option>
          </select>
          <select value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)} className="input-field text-sm">
            <option value="ALL">
              {t('signal')}: {t('all')}
            </option>
            <option value="BUY">{t('buy')}</option>
            <option value="SELL">{t('asShort')}</option>
            <option value="WAIT">{t('wait')}</option>
            <option value="NO_TRADE">{t('noTrade')}</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input-field text-sm">
            <option value="score">
              {t('sortBy')}: {t('sortScore')}
            </option>
            <option value="newest">
              {t('sortBy')}: {t('sortNewest')}
            </option>
            <option value="rank">
              {t('sortBy')}: {t('sortRank')}
            </option>
          </select>
          <button onClick={() => void handleScan()} disabled={loading} className="btn-primary text-sm col-span-2 sm:col-span-1">
            {loading ? `${t('scanning')} ${progress}%` : t('scan')}
          </button>
        </div>

        {user ? (
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={sharePublic} onChange={(e) => setSharePublic(e.target.checked)} />
            {lang === 'fa' ? 'این اسکن را برای بقیه کاربران عمومی کن' : 'Share this scan publicly'}
          </label>
        ) : (
          <p className="text-[11px] text-slate-500 mt-3">
            {lang === 'fa'
              ? 'بدون ورود فقط روی همین مرورگر ذخیره می‌شود. برای تاریخچه ابری وارد شوید.'
              : 'Without login, results stay in this browser only. Sign in for cloud history.'}
          </p>
        )}
        <p className="text-[11px] text-slate-500 mt-2">{t('usingClosedCandles')}</p>
      </Card>

      {loading && (
        <div className="space-y-2">
          <div className="w-full h-1.5 bg-surface-200 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-slate-400 text-center">
            {t('scanning')} {progress}%
          </p>
        </div>
      )}

      {loading && progress >= 100 && <LoadingSpinner />}
      {error && <ErrorState message={error} onRetry={() => void handleScan()} />}

      {!loading && !error && skipped > 0 && (
        <p className="text-xs text-slate-500">
          {formatNumber(skipped, lang, 0)} {t('scanFailedCoins')}
        </p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          {/* موبایل — همان UI خودت */}
          <div className="md:hidden space-y-2.5">
            {filtered.map(({ result: r, rank }) => (
              <div
                key={r.symbol}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/asset/${r.symbol}?tf=${timeframe}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/asset/${r.symbol}?tf=${timeframe}`)}
                className="card w-full text-start p-3 space-y-3 active:bg-surface-100 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-100">{r.symbol.replace(/USDT$/i, '')}</span>
                      <Chip>{timeframe}</Chip>
                      <span className="text-xs text-slate-500">#{rank}</span>
                    </div>
                    <div className="mt-1.5">
                      <SignalBadge type={r.signalType} />
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <ScoreBar score={r.score} />
                    <p className="text-sm font-semibold text-slate-100 tabular-nums mt-1">{formatPrice(r.priceAtSignal, lang)}</p>
                  </div>
                </div>
                {r.risk && r.signalType !== 'NO_TRADE' && (
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2 rounded-lg bg-surface-100/60 p-2.5">
                    <Metric label={t('entry')} value={formatPrice(r.risk.entryLow, lang)} />
                    <Metric label={t('stopLoss')} value={formatPrice(r.risk.stopLoss, lang)} tone="text-error-400" />
                    <Metric label={t('asTarget')} value={formatPrice(r.risk.target1, lang)} tone="text-success-400" />
                    <Metric label="R/R" value={formatNumber(r.risk.riskReward, lang, 1)} />
                    <Metric label={t('trend')} value={<TrendBadge trend={r.trend} />} />
                    <Metric label={t('risk')} value={<RiskBadge level={r.riskLevel} />} />
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 border-t border-surface-200 pt-2">
                  <span className="text-xs text-slate-400">{r.structure}</span>
                  <TimeStamp value={r.candleCloseTime} label={t('candleClosed')} />
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <TrackButton symbol={r.symbol} timeframe={timeframe} signalType={r.signalType} />
                </div>
              </div>
            ))}
          </div>

          {/* دسکتاپ — همان UI خودت */}
          <div className="hidden md:block card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead className="bg-surface-100 text-slate-400">
                  <tr>
                    {[t('asset'), t('signal'), t('score'), t('trend'), t('structure'), t('risk'), t('price'), t('stopLoss'), t('asTarget'), t('candleClosed'), '', ''].map(
                      (h, i) => (
                        <th key={i} className="px-3 py-3 text-start font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-200">
                  {filtered.map(({ result: r }) => (
                    <tr
                      key={r.symbol}
                      onClick={() => navigate(`/asset/${r.symbol}?tf=${timeframe}`)}
                      className="hover:bg-surface-100 transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-3 font-semibold text-slate-100">{r.symbol.replace(/USDT$/i, '')}</td>
                      <td className="px-3 py-3">
                        <SignalBadge type={r.signalType} />
                      </td>
                      <td className="px-3 py-3">
                        <ScoreBar score={r.score} />
                      </td>
                      <td className="px-3 py-3">
                        <TrendBadge trend={r.trend} />
                      </td>
                      <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{r.structure}</td>
                      <td className="px-3 py-3">
                        <RiskBadge level={r.riskLevel} />
                      </td>
                      <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(r.priceAtSignal, lang)}</td>
                      <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">
                        {r.risk && r.signalType !== 'NO_TRADE' ? formatPrice(r.risk.stopLoss, lang) : '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">
                        {r.risk && r.signalType !== 'NO_TRADE' ? formatPrice(r.risk.target1, lang) : '—'}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {r.candleCloseTime ? formatDate(r.candleCloseTime, lang) : '—'}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <TrackButton symbol={r.symbol} timeframe={timeframe} signalType={r.signalType} compact />
                      </td>
                      <td className="px-3 py-3">
                        <ChevronRight className="w-4 h-4 text-slate-500 flip-x" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && !error && scanned && filtered.length === 0 && <EmptyState message={t('noResults')} />}

      {/* تاریخچه اسکن‌های دستی */}
      <Card className="!p-3 sm:!p-5">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">
            {lang === 'fa' ? 'تاریخچه اسکن‌های دستی' : 'Manual scan history'}
          </span>
        </div>
        {!user ? (
          <p className="text-sm text-slate-500">
            {lang === 'fa' ? 'برای دیدن تاریخچه ابری وارد شوید.' : 'Sign in to see cloud history.'}
          </p>
        ) : historyLoading ? (
          <LoadingSpinner />
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-500">
            {lang === 'fa' ? 'هنوز اسکن ذخیره‌شده‌ای نیست.' : 'No saved scans yet.'}
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => {
              const mine = h.user_id === user.id;
              const active = activeRunId === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => void openRun(h.id)}
                  className={`w-full text-start rounded-lg border px-3 py-2.5 transition-colors ${
                    active ? 'border-primary-500/50 bg-primary-600/10' : 'border-surface-200 hover:bg-surface-100'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-100">{formatDate(h.created_at, lang)}</span>
                    <Chip>{h.timeframe}</Chip>
                    <Chip>{`top${h.universe}`}</Chip>
                    {h.is_public && (
                      <Chip tone="bg-primary-500/20 text-primary-300">{lang === 'fa' ? 'عمومی' : 'Public'}</Chip>
                    )}
                    {mine && <Chip>{lang === 'fa' ? 'مال من' : 'Mine'}</Chip>}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    BUY {h.buy_count} · SELL {h.sell_count} · WAIT {h.wait_count} · {h.scanned}/{h.symbols_total}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Disclaimer />
    </div>
  );
}
