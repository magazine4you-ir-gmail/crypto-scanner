import { useEffect, useState, useCallback } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { getSignals } from '@/services/signalService';
import { getJournalEntries } from '@/services/journalService';
import type { SignalRecord } from '@/services/signalService';
import type { JournalEntry } from '@/services/journalService';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState, Disclaimer } from '@/components/UI';
import { formatPercent, formatDate } from '@/i18n/format';
import { TrendingUp, Target, Activity, Award } from 'lucide-react';

export function PerformancePage() {
  const { t, lang } = useSettings();
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sig, jrn] = await Promise.all([
        getSignals(200).catch(() => []),
        getJournalEntries().catch(() => []),
      ]);
      setSignals(sig);
      setEntries(jrn);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingSpinner size="lg" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const totalSignals = signals.length;
  const buySignals = signals.filter((s) => s.signal_type === 'BUY').length;
  const noTradeSignals = signals.filter((s) => s.signal_type === 'NO_TRADE').length;
  const noTradeRate = totalSignals > 0 ? (noTradeSignals / totalSignals) * 100 : 0;

  const closedEntries = entries.filter((e) => e.result === 'WIN' || e.result === 'LOSS');
  const wins = closedEntries.filter((e) => e.result === 'WIN').length;
  const losses = closedEntries.filter((e) => e.result === 'LOSS').length;
  const winRate = closedEntries.length > 0 ? (wins / closedEntries.length) * 100 : 0;

  const profitableTrades = closedEntries.filter((e) => {
    if (e.exit_price === null) return false;
    const pnl = e.side === 'BUY'
      ? (e.exit_price - e.entry_price) / e.entry_price
      : (e.entry_price - e.exit_price) / e.entry_price;
    return pnl > 0;
  });
  const losingTrades = closedEntries.filter((e) => {
    if (e.exit_price === null) return false;
    const pnl = e.side === 'BUY'
      ? (e.exit_price - e.entry_price) / e.entry_price
      : (e.entry_price - e.exit_price) / e.entry_price;
    return pnl <= 0;
  });

  const grossProfit = profitableTrades.reduce((sum, e) => {
    if (e.exit_price === null) return sum;
    const pnl = e.side === 'BUY'
      ? (e.exit_price - e.entry_price) * e.size
      : (e.entry_price - e.exit_price) * e.size;
    return sum + pnl;
  }, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, e) => {
    if (e.exit_price === null) return sum;
    const pnl = e.side === 'BUY'
      ? (e.exit_price - e.entry_price) * e.size
      : (e.entry_price - e.exit_price) * e.size;
    return sum + pnl;
  }, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const avgWin = profitableTrades.length > 0 ? grossProfit / profitableTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
  const expectancy = closedEntries.length > 0
    ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-slate-100">{t('performance')}</h1>
      </div>

      {/* Signal Stats */}
      <div>
        <SectionTitle>{t('signalAccuracy')}</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Activity} label={t('totalSignals')} value={String(totalSignals)} />
          <StatCard icon={Target} label={t('validSignals')} value={String(buySignals)} color="text-success-400" />
          <StatCard icon={Activity} label={t('noTradeRate')} value={formatPercent(noTradeRate, lang)} color="text-warning-400" />
          <StatCard icon={Award} label={t('winRate')} value={formatPercent(winRate, lang)} color={winRate >= 50 ? 'text-success-400' : 'text-error-400'} />
        </div>
      </div>

      {/* Trading Stats */}
      <div>
        <SectionTitle>{t('paperTradingPerformance')}</SectionTitle>
        {closedEntries.length === 0 ? (
          <EmptyState message={t('noEntries')} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatCard icon={Award} label={t('winRate')} value={formatPercent(winRate, lang)} color={winRate >= 50 ? 'text-success-400' : 'text-error-400'} />
            <StatCard icon={Target} label={t('profitFactor')} value={profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} color={profitFactor >= 1.5 ? 'text-success-400' : 'text-error-400'} />
            <StatCard icon={Activity} label={t('expectancy')} value={expectancy.toFixed(2)} color={expectancy >= 0 ? 'text-success-400' : 'text-error-400'} />
            <StatCard icon={TrendingUp} label={t('win') + ' / ' + t('loss')} value={`${wins} / ${losses}`} />
          </div>
        )}
      </div>

      {/* Recent Journal */}
      {entries.length > 0 && (
        <Card>
          <SectionTitle>{t('journalTitle')}</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('asset')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('result')}</th>
                  <th className="px-3 py-2 text-start font-medium hidden sm:table-cell">{t('date')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                {entries.slice(0, 10).map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 font-medium text-slate-200 uppercase">{e.asset}</td>
                    <td className={`px-3 py-2 font-medium ${e.result === 'WIN' ? 'text-success-400' : e.result === 'LOSS' ? 'text-error-400' : 'text-slate-400'}`}>
                      {e.result === 'WIN' ? t('win') : e.result === 'LOSS' ? t('loss') : e.result === 'BREAKEVEN' ? t('breakeven') : t('open')}
                    </td>
                    <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">{formatDate(e.trade_date, lang)}</td>
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

function StatCard({ icon: Icon, label, value, color = 'text-slate-100' }: any) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}
