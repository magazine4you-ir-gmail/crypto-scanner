import { useState } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchKlinesValidated, fetchCoinGeckoMarkets } from '@/services/marketData';
import { analyze } from '@/engine/signalEngine';
import type { SignalResult } from '@/types/signal';
import type { Timeframe } from '@/types/market';
import { Card, SectionTitle, LoadingSpinner, Disclaimer } from '@/components/UI';
import { SignalBadge, ScoreBar } from '@/components/Badges';
import { formatPrice, formatPercent } from '@/i18n/format';
import { TIMEFRAMES } from '@/types/market';
import { FlaskConical, Play } from 'lucide-react';

interface BacktestTrade {
  entryIndex: number;
  entryPrice: number;
  signal: SignalResult;
  exitIndex: number | null;
  exitPrice: number | null;
  pnlPct: number | null;
  result: 'WIN' | 'LOSS' | 'OPEN';
}

export function BacktestPage() {
  const { t, lang } = useSettings();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [windowSize, setWindowSize] = useState(50);
  const [running, setRunning] = useState(false);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [stats, setStats] = useState<{ total: number; wins: number; losses: number; winRate: number; avgPnl: number; totalPnl: number } | null>(null);

  const runBacktest = async () => {
    setRunning(true);
    setTrades([]);
    setStats(null);
    try {
      const { candles } = await fetchKlinesValidated(symbol, timeframe, 500);
      if (candles.length < 100) {
        setRunning(false);
        return;
      }

      const allTrades: BacktestTrade[] = [];
      for (let i = windowSize; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const result = analyze(symbol, timeframe, slice);
        if (result.signalType === 'BUY' && result.risk) {
          const entryPrice = candles[i].close;
          const stop = result.risk.stopLoss;
          const target = result.risk.target1;
          let exitIndex: number | null = null;
          let exitPrice: number | null = null;
          for (let j = i + 1; j < candles.length; j++) {
            if (candles[j].low <= stop) {
              exitIndex = j;
              exitPrice = stop;
              break;
            }
            if (candles[j].high >= target) {
              exitIndex = j;
              exitPrice = target;
              break;
            }
          }
          const pnlPct = exitPrice !== null ? ((exitPrice - entryPrice) / entryPrice) * 100 : null;
          allTrades.push({
            entryIndex: i,
            entryPrice,
            signal: result,
            exitIndex,
            exitPrice,
            pnlPct,
            result: exitPrice === null ? 'OPEN' : exitPrice >= target ? 'WIN' : 'LOSS',
          });
          if (exitIndex !== null) {
            i = exitIndex;
          }
        }
      }

      setTrades(allTrades);
      const closed = allTrades.filter((tr) => tr.pnlPct !== null);
      const wins = closed.filter((tr) => tr.pnlPct! > 0).length;
      const losses = closed.filter((tr) => tr.pnlPct! <= 0).length;
      const totalPnl = closed.reduce((sum, tr) => sum + tr.pnlPct!, 0);
      setStats({
        total: closed.length,
        wins,
        losses,
        winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
        avgPnl: closed.length > 0 ? totalPnl / closed.length : 0,
        totalPnl,
      });
    } catch {
      // ignore
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="w-6 h-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-slate-100">{t('backtest')}</h1>
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('asset')}</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="input-field text-sm" placeholder="BTCUSDT" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('timeframe')}</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} className="input-field text-sm">
              {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('windowSize') || 'Window'}</label>
            <input type="number" value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))} className="input-field text-sm" min={20} max={200} />
          </div>
          <button onClick={runBacktest} disabled={running} className="btn-primary text-sm">
            <Play className="w-4 h-4 inline me-1" /> {running ? t('loading') : t('scan')}
          </button>
        </div>
      </Card>

      {running && <LoadingSpinner size="lg" />}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label={t('totalSignals')} value={String(stats.total)} />
          <StatCard label={t('winRate')} value={formatPercent(stats.winRate, lang)} color={stats.winRate >= 50 ? 'text-success-400' : 'text-error-400'} />
          <StatCard label={t('win') ?? 'Wins'} value={String(stats.wins)} color="text-success-400" />
          <StatCard label={t('loss') ?? 'Losses'} value={String(stats.losses)} color="text-error-400" />
          <StatCard label={t('avgRR') || 'Avg PnL'} value={formatPercent(stats.avgPnl, lang)} color={stats.avgPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
          <StatCard label={t('totalPnl') || 'Total PnL'} value={formatPercent(stats.totalPnl, lang)} color={stats.totalPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
        </div>
      )}

      {trades.length > 0 && (
        <Card>
          <SectionTitle>{t('backtest') + ' — ' + t('signal')}</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">#</th>
                  <th className="px-3 py-2 text-start font-medium">{t('signal')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('score')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('entry')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('exit')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                {trades.map((tr, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2"><SignalBadge type={tr.signal.signalType} /></td>
                    <td className="px-3 py-2"><ScoreBar score={tr.signal.score} /></td>
                    <td className="px-3 py-2 text-slate-300 tabular-nums">{formatPrice(tr.entryPrice, lang)}</td>
                    <td className="px-3 py-2 text-slate-300 tabular-nums">{tr.exitPrice !== null ? formatPrice(tr.exitPrice, lang) : '—'}</td>
                    <td className="px-3 py-2">
                      {tr.pnlPct !== null ? (
                        <span className={`tabular-nums font-medium ${tr.pnlPct > 0 ? 'text-success-400' : 'text-error-400'}`}>
                          {formatPercent(tr.pnlPct, lang)}
                        </span>
                      ) : (
                        <span className="text-warning-400">{t('open')}</span>
                      )}
                    </td>
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

function StatCard({ label, value, color = 'text-slate-100' }: { label: string; value: string; color?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </Card>
  );
}
