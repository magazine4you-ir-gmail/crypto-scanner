import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchKlinesValidated, fetchCoinGeckoMarkets, fetchTickers } from '@/services/marketData';
import { analyze } from '@/engine/signalEngine';
import { saveSignal, getSignalHistory } from '@/services/signalService';
import { findSwingPoints, findSupportResistance } from '@/engine/marketStructure';
import { findSupportResistance as findSR } from '@/engine/supportResistance';
import type { Candle, Timeframe, TickerStat } from '@/types/market';
import type { SignalResult } from '@/types/signal';
import type { SignalRecord } from '@/services/signalService';
import { PriceChart } from '@/components/PriceChart';
import { Card, SectionTitle, LoadingSpinner, ErrorState, Disclaimer } from '@/components/UI';
import { SignalBadge, TrendBadge, RiskBadge, RegimeBadge, StructureBadge, ScoreBar } from '@/components/Badges';
import { formatPrice, formatPercent, formatCompact, formatDate } from '@/i18n/format';
import { TIMEFRAMES } from '@/types/market';
import { ArrowLeft, Activity, BarChart3, Target, Shield, BookOpen } from 'lucide-react';

export function AssetDetailPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { t, lang, settings } = useSettings();
  const [timeframe, setTimeframe] = useState<Timeframe>((settings?.default_timeframe as Timeframe) ?? '1d');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signal, setSignal] = useState<SignalResult | null>(null);
  const [history, setHistory] = useState<SignalRecord[]>([]);
  const [ticker, setTicker] = useState<TickerStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const fullSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
      const [klineData, hist, tickers] = await Promise.all([
        fetchKlinesValidated(fullSymbol, timeframe, 400).catch(() => ({ candles: [] as Candle[], validation: { isValid: false, issues: [], staleCandles: 0, duplicateCount: 0, gapCount: 0 } })),
        getSignalHistory(fullSymbol, 10).catch(() => []),
        fetchTickers([fullSymbol]).catch(() => []),
      ]);
      setCandles(klineData.candles);
      setHistory(hist);
      setTicker(tickers[0] ?? null);
      if (klineData.candles.length >= 50) {
        const result = analyze(fullSymbol, timeframe, klineData.candles);
        setSignal(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [symbol, timeframe]);

  const handleAnalyze = async () => {
    if (!symbol || candles.length < 50) return;
    setAnalyzing(true);
    try {
      const fullSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
      const result = analyze(fullSymbol, timeframe, candles);
      setSignal(result);
      await saveSignal(result).catch(() => {});
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) return <LoadingSpinner size="lg" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const fullSymbol = symbol?.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const baseSymbol = symbol?.replace('USDT', '') ?? '';
  const swings = candles.length > 10 ? findSwingPoints(candles, 2) : [];
  const levels = candles.length > 10 ? findSR(candles, swings) : [];
  const supportPrices = levels.filter((l) => l.type === 'SUPPORT').slice(0, 3).map((l) => l.price);
  const resistancePrices = levels.filter((l) => l.type === 'RESISTANCE').slice(0, 3).map((l) => l.price);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/scanner" className="p-2 rounded-lg hover:bg-surface-100 text-slate-400">
          <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{baseSymbol}/USDT</h1>
          {ticker && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-lg font-semibold text-slate-200">{formatPrice(Number(ticker.lastPrice), lang)}</span>
              <span className={`text-sm font-medium ${Number(ticker.priceChangePercent) >= 0 ? 'text-success-400' : 'text-error-400'}`}>
                {formatPercent(Number(ticker.priceChangePercent), lang)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Timeframe selector */}
      <div className="flex gap-2 flex-wrap">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              timeframe === tf
                ? 'bg-primary-600 text-white'
                : 'bg-surface-100 dark:bg-surface-100 text-slate-400 hover:text-slate-200'
            }`}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Chart */}
      <Card>
        <SectionTitle>
          <span className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary-400" /> {t('chart')}</span>
        </SectionTitle>
        {candles.length > 0 ? (
          <PriceChart
            candles={candles}
            showVolume
            showEMA20
            showEMA50
            showEMA200
            entryLevel={signal?.risk?.entryHigh ?? null}
            stopLevel={signal?.risk?.stopLoss ?? null}
            targetLevels={signal?.risk ? [signal.risk.target1, signal.risk.target2, signal.risk.target3] : undefined}
            supportLevels={supportPrices}
            resistanceLevels={resistancePrices}
          />
        ) : (
          <p className="text-slate-400 text-center py-8">{t('noChartData')}</p>
        )}
      </Card>

      {/* Signal */}
      {signal && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle className="mb-0">
              <span className="flex items-center gap-2"><Activity className="w-5 h-5 text-primary-400" /> {t('signal')}</span>
            </SectionTitle>
            <button onClick={handleAnalyze} disabled={analyzing} className="btn-secondary text-sm">
              {analyzing ? t('analyzing') : t('generateSignal')}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            <InfoBox label={t('signal')}><SignalBadge type={signal.signalType} /></InfoBox>
            <InfoBox label={t('score')}><ScoreBar score={signal.score} /></InfoBox>
            <InfoBox label={t('trend')}><TrendBadge trend={signal.trend} /></InfoBox>
            <InfoBox label={t('structure')}><StructureBadge structure={signal.structure} /></InfoBox>
            <InfoBox label={t('marketRegime')}><RegimeBadge regime={signal.regime} /></InfoBox>
            <InfoBox label={t('risk')}><RiskBadge level={signal.riskLevel} /></InfoBox>
          </div>

          {/* Confluence Factors */}
          <div className="mb-4">
            <h3 className="text-sm font-medium text-slate-300 mb-2">{t('explanation')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {signal.factors.map((f) => (
                <div key={f.key} className="flex items-center justify-between p-2 rounded-lg bg-surface-100 dark:bg-surface-100">
                  <span className="text-sm text-slate-300">{lang === 'fa' ? f.label_fa : f.label_en}</span>
                  <span className={`text-xs font-medium ${f.positive ? 'text-success-400' : 'text-error-400'}`}>
                    {f.positive ? t('positive') : t('negative')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Plan */}
          {signal.risk && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <RiskBox label={t('entryZone')} value={`${formatPrice(signal.risk.entryLow, lang)} - ${formatPrice(signal.risk.entryHigh, lang)}`} icon={Target} color="text-primary-400" />
              <RiskBox label={t('invalidation')} value={formatPrice(signal.risk.invalidation, lang)} icon={Shield} color="text-error-400" />
              <RiskBox label={t('stopLoss')} value={formatPrice(signal.risk.stopLoss, lang)} icon={Shield} color="text-error-400" />
              <RiskBox label={t('target1')} value={formatPrice(signal.risk.target1, lang)} icon={Target} color="text-success-400" />
              <RiskBox label={t('target2')} value={formatPrice(signal.risk.target2, lang)} icon={Target} color="text-success-400" />
              <RiskBox label={t('target3')} value={formatPrice(signal.risk.target3, lang)} icon={Target} color="text-success-400" />
              <RiskBox label={t('riskReward')} value={`1:${signal.risk.riskReward.toFixed(1)}`} icon={Activity} color="text-primary-400" />
              {signal.risk.positionSize && (
                <RiskBox label={t('positionSize')} value={formatPrice(signal.risk.positionSize, lang)} icon={Activity} color="text-slate-300" />
              )}
            </div>
          )}

          {/* Explanation text */}
          <div className="mt-4 p-4 rounded-lg bg-surface-100 dark:bg-surface-100">
            <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
              {lang === 'fa' ? signal.explanationFa : signal.explanationEn}
            </pre>
          </div>
        </Card>
      )}

      {/* Signal History */}
      {history.length > 0 && (
        <Card>
          <SectionTitle>
            <span className="flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary-400" /> {t('signalHistory')}</span>
          </SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('signal')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('score')}</th>
                  <th className="px-3 py-2 text-start font-medium hidden sm:table-cell">{t('trend')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('date')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-3 py-2"><SignalBadge type={h.signal_type as any} /></td>
                    <td className="px-3 py-2 text-slate-300 tabular-nums">{h.score}</td>
                    <td className="px-3 py-2 text-slate-300 hidden sm:table-cell">{h.trend}</td>
                    <td className="px-3 py-2 text-slate-400">{formatDate(h.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Disclaimer />
    </div>
  );
}

function InfoBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-surface-100 dark:bg-surface-100">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      {children}
    </div>
  );
}

function RiskBox({ label, value, icon: Icon, color }: any) {
  return (
    <div className="p-3 rounded-lg bg-surface-100 dark:bg-surface-100">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}
