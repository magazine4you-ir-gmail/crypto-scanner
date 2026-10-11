import { useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchKlinesValidated, fetchScanUniverse } from '@/services/marketData';
import { analyze, optionsFromSettings } from '@/engine/signalEngine';
import type { SignalResult } from '@/types/signal';
import type { Timeframe } from '@/types/market';
import { TIMEFRAMES } from '@/types/market';
import { Card, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { SignalBadge, TrendBadge, RiskBadge, ScoreBar } from '@/components/Badges';
import { Metric, TimeStamp, Chip } from '@/components/Responsive';
import { formatPrice, formatNumber, formatDate } from '@/i18n/format';
import { Radar, Filter, ChevronRight } from 'lucide-react';

const UNIVERSE_OPTIONS = [10, 20, 50, 100];
const CONCURRENCY = 5;

type Sort = 'score' | 'newest' | 'rank';

interface Row {
  result: SignalResult;
  rank: number;
}

export function ScannerPage() {
  const { t, lang, settings } = useSettings();
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
  const [results, setResults] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const runId = useRef(0);

  const handleScan = useCallback(async () => {
    const myRun = ++runId.current;
    setLoading(true);
    setError(null);
    setResults([]);
    setProgress(0);
    setSkipped(0);
    try {
      const coins = await fetchScanUniverse(universe);
      if (coins.length === 0) {
        setError(t('fetchError'));
        return;
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
    } catch (e) {
      if (runId.current === myRun) setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      if (runId.current === myRun) setLoading(false);
    }
  }, [universe, timeframe, settings, t]);

  const filtered = useMemo(() => {
    const list = results.filter(({ result: r }) => {
      if (minScore > 0 && r.score < minScore) return false;
      if (riskFilter !== 'ALL' && r.riskLevel !== riskFilter) return false;
      if (signalFilter !== 'ALL' && r.signalType !== signalFilter) return false;
      return true;
    });
    const weight = (r: SignalResult) => (r.signalType === 'BUY' || r.signalType === 'SELL' ? 2 : r.signalType === 'WAIT' ? 1 : 0);
    return list.sort((a, b) => {
      if (sort === 'rank') return a.rank - b.rank;
      if (sort === 'newest') return (b.result.candleCloseTime ?? 0) - (a.result.candleCloseTime ?? 0) || b.result.score - a.result.score;
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
              <option key={n} value={n}>{t(`top${n}`)}</option>
            ))}
          </select>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} className="input-field text-sm">
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf.toUpperCase()}</option>
            ))}
          </select>
          <select value={String(minScore)} onChange={(e) => setMinScore(Number(e.target.value))} className="input-field text-sm">
            <option value="0">{t('score')}: {t('all')}</option>
            <option value="60">{t('watch')} (60+)</option>
            <option value="70">{t('buy')} (70+)</option>
            <option value="80">{t('strong')} (80+)</option>
          </select>
          <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="input-field text-sm">
            <option value="ALL">{t('risk')}: {t('all')}</option>
            <option value="LOW">{t('low')}</option>
            <option value="MEDIUM">{t('medium')}</option>
            <option value="HIGH">{t('high')}</option>
          </select>
          <select value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)} className="input-field text-sm">
            <option value="ALL">{t('signal')}: {t('all')}</option>
            <option value="BUY">{t('buy')}</option>
            <option value="SELL">{t('asShort')}</option>
            <option value="WAIT">{t('wait')}</option>
            <option value="NO_TRADE">{t('noTrade')}</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input-field text-sm">
            <option value="score">{t('sortBy')}: {t('sortScore')}</option>
            <option value="newest">{t('sortBy')}: {t('sortNewest')}</option>
            <option value="rank">{t('sortBy')}: {t('sortRank')}</option>
          </select>
          <button onClick={() => void handleScan()} disabled={loading} className="btn-primary text-sm col-span-2 sm:col-span-1">
            {loading ? `${t('scanning')} ${progress}%` : t('scan')}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">{t('usingClosedCandles')}</p>
      </Card>

      {loading && (
        <div className="space-y-2">
          <div className="w-full h-1.5 bg-surface-200 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-slate-400 text-center">{t('scanning')} {progress}%</p>
        </div>
      )}

      {loading && progress >= 100 && <LoadingSpinner />}
      {error && <ErrorState message={error} onRetry={() => void handleScan()} />}

      {!loading && !error && skipped > 0 && (
        <p className="text-xs text-slate-500">{formatNumber(skipped, lang, 0)} {t('scanFailedCoins')}</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="md:hidden space-y-2.5">
            {filtered.map(({ result: r, rank }) => (
              <button
                key={r.symbol}
                onClick={() => navigate(`/asset/${r.symbol}?tf=${timeframe}`)}
                className="card w-full text-start p-3 space-y-3 active:bg-surface-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-100">{r.symbol.replace(/USDT$/i, '')}</span>
                      <Chip>{timeframe}</Chip>
                      <span className="text-xs text-slate-500">#{rank}</span>
                    </div>
                    <div className="mt-1.5"><SignalBadge type={r.signalType} /></div>
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
              </button>
            ))}
          </div>

          <div className="hidden md:block card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-surface-100 text-slate-400">
                  <tr>
                    {[t('asset'), t('signal'), t('score'), t('trend'), t('structure'), t('risk'), t('price'), t('stopLoss'), t('asTarget'), t('candleClosed'), ''].map((h, i) => (
                      <th key={i} className="px-3 py-3 text-start font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-200">
                  {filtered.map(({ result: r }) => (
                    <tr key={r.symbol} onClick={() => navigate(`/asset/${r.symbol}?tf=${timeframe}`)} className="hover:bg-surface-100 transition-colors cursor-pointer">
                      <td className="px-3 py-3 font-semibold text-slate-100">{r.symbol.replace(/USDT$/i, '')}</td>
                      <td className="px-3 py-3"><SignalBadge type={r.signalType} /></td>
                      <td className="px-3 py-3"><ScoreBar score={r.score} /></td>
                      <td className="px-3 py-3"><TrendBadge trend={r.trend} /></td>
                      <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{r.structure}</td>
                      <td className="px-3 py-3"><RiskBadge level={r.riskLevel} /></td>
                      <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(r.priceAtSignal, lang)}</td>
                      <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{r.risk && r.signalType !== 'NO_TRADE' ? formatPrice(r.risk.stopLoss, lang) : '—'}</td>
                      <td className="px-3 py-3 text-slate-300 tabular-nums whitespace-nowrap">{r.risk && r.signalType !== 'NO_TRADE' ? formatPrice(r.risk.target1, lang) : '—'}</td>
                      <td className="px-3 py-3 text-xs text-slate-400 whitespace-nowrap">{r.candleCloseTime ? formatDate(r.candleCloseTime, lang) : '—'}</td>
                      <td className="px-3 py-3"><ChevronRight className="w-4 h-4 text-slate-500 flip-x" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && !error && scanned && filtered.length === 0 && <EmptyState message={t('noResults')} />}

      <Disclaimer />
    </div>
  );
}
