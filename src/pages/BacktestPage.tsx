import { useState } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { fetchKlinesValidated } from '@/services/marketData';
import { optionsFromSettings } from '@/engine/signalEngine';
import { analyzeCore, closedCandles, resolveTrade, EXPIRY_BARS, TRADE_COST_PCT, type SignalType } from '@engine';
import type { Timeframe } from '@/types/market';
import { Card, SectionTitle, LoadingSpinner, Disclaimer } from '@/components/UI';
import { SignalBadge, ScoreBar } from '@/components/Badges';
import { formatPrice, formatPercent, formatNumber, formatDate } from '@/i18n/format';
import { TIMEFRAMES } from '@/types/market';
import { FlaskConical, Play } from 'lucide-react';

const WARMUP = 200; // EMA200 needs 200 candles; earlier bars can never produce a signal

interface BacktestTrade {
  signalType: SignalType;
  score: number;
  entryTime: number;
  entryPrice: number;
  exitPrice: number | null;
  pnlPct: number | null;
  rMultiple: number | null;
  status: 'WIN' | 'LOSS' | 'EXPIRED' | 'OPEN';
  bars: number | null;
}

interface Stats {
  total: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  expectancyR: number;
  maxDrawdownR: number;
}

export function BacktestPage() {
  const { t, lang, settings } = useSettings();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [barsUsed, setBarsUsed] = useState(0);

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    setTrades([]);
    setStats(null);
    try {
      const sym = symbol.trim().toUpperCase();
      const { candles: raw } = await fetchKlinesValidated(sym, timeframe, 1000);
      const candles = closedCandles(raw);
      setBarsUsed(candles.length);
      if (candles.length < WARMUP + 50) {
        setError(lang === 'fa' ? 'داده کافی برای بک‌تست نیست (حداقل ۲۵۰ کندل).' : 'Not enough data for a backtest (at least 250 candles).');
        return;
      }

      const options = { ...optionsFromSettings(settings), timeframe };
      const maxBars = EXPIRY_BARS[timeframe] ?? 40;
      const out: BacktestTrade[] = [];

      for (let i = WARMUP; i < candles.length - 1; i++) {
        const a = analyzeCore(candles.slice(0, i + 1), options);
        if (!a || (a.signalType !== 'BUY' && a.signalType !== 'SELL') || !a.risk) continue;

        const direction = a.signalType === 'BUY' ? 'LONG' : 'SHORT';
        const entry = candles[i].close;
        const res = resolveTrade(
          { direction, entry, stop: a.risk.stopLoss, target: a.risk.target1, maxBars },
          candles.slice(i + 1),
        );
        out.push({
          signalType: a.signalType,
          score: a.score,
          entryTime: candles[i].closeTime,
          entryPrice: entry,
          exitPrice: res?.exitPrice ?? null,
          pnlPct: res?.pnlPct ?? null,
          rMultiple: res?.rMultiple ?? null,
          status: res?.status ?? 'OPEN',
          bars: res?.barsHeld ?? null,
        });
        // one trade at a time: continue after this trade is over
        if (res) i += res.barsHeld;
        else break;
      }

      setTrades(out);
      const closed = out.filter((x) => x.status !== 'OPEN');
      const wins = closed.filter((x) => x.status === 'WIN').length;
      const losses = closed.filter((x) => x.status === 'LOSS').length;
      const expired = closed.filter((x) => x.status === 'EXPIRED').length;
      const totalPnl = closed.reduce((s, x) => s + (x.pnlPct ?? 0), 0);
      let eq = 0;
      let peak = 0;
      let dd = 0;
      for (const x of closed) {
        eq += x.rMultiple ?? 0;
        peak = Math.max(peak, eq);
        dd = Math.max(dd, peak - eq);
      }
      setStats({
        total: closed.length,
        wins,
        losses,
        expired,
        winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
        avgPnl: closed.length ? totalPnl / closed.length : 0,
        totalPnl,
        expectancyR: closed.length ? closed.reduce((s, x) => s + (x.rMultiple ?? 0), 0) / closed.length : 0,
        maxDrawdownR: dd,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('fetchError'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="w-6 h-6 text-primary-400 shrink-0" />
        <h1 className="text-xl sm:text-2xl font-bold text-slate-100">{t('backtest')}</h1>
      </div>

      <Card className="!p-3 sm:!p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs text-slate-400 mb-1">{t('asset')}</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="input-field text-sm" placeholder="BTCUSDT" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('timeframe')}</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} className="input-field text-sm">
              {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf.toUpperCase()}</option>)}
            </select>
          </div>
          <button onClick={() => void runBacktest()} disabled={running} className="btn-primary text-sm col-span-2 sm:col-span-2">
            <Play className="w-4 h-4 inline me-1" /> {running ? t('loading') : t('scan')}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-3 leading-5">
          {lang === 'fa'
            ? `بک‌تست با همان موتور اسکن خودکار روی حداکثر ۱۰۰۰ کندل بسته‌شده اجرا می‌شود (۲۰۰ کندل اول فقط برای گرم‌شدن اندیکاتورهاست). هر معامله ${TRADE_COST_PCT}٪ کارمزد و اسلیپیج دارد و همزمان فقط یک معامله باز است. نتیجه بک‌تست تضمینی برای آینده نیست.`
            : `Runs the same engine as the auto scan on up to 1000 closed candles (the first 200 only warm up the indicators). Every trade pays ${TRADE_COST_PCT}% fees+slippage and only one trade is open at a time. A backtest does not guarantee future results.`}
        </p>
      </Card>

      {running && <LoadingSpinner size="lg" />}
      {error && <p className="text-sm text-error-400">{error}</p>}

      {stats && (
        <>
          <p className="text-xs text-slate-500">{formatNumber(barsUsed, lang, 0)} {lang === 'fa' ? 'کندل بسته‌شده' : 'closed candles'}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-3">
            <StatCard label={t('totalSignals')} value={formatNumber(stats.total, lang, 0)} />
            <StatCard label={t('winRate')} value={formatPercent(stats.winRate, lang)} color={stats.winRate >= 34 ? 'text-success-400' : 'text-error-400'} />
            <StatCard label={`${t('win')} / ${t('loss')} / ${t('slExpired')}`} value={`${stats.wins} / ${stats.losses} / ${stats.expired}`} />
            <StatCard label={t('expectancyR')} value={`${stats.expectancyR >= 0 ? '+' : ''}${formatNumber(stats.expectancyR, lang, 2)}R`} color={stats.expectancyR >= 0 ? 'text-success-400' : 'text-error-400'} />
            <StatCard label={t('avgPnl')} value={formatPercent(stats.avgPnl, lang)} color={stats.avgPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
            <StatCard label={t('totalPnl')} value={formatPercent(stats.totalPnl, lang)} color={stats.totalPnl >= 0 ? 'text-success-400' : 'text-error-400'} />
            <StatCard label="Max DD (R)" value={`-${formatNumber(stats.maxDrawdownR, lang, 2)}R`} color="text-warning-400" />
          </div>
        </>
      )}

      {stats && trades.length === 0 && (
        <p className="text-sm text-slate-400">{lang === 'fa' ? 'در این بازه هیچ سیگنال BUY/SELL تولید نشد.' : 'No BUY/SELL signal was produced in this range.'}</p>
      )}

      {trades.length > 0 && (
        <Card className="!p-3 sm:!p-5">
          <SectionTitle>{t('backtest') + ' — ' + t('signal')}</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-slate-400">
                <tr>
                  {['#', t('signal'), t('score'), t('signalTime'), t('entry'), t('exit'), 'R', t('result')].map((h) => (
                    <th key={h} className="px-3 py-2 text-start font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-200">
                {[...trades].reverse().map((tr, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-slate-400">{trades.length - i}</td>
                    <td className="px-3 py-2"><SignalBadge type={tr.signalType} /></td>
                    <td className="px-3 py-2"><ScoreBar score={tr.score} /></td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{formatDate(tr.entryTime, lang)}</td>
                    <td className="px-3 py-2 text-slate-300 tabular-nums whitespace-nowrap">{formatPrice(tr.entryPrice, lang)}</td>
                    <td className="px-3 py-2 text-slate-300 tabular-nums whitespace-nowrap">{tr.exitPrice !== null ? formatPrice(tr.exitPrice, lang) : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-300">{tr.rMultiple !== null ? `${tr.rMultiple >= 0 ? '+' : ''}${formatNumber(tr.rMultiple, lang, 2)}` : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {tr.pnlPct !== null ? (
                        <span className={`tabular-nums font-medium ${tr.pnlPct > 0 ? 'text-success-400' : 'text-error-400'}`}>
                          {formatPercent(tr.pnlPct, lang)} · {tr.status === 'WIN' ? t('win') : tr.status === 'LOSS' ? t('loss') : t('slExpired')}
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
    <Card className="!p-3 sm:!p-4">
      <p className="text-xs text-slate-400 mb-1 truncate">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </Card>
  );
}
