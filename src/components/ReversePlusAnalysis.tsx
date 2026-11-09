import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, SectionTitle, EmptyState } from '@/components/UI';
import { Metric, Chip, Pill, PillRow, TimeStamp } from '@/components/Responsive';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import { useSettings } from '@/contexts/SettingsContext';
import type { PlusBacktest, PlusEvaluation, PlusPublicConfig, PlusTrade } from '@/services/reversePlusService';
import { rowToResult } from '@/reversePlus/backtestRows';
import {
  D, DEFAULT_LEVERAGES, applyScenarioToBacktest, computeBacktestStats, computePlusStats, groupStats, isHistoricalSignal, toNumber,
  type BtStats, type SizingMode, type StatInput, type StatRow,
} from '../../supabase/functions/_shared/reversePlus/index';

const DAY = 86_400_000;
const OUTCOMES = ['ALL', 'WIN', 'LOSS', 'NO_ENTRY', 'AMBIGUOUS', 'EXPIRED', 'UNKNOWN'] as const;
const OUT_TONE: Record<string, string> = {
  WIN: 'bg-success-500/20 text-success-400', LOSS: 'bg-error-500/20 text-error-400', NO_ENTRY: 'bg-surface-200 text-slate-400',
  AMBIGUOUS: 'bg-warning-500/20 text-warning-400', EXPIRED: 'bg-surface-200 text-slate-500', UNKNOWN: 'bg-surface-200 text-slate-500', BREAKEVEN: 'bg-surface-200 text-slate-300',
};

interface Props { backtests: PlusBacktest[]; evals: PlusEvaluation[]; liveEvals: PlusEvaluation[]; trades: PlusTrade[]; cfg: PlusPublicConfig | null }

export function ReversePlusAnalysis({ backtests, evals, liveEvals, trades, cfg }: Props) {
  const { lang } = useSettings();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('ALL');
  const [period, setPeriod] = useState<'7' | '30' | '90' | 'ALL'>('ALL');
  const [tf, setTf] = useState('ALL');
  const [dir, setDir] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [lev, setLev] = useState(10);
  const [sizing, setSizing] = useState<SizingMode>('FIXED_RISK');
  const [minRr, setMinRr] = useState('');
  const [maxRr, setMaxRr] = useState('');
  const [includeInvalid, setIncludeInvalid] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 30;
  const fmt = (n: number) => n.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US');

  const evalById = useMemo(() => new Map(evals.map((e) => [e.reverse_outcome_id, e])), [evals]);
  const amount = useMemo(() => {
    if (!cfg) return D(10);
    return D(sizing === 'FIXED_RISK' ? Math.min((cfg.account_balance * cfg.risk_pct) / 100, cfg.max_risk_per_trade) : 1000);
  }, [cfg, sizing]);

  const timeframes = useMemo(() => Array.from(new Set(backtests.map((b) => b.timeframe))).sort(), [backtests]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const qq = q.trim().toUpperCase();
    const lo = minRr === '' ? null : Number(minRr);
    const hi = maxRr === '' ? null : Number(maxRr);
    return backtests.filter((b) => {
      if (qq && !b.symbol.toUpperCase().includes(qq)) return false;
      if (outcome !== 'ALL' && b.outcome !== outcome) return false;
      if (tf !== 'ALL' && b.timeframe !== tf) return false;
      if (dir !== 'ALL' && b.side !== dir) return false;
      if (period !== 'ALL' && (!b.signal_at || now - Date.parse(b.signal_at) > Number(period) * DAY)) return false;
      if (!includeInvalid && b.strategy_status === 'INVALID') return false;
      const rr = evalById.get(b.reverse_outcome_id)?.rr_net ?? null;
      if ((lo !== null && (rr === null || rr < lo)) || (hi !== null && (rr === null || rr > hi))) return false;
      return true;
    });
  }, [backtests, q, outcome, tf, dir, period, includeInvalid, minRr, maxRr, evalById]);

  const toStat = (b: PlusBacktest, leverage: number): StatInput => ({
    m: applyScenarioToBacktest(rowToResult(b), {
      side: b.side, entry: D(b.entry_level), stop: D(b.stop_loss), target: D(b.take_profit), leverage: D(leverage), mode: sizing, amount,
      cost: { feePct: D(cfg?.fee_pct ?? 0.05), slippagePct: D(cfg?.slippage_pct ?? 0.02) }, assumedMmrPct: D(cfg?.assumed_mmr_pct ?? 0.5),
      liqSafetyFactor: D(cfg?.liq_safety_factor ?? 0.8), accountBalance: cfg ? D(cfg.account_balance) : null,
    }),
    symbol: b.symbol, timeframe: b.timeframe, side: b.side, signalAt: b.signal_at, leverage,
  });
  const rows = useMemo(() => filtered.map((b) => ({ b, s: toStat(b, lev) })), [filtered, lev, sizing, amount, cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => computeBacktestStats(rows.map((r) => r.s)), [rows]);
  const byDir = useMemo(() => groupStats(rows.map((r) => r.s), (r) => (r.side === 'BUY' ? 'LONG' : 'SHORT')), [rows]);
  const bySymbol = useMemo(() => groupStats(rows.map((r) => r.s), (r) => r.symbol), [rows]);
  const byTf = useMemo(() => groupStats(rows.map((r) => r.s), (r) => r.timeframe), [rows]);
  const byLev = useMemo(() => {
    const out: Record<string, BtStats> = {};
    for (const l of DEFAULT_LEVERAGES) out[`${l}x`] = computeBacktestStats(filtered.map((b) => toStat(b, l)));
    return out;
  }, [filtered, sizing, amount, cfg]); // eslint-disable-line react-hooks/exhaustive-deps

  // counts (LIVE and historical are separate; the total is only a count)
  const historicalEvalCount = evals.filter((e) => isHistoricalSignal(e.signal_at, cfg?.public_since)).length;
  const paperRows = trades.filter((t) => t.mode === 'PAPER');
  const paper = useMemo(() => computePlusStats(paperRows.map<StatRow>((r) => ({
    outcome: r.outcome, netPnl: r.net_pnl === null ? null : D(r.net_pnl), finalR: r.final_r, timeframe: r.timeframe, qualityScore: r.quality_score, closedAt: r.exit_at,
  }))), [paperRows]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const n2 = (v: number | null, d = 2) => (v === null ? '—' : Number.isFinite(v) ? formatNumber(v, lang, d) : '∞');
  const dd = (v: bigint | null, d = 2) => (v === null ? '—' : formatNumber(toNumber(v), lang, d));

  const table = (title: string, data: Record<string, BtStats>, limit = 12) => (
    <Card className="!p-4">
      <SectionTitle>{title}</SectionTitle>
      {Object.keys(data).length === 0 ? <p className="text-xs text-slate-500">—</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead><tr className="text-slate-500"><th className="text-start py-1">گروه</th><th className="text-start">n</th><th className="text-start">Win%</th><th className="text-start">Net PnL</th><th className="text-start">PF</th><th className="text-start">avg R</th></tr></thead>
            <tbody>{Object.entries(data).sort((a, b) => b[1].total - a[1].total).slice(0, limit).map(([k, s]) => (
              <tr key={k} className="text-slate-200">
                <td className="py-1">{k}</td><td>{s.total}</td><td>{s.winRate === null ? '—' : `${n2(s.winRate, 1)}%`}{s.lowSample ? ' ⚠' : ''}</td>
                <td className={toNumber(s.netPnl) < 0 ? 'text-error-400' : ''}>{dd(s.netPnl)}</td><td>{n2(s.profitFactor)}</td><td>{n2(s.avgR)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card className="!p-4 space-y-3">
        <SectionTitle className="!mb-0">آمار کلی (تفکیک‌شده)</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="کل سیگنال‌ها" value={fmt(liveEvals.length + historicalEvalCount)} />
          <Metric label="LIVE" value={fmt(liveEvals.length)} tone="text-primary-300" />
          <Metric label="تاریخی" value={fmt(historicalEvalCount)} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-100 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-300">تاریخی — بک‌تست روی کندل واقعی ({fmt(backtests.length)} سیگنال بک‌تست‌شده، اهرم {lev}x، {sizing === 'FIXED_RISK' ? 'ریسک ثابت' : 'حجم ثابت'})</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric label="موفق" value={stats.wins} tone="text-success-400" />
              <Metric label="ناموفق" value={stats.losses} tone="text-error-400" />
              <Metric label="بدون ورود" value={stats.noEntry} />
              <Metric label="نامشخص / منقضی / ناکافی" value={`${stats.ambiguous} / ${stats.expired} / ${stats.unknown}`} />
              <Metric label="نرخ موفقیت" value={stats.winRate === null ? '—' : `${n2(stats.winRate, 1)}%`} />
              <Metric label="Profit Factor" value={n2(stats.profitFactor)} />
              <Metric label="سود خالص (USDT)" value={dd(stats.netPnl)} tone={toNumber(stats.netPnl) < 0 ? 'text-error-400' : 'text-success-400'} />
              <Metric label="میانگین بازدهی/معامله" value={dd(stats.avgPnl)} />
              <Metric label="میانگین ROI مارجین" value={stats.avgRoiPct === null ? '—' : formatPercent(toNumber(stats.avgRoiPct), lang)} />
              <Metric label="میانگین R/R" value={n2(stats.avgRr)} />
              <Metric label="میانگین R" value={n2(stats.avgR)} />
              <Metric label="بیشترین سود" value={dd(stats.best)} />
              <Metric label="بیشترین ضرر" value={dd(stats.worst)} />
              <Metric label="Max Drawdown" value={dd(stats.maxDrawdown)} />
              <Metric label="میانگین نگهداری" value={stats.avgHoldingMs === null ? '—' : `${n2(stats.avgHoldingMs / 3_600_000, 1)} h`} />
              <Metric label="لیکویید شده" value={stats.liquidations} />
            </div>
            {stats.lowSample && <p className="text-[11px] text-warning-400">نمونهٔ کم (کمتر از ۳۰ معامله بسته‌شده): نتیجه قابل اتکا نیست.</p>}
          </div>
          <div className="rounded-lg bg-surface-100 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-300">LIVE / PAPER — معاملات فرضی زنده (جدا از تاریخی؛ با تنظیمات مرجع عمومی)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric label="معاملات بسته" value={paper.n} />
              <Metric label="نرخ موفقیت" value={`${n2(paper.winRate, 1)}%`} />
              <Metric label="Profit Factor" value={n2(paper.profitFactor)} />
              <Metric label="سود خالص" value={dd(paper.netPnl as unknown as bigint, 4)} />
              <Metric label="Max DD" value={dd(paper.maxDrawdown as unknown as bigint, 4)} />
              <Metric label="بدون ورود" value={paper.noFill} />
            </div>
            {paper.lowSample && <p className="text-[11px] text-warning-400">نمونهٔ کم: هنوز داده زندهٔ کافی وجود ندارد.</p>}
          </div>
        </div>
      </Card>

      <Card className="!p-4 space-y-3">
        <SectionTitle className="!mb-0">فیلترها</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input className="input-field text-sm col-span-2 sm:col-span-1" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="جستجوی نماد" aria-label="symbol search" />
          <select className="input-field text-sm" value={outcome} onChange={(e) => { setOutcome(e.target.value as typeof outcome); setPage(0); }}>{OUTCOMES.map((o) => <option key={o} value={o}>{o === 'ALL' ? 'همه نتایج' : o}</option>)}</select>
          <select className="input-field text-sm" value={tf} onChange={(e) => { setTf(e.target.value); setPage(0); }}><option value="ALL">همه تایم‌فریم‌ها</option>{timeframes.map((x) => <option key={x}>{x}</option>)}</select>
          <select className="input-field text-sm" value={dir} onChange={(e) => { setDir(e.target.value as typeof dir); setPage(0); }}><option value="ALL">LONG + SHORT</option><option value="BUY">LONG</option><option value="SELL">SHORT</option></select>
          <select className="input-field text-sm" value={period} onChange={(e) => { setPeriod(e.target.value as typeof period); setPage(0); }}><option value="ALL">همه زمان‌ها</option><option value="7">۷ روز</option><option value="30">۳۰ روز</option><option value="90">۹۰ روز</option></select>
          <select className="input-field text-sm" value={lev} onChange={(e) => setLev(Number(e.target.value))}>{DEFAULT_LEVERAGES.map((l) => <option key={l} value={l}>اهرم {l}x</option>)}</select>
          <input className="input-field text-sm" inputMode="decimal" value={minRr} onChange={(e) => { setMinRr(e.target.value); setPage(0); }} placeholder="حداقل R/R" />
          <input className="input-field text-sm" inputMode="decimal" value={maxRr} onChange={(e) => { setMaxRr(e.target.value); setPage(0); }} placeholder="حداکثر R/R" />
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-300">
          <PillRow><Pill active={sizing === 'FIXED_RISK'} onClick={() => setSizing('FIXED_RISK')}>ریسک ثابت</Pill><Pill active={sizing === 'FIXED_NOTIONAL'} onClick={() => setSizing('FIXED_NOTIONAL')}>حجم ثابت</Pill></PillRow>
          <label className="flex items-center gap-1"><input type="checkbox" checked={includeInvalid} onChange={(e) => { setIncludeInvalid(e.target.checked); setPage(0); }} />شامل سیگنال‌هایی که استراتژی هنگام صدور «نامعتبر» بود</label>
        </div>
        <p className="text-[11px] text-slate-500">اهرم و حالت اندازه‌گیری فقط سناریوی محلی شماست؛ Entry/TP/SL و نتیجهٔ بک‌تست تغییر نمی‌کند. {fmt(rows.length)} نتیجه از {fmt(backtests.length)}.</p>
      </Card>

      {table('عملکرد LONG در برابر SHORT', byDir)}
      {table('عملکرد بر اساس نماد', bySymbol)}
      {table('عملکرد بر اساس تایم‌فریم', byTf)}
      {table('عملکرد بر اساس اهرم (روی همان فیلتر)', byLev, 10)}

      {visible.length === 0 ? <EmptyState message={backtests.length === 0 ? 'هنوز بک‌تست تاریخی محاسبه نشده است؛ پس از Deploy و اجرای تابع reverse-plus-eval ظاهر می‌شود.' : 'با فیلترهای انتخاب‌شده نتیجه‌ای نیست.'} /> : (
        <div className="space-y-3">
          {visible.map(({ b, s }) => {
            const ev = evalById.get(b.reverse_outcome_id);
            const pnlPct = s.m.netPnl !== null && s.m.notional > 0n ? (toNumber(s.m.netPnl) / toNumber(s.m.notional)) * 100 : null;
            return (
              <button key={b.id} onClick={() => navigate(`/reverse-plus/signal/${b.reverse_outcome_id}`)} className="block w-full text-start">
                <Card className="!p-4 hover:border-primary-500/40 transition-colors">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2"><span className="font-semibold text-slate-100">{b.symbol}</span>
                      <Chip tone={b.side === 'BUY' ? 'bg-success-500/20 text-success-400' : 'bg-error-500/20 text-error-400'}>{b.side === 'BUY' ? 'LONG' : 'SHORT'}</Chip><Chip>{b.timeframe}</Chip></div>
                    <div className="flex items-center gap-2"><Chip tone={OUT_TONE[b.outcome]}>{b.outcome}</Chip>{b.strategy_status === 'INVALID' && <Chip tone="bg-error-500/20 text-error-400">INVALID</Chip>}</div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <TimeStamp value={b.signal_at} label="زمان صدور" compact />
                    <Metric label="قیمت صدور (Entry)" value={formatPrice(b.entry_level, lang)} />
                    <Metric label="TP" value={formatPrice(b.take_profit, lang)} tone="text-success-400" />
                    <Metric label="SL" value={formatPrice(b.stop_loss, lang)} tone="text-error-400" />
                    <Metric label="R/R" value={ev?.rr_net == null ? '—' : formatNumber(ev.rr_net, lang, 2)} />
                    <Metric label="اهرم انتخابی" value={`${lev}x`} />
                    <Metric label="وضعیت ورود" value={b.entry_time ? 'وارد شد' : b.outcome === 'NO_ENTRY' ? 'بدون ورود' : '—'} />
                    <Metric label="نتیجه" value={b.reason} />
                    <Metric label="سود/زیان %" value={pnlPct === null ? '—' : formatPercent(pnlPct, lang)} tone={pnlPct !== null && pnlPct < 0 ? 'text-error-400' : 'text-success-400'} />
                    <Metric label="سود/زیان USDT" value={s.m.netPnl === null ? '—' : formatNumber(toNumber(s.m.netPnl), lang, 2)} tone={s.m.netPnl !== null && s.m.netPnl < 0n ? 'text-error-400' : 'text-success-400'} />
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      )}
      {rows.length > pageSize && (
        <div className="flex items-center justify-between gap-3">
          <button className="btn-secondary text-xs" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>صفحه قبل</button>
          <span className="text-xs text-slate-400 tabular-nums">صفحه {safePage + 1} از {pageCount}</span>
          <button className="btn-secondary text-xs" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>صفحه بعد</button>
        </div>
      )}
    </div>
  );
}
