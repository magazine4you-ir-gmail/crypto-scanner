import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchKlinesValidated, fetchCoinGeckoMarkets } from '@/services/marketData';
import { analyze } from '@/engine/signalEngine';
import { saveSignal } from '@/services/signalService';
import type { SignalResult } from '@/types/signal';
import type { Timeframe } from '@/types/market';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { SignalBadge, TrendBadge, RiskBadge, ScoreBar } from '@/components/Badges';
import { formatPrice } from '@/i18n/format';
import { TIMEFRAMES } from '@/types/market';
import { Radar, Filter, ChevronRight } from 'lucide-react';

const UNIVERSE_OPTIONS = [
  { value: 'top10', count: 10 },
  { value: 'top20', count: 20 },
  { value: 'top50', count: 50 },
  { value: 'top100', count: 100 },
];

export function ScannerPage() {
  const { t, lang, settings } = useSettings();
  const navigate = useNavigate();
  const [universe, setUniverse] = useState(settings?.asset_universe ?? 'top20');
  const [timeframe, setTimeframe] = useState<Timeframe>((settings?.default_timeframe as Timeframe) ?? '1d');
  const [minScore, setMinScore] = useState(0);
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [signalFilter, setSignalFilter] = useState('ALL');
  const [results, setResults] = useState<SignalResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    setProgress(0);

    try {
      const universeOption = UNIVERSE_OPTIONS.find((u) => u.value === universe);
      const count = universeOption?.count ?? 20;
      const markets = await fetchCoinGeckoMarkets(count, 1).catch(() => []);
      if (markets.length === 0) {
        setError(t('fetchError'));
        return;
      }
      const symbols = markets.map((m) => `${m.symbol.toUpperCase()}USDT`);

      const allResults: SignalResult[] = [];
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        try {
          const { candles, validation } = await fetchKlinesValidated(symbol, timeframe, 300);
          if (!validation.isValid && validation.issues.length > 3) {
            continue;
          }
          if (candles.length < 50) continue;
          const result = analyze(symbol, timeframe, candles);
          allResults.push(result);
          saveSignal(result).catch(() => {});
        } catch {
          // Skip failed symbols
        }
        setProgress(Math.round(((i + 1) / symbols.length) * 100));
      }

      allResults.sort((a, b) => b.score - a.score);
      setResults(allResults);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      setLoading(false);
    }
  }, [universe, timeframe, t]);

  const filtered = results.filter((r) => {
    if (minScore > 0 && r.score < minScore) return false;
    if (riskFilter !== 'ALL' && r.riskLevel !== riskFilter) return false;
    if (signalFilter !== 'ALL' && r.signalType !== signalFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Radar className="w-6 h-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-slate-100">{t('scannerTitle')}</h1>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">{t('assetUniverse')}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <select value={universe} onChange={(e) => setUniverse(e.target.value)} className="input-field text-sm">
            <option value="top10">{t('top10')}</option>
            <option value="top20">{t('top20')}</option>
            <option value="top50">{t('top50')}</option>
            <option value="top100">{t('top100')}</option>
          </select>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} className="input-field text-sm">
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf.toUpperCase()}</option>
            ))}
          </select>
          <select value={String(minScore)} onChange={(e) => setMinScore(Number(e.target.value))} className="input-field text-sm">
            <option value="0">{t('all')}</option>
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
            <option value="WAIT">{t('wait')}</option>
            <option value="NO_TRADE">{t('noTrade')}</option>
          </select>
          <button onClick={handleScan} disabled={loading} className="btn-primary text-sm">
            {loading ? `${t('scanning')} ${progress}%` : t('scan')}
          </button>
        </div>
      </Card>

      {/* Results */}
      {loading && progress < 100 && (
        <div className="space-y-2">
          <div className="w-full h-1.5 bg-surface-200 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-slate-400 text-center">{t('scanning')} {progress}%</p>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={handleScan} />}

      {!loading && !error && results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-100 dark:bg-surface-100 text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t('asset')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('signal')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('score')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t('trend')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden md:table-cell">{t('structure')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden md:table-cell">{t('risk')}</th>
                  <th className="px-4 py-3 text-start font-medium hidden lg:table-cell">{t('price')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                {filtered.map((r) => (
                  <tr
                    key={r.symbol}
                    onClick={() => navigate(`/asset/${r.symbol}`)}
                    className="hover:bg-surface-100 dark:hover:bg-surface-100 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-semibold text-slate-100">{r.symbol.replace('USDT', '')}</td>
                    <td className="px-4 py-3"><SignalBadge type={r.signalType} /></td>
                    <td className="px-4 py-3"><ScoreBar score={r.score} /></td>
                    <td className="px-4 py-3 hidden sm:table-cell"><TrendBadge trend={r.trend} /></td>
                    <td className="px-4 py-3 text-slate-300 hidden md:table-cell">{r.structure}</td>
                    <td className="px-4 py-3 hidden md:table-cell"><RiskBadge level={r.riskLevel} /></td>
                    <td className="px-4 py-3 text-slate-300 hidden lg:table-cell tabular-nums">{formatPrice(r.priceAtSignal, lang)}</td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && results.length === 0 && (
        <EmptyState message={t('noResults')} />
      )}

      <Disclaimer />
    </div>
  );
}
