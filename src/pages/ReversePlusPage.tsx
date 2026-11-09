import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, RefreshCw, Trash2 } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, SectionTitle, LoadingSpinner, ErrorState, EmptyState } from '@/components/UI';
import { ScoreBar } from '@/components/Badges';
import { Metric, Chip, Pill, PillRow, TimeStamp } from '@/components/Responsive';
import { formatPrice, formatNumber, formatPercent } from '@/i18n/format';
import { fetchReverseOutcomes, type ReverseOutcome } from '@/services/reverseOutcomeService';
import {
  DEFAULT_PLUS_SETTINGS, deleteActualTrade, fetchEvaluations, fetchBacktests, fetchPlusSettings, fetchPlusTrades, fetchPublicConfig, savePlusSettings, saveActualTrade,
  type PlusBacktest, type PlusEvaluation, type PlusPersonalSettings, type PlusPublicConfig, type PlusSettingsRow, type PlusTrade,
} from '@/services/reversePlusService';
import {
  D, visibleTrades, compareModes, computeActual, computePlusStats, div, isHistoricalSignal, jsonSafe, mul, sum, toNumber, toString,
  type ModePair, type StatRow,
} from '../../supabase/functions/_shared/reversePlus/index';
import { isReversePlusEnabled } from '@/reversePlus/featureFlag';
import { ReversePlusAnalysis } from '@/components/ReversePlusAnalysis';

type Tab = 'analysis' | 'signals' | 'history' | 'trades' | 'performance' | 'settings';
const STATUS_TONE: Record<string, string> = {
  READY: 'bg-success-500/20 text-success-400',
  APPROACHING: 'bg-warning-500/20 text-warning-400',
  WAITING: 'bg-surface-200 text-slate-300',
  INVALID: 'bg-error-500/20 text-error-400',
  EXPIRED: 'bg-surface-200 text-slate-500',
};

export function ReversePlusPage() {
  const { t } = useSettings();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const openEvaluation = useCallback((e: PlusEvaluation) => {
    navigate(`/reverse-plus/signal/${encodeURIComponent(e.reverse_outcome_id)}`);
  }, [navigate]);
  const [tab, setTab] = useState<Tab>('analysis');
  const [settings, setSettings] = useState<PlusSettingsRow | null>(null);
  const [backtests, setBacktests] = useState<PlusBacktest[]>([]);
  const [config, setConfig] = useState<PlusPublicConfig | null>(null);
  const [evals, setEvals] = useState<PlusEvaluation[]>([]);
  const [historyEvals, setHistoryEvals] = useState<PlusEvaluation[]>([]);
  const [trades, setTrades] = useState<PlusTrade[]>([]);
  const [reverse, setReverse] = useState<ReverseOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, cfg, e, h, tr, rv, bts] = await Promise.all([
        fetchPlusSettings(),
        fetchPublicConfig(),
        fetchEvaluations('LIVE', 150),
        fetchEvaluations('SIGNAL_TIME', 3000),
        fetchPlusTrades(),
        fetchReverseOutcomes(400).catch(() => []),
        fetchBacktests(3000),
      ]);
      setBacktests(bts);
      setSettings(s);
      setConfig(cfg);
      setEvals(e);
      setHistoryEvals(h);
      setTrades(visibleTrades(tr, user?.id ?? null));
      setReverse(rv);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    void load();
  }, [authLoading, user, load]);

  if (!isReversePlusEnabled()) return <Card><p className="text-slate-300 text-sm">{t('rpDisabledPage')}</p></Card>;

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-primary-400" />{t('reversePlus')}</h1>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('rpSubtitle')}</p>
      </div>
      <button className="btn-secondary text-sm shrink-0" onClick={() => void load()} aria-label="refresh"><RefreshCw className="w-4 h-4" /></button>
    </div>
  );

  if (!authLoading && !user) {
    return <div className="space-y-6">{header}<Card><button className="btn-primary text-sm" onClick={() => navigate('/login')}>{t('signIn')}</button></Card></div>;
  }

  // Public model: everybody sees the same central rows. Signals issued before the central pipeline started
  // (config.public_since) are historical: SIGNAL_TIME snapshot only, no PAPER / LIVE trade.
  const historicalEvals = historyEvals.filter((e) => isHistoricalSignal(e.signal_at, config?.public_since));

  const tabs: { key: Tab; label: string }[] = [
    { key: 'analysis', label: 'مرکز تحلیل' },
    { key: 'signals', label: t('rpSignals') },
    { key: 'history', label: `بک‌تست تاریخی (${historicalEvals.length})` },
    { key: 'trades', label: t('rpTrades') },
    { key: 'performance', label: t('rpPerformance') },
    { key: 'settings', label: t('rpSettings') },
  ];

  return (
    <div className="space-y-5">
      {header}
      <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20"><p className="text-xs text-warning-400 leading-relaxed">{t('rpStructuralNote')}</p></div>
      <PillRow>{tabs.map((x) => <Pill key={x.key} active={tab === x.key} onClick={() => setTab(x.key)}>{x.label}</Pill>)}</PillRow>
      {loading ? <LoadingSpinner /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : (
        <>
          {tab === 'analysis' && <ReversePlusAnalysis backtests={backtests} evals={historyEvals} liveEvals={evals} trades={trades} cfg={config} />}
          {tab === 'signals' && <SignalsTab evals={evals} onOpen={openEvaluation} />}
          {tab === 'history' && <HistoryTab evals={historicalEvals} publicSince={config?.public_since ?? null} onOpen={openEvaluation} />}
          {tab === 'trades' && <TradesTab trades={trades} evals={evals} settings={settings} userId={user!.id} onChanged={load} />}
          {tab === 'performance' && <PerformanceTab trades={trades} reverse={reverse} />}
          {tab === 'settings' && <SettingsTab settings={settings} userId={user!.id} onSaved={setSettings} />}
        </>
      )}
      <p className="text-[11px] text-slate-500 leading-relaxed">{t('disclaimer')}</p>
    </div>
  );
}


// ------------------------------------------------------------------------------------------------
// Historical backtest: read-only SIGNAL_TIME evaluations created before Reverse Plus activation.
// These rows are deliberately kept separate from LIVE signals and actual-trade entry selection.
function HistoryTab({ evals, publicSince, onOpen }: { evals: PlusEvaluation[]; publicSince: string | null; onOpen: (e: PlusEvaluation) => void }) {
  const { lang } = useSettings();
  const [query, setQuery] = useState('');
  const [timeframe, setTimeframe] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(0);
  const pageSize = 30;

  const timeframes = useMemo(
    () => Array.from(new Set(evals.map((e) => e.timeframe).filter(Boolean))).sort(),
    [evals]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return evals.filter((e) => {
      const matchesQuery = !q || e.symbol.toUpperCase().includes(q);
      const matchesTimeframe = timeframe === 'ALL' || e.timeframe === timeframe;
      const matchesStatus = status === 'ALL' || e.entry_status === status;
      return matchesQuery && matchesTimeframe && matchesStatus;
    });
  }, [evals, query, timeframe, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const statusCounts = useMemo(() => ({
    READY: evals.filter((e) => e.entry_status === 'READY').length,
    APPROACHING: evals.filter((e) => e.entry_status === 'APPROACHING').length,
    WAITING: evals.filter((e) => e.entry_status === 'WAITING').length,
    INVALID: evals.filter((e) => e.entry_status === 'INVALID').length,
    EXPIRED: evals.filter((e) => e.entry_status === 'EXPIRED').length,
  }), [evals]);

  const resetPage = () => setPage(0);

  return (
    <div className="space-y-4">
      <Card className="!p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-slate-100">بک‌تست تاریخی سیگنال‌های معکوس</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              این سوابق فقط برای ارزیابی گذشته هستند؛ معامله PAPER یا LIVE از آن‌ها ساخته نمی‌شود.
            </p>
          </div>
          <Chip>{evals.length.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US')} رکورد تاریخی</Chip>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="rounded-lg bg-surface-100 p-2"><p className="text-[10px] text-slate-500">مجموع</p><p className="text-sm font-semibold text-slate-100">{evals.length}</p></div>
          <div className="rounded-lg bg-surface-100 p-2"><p className="text-[10px] text-slate-500">آماده</p><p className="text-sm font-semibold text-success-400">{statusCounts.READY}</p></div>
          <div className="rounded-lg bg-surface-100 p-2"><p className="text-[10px] text-slate-500">نزدیک ورود</p><p className="text-sm font-semibold text-warning-400">{statusCounts.APPROACHING}</p></div>
          <div className="rounded-lg bg-surface-100 p-2"><p className="text-[10px] text-slate-500">نامعتبر</p><p className="text-sm font-semibold text-error-400">{statusCounts.INVALID}</p></div>
          <div className="rounded-lg bg-surface-100 p-2"><p className="text-[10px] text-slate-500">منقضی / منتظر</p><p className="text-sm font-semibold text-slate-300">{statusCounts.EXPIRED + statusCounts.WAITING}</p></div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            className="input-field w-full text-sm"
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetPage(); }}
            placeholder="جست‌وجوی نماد، مثل BTCUSDT"
            aria-label="جست‌وجوی نماد در بک‌تست تاریخی"
          />
          <select
            className="input-field w-full text-sm"
            value={timeframe}
            onChange={(e) => { setTimeframe(e.target.value); resetPage(); }}
            aria-label="فیلتر تایم‌فریم"
          >
            <option value="ALL">همه تایم‌فریم‌ها</option>
            {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
          <select
            className="input-field w-full text-sm"
            value={status}
            onChange={(e) => { setStatus(e.target.value); resetPage(); }}
            aria-label="فیلتر وضعیت"
          >
            <option value="ALL">همه وضعیت‌ها</option>
            <option value="READY">آماده ورود</option>
            <option value="APPROACHING">نزدیک ورود</option>
            <option value="WAITING">در انتظار</option>
            <option value="INVALID">نامعتبر</option>
            <option value="EXPIRED">منقضی</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>{filtered.length.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US')} نتیجه از {evals.length.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US')}</span>
          <button
            className="text-primary-400 disabled:text-slate-600"
            onClick={() => { setQuery(''); setTimeframe('ALL'); setStatus('ALL'); setPage(0); }}
            disabled={!query && timeframe === 'ALL' && status === 'ALL'}
          >
            پاک‌کردن فیلترها
          </button>
        </div>
        {publicSince && (
          <p className="text-[10px] text-slate-500">
            مرز تفکیک سوابق تاریخی: پیش از شروع پردازش مرکزی Reverse Plus (برای همه کاربران یکسان است)
          </p>
        )}
      </Card>

      {visible.length === 0 ? (
        <EmptyState message="با فیلترهای انتخاب‌شده رکوردی پیدا نشد." />
      ) : (
        <div className="space-y-3">
          {visible.map((e) => (
            <div key={e.id} className="space-y-1">
              <EvalCard e={e} onOpen={onOpen} />
              <div className="px-1 flex justify-between gap-2 text-[10px] text-slate-500">
                <span>زمان سیگنال: <TimeStamp value={e.signal_at} compact /></span>
                <span>تاریخی · فقط جهت بک‌تست</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length > pageSize && (
        <div className="flex items-center justify-between gap-3">
          <button className="btn-secondary text-xs" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>صفحه قبل</button>
          <span className="text-xs text-slate-400 tabular-nums">صفحه {safePage + 1} از {pageCount}</span>
          <button className="btn-secondary text-xs" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>صفحه بعد</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
function SignalsTab({ evals, onOpen }: { evals: PlusEvaluation[]; onOpen: (e: PlusEvaluation) => void }) {
  const { t } = useSettings();
  if (evals.length === 0) return <EmptyState message={t('rpNoData')} />;
  return <div className="space-y-3">{evals.map((e) => <EvalCard key={e.id} e={e} onOpen={onOpen} />)}</div>;
}

function EvalCard({ e, onOpen }: { e: PlusEvaluation; onOpen: (e: PlusEvaluation) => void }) {
  const { t, lang } = useSettings();
  const [open, setOpen] = useState(false);
  const p = (v: number | null) => (v === null ? '—' : formatPrice(v, lang));
  const steps = e.plan?.steps ?? [];
  return (
    <Card className="!p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-slate-100">{e.symbol}</span>
          <Chip tone={e.side === 'BUY' ? 'bg-success-500/20 text-success-400' : 'bg-error-500/20 text-error-400'}>{e.side === 'BUY' ? t('buy') : t('asShort')}</Chip>
          <Chip>{e.timeframe}</Chip>
        </div>
        <Chip tone={STATUS_TONE[e.entry_status]}>{t(`rp${e.entry_status}`)}</Chip>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Metric label={t('rpCurrentPrice')} value={p(e.current_price)} />
        <Metric label={t('rpEntryZone')} value={`${p(e.zone_low)} – ${p(e.zone_high)}`} />
        <Metric label={t('rpRecommended')} value={p(e.recommended_entry)} tone="text-primary-300" />
        <Metric label={t('rpEntryRange')} value={e.entry_range_low === null ? '—' : `${p(e.entry_range_low)} – ${p(e.entry_range_high)}`} />
        <Metric label={t('rpStopReverse')} value={p(e.stop_loss)} />
        <Metric label={t('rpTargetReverse')} value={p(e.take_profit)} />
        <Metric label={t('rpRrNet')} value={e.rr_net === null ? '—' : formatNumber(e.rr_net, lang, 2)} />
        <Metric label={t('rpRrGross')} value={e.rr_gross === null ? '—' : formatNumber(e.rr_gross, lang, 2)} />
        <Metric label={t('rpDistance')} value={e.distance_to_entry_pct === null ? '—' : formatPercent(e.distance_to_entry_pct, lang)} />
        <Metric label={t('rpRiskUsd')} value={e.risk_amount === null ? '—' : formatNumber(e.risk_amount, lang, 4)} />
        <Metric label={t('rpNotional')} value={e.total_notional === null ? '—' : formatNumber(e.total_notional, lang, 2)} />
        <Metric label={t('rpMargin')} value={e.total_margin === null ? '—' : formatNumber(e.total_margin, lang, 4)} />
        <Metric label={t('rpLeverage')} value={e.leverage === null ? '—' : `${formatNumber(e.leverage, lang, 0)}x`} />
        <Metric label={t('rpEntries')} value={e.entries_count ?? '—'} />
        <Metric label={t('rpAvgEntry')} value={p(e.avg_entry)} />
        <Metric label={t('rpLiq')} value={e.liq_estimate === null ? '—' : `≈ ${p(e.liq_estimate)}`} />
      </div>
      <div className="mt-3">
        <p className="text-[11px] text-slate-500 mb-1">{t('rpQuality')}</p>
        {e.quality_score === null ? <span className="text-slate-500 text-sm">—</span> : <ScoreBar score={e.quality_score} />}
      </div>
      {e.status_reasons.length > 0 && (
        <ul className="mt-2 text-xs text-slate-400 list-disc ps-5">{e.status_reasons.map((r) => <li key={r}>{t(`rpReason${r}`) === `rpReason${r}` ? r : t(`rpReason${r}`)}</li>)}</ul>
      )}
      <button className="btn-secondary text-xs mt-2" onClick={() => onOpen(e)}>نمودار و تحلیل کامل ←</button>
      <p className="text-[11px] text-slate-500 mt-2">{t('rpRrBasis')}</p>
      <button className="text-xs text-primary-400 mt-2" onClick={() => setOpen(!open)}>{open ? '▲' : '▼'} {t('rpWhy')} / {t('rpSteps')}</button>
      {open && (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs text-slate-400 mb-2">{t('rpQualityHint')}</p>
            <div className="space-y-1">
              {(e.quality_factors ?? []).map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-300 truncate">{f.reason[lang]}</span>
                  <span className={`tabular-nums shrink-0 ${f.available ? 'text-slate-200' : 'text-slate-600'}`}>{f.available ? `${f.earned}/${f.max}` : `–/${f.max}`}</span>
                </div>
              ))}
            </div>
          </div>
          {steps.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 text-start"><th className="text-start py-1">{t('rpStep')}</th><th className="text-start">{t('rpRecommended')}</th><th className="text-start">{t('rpQty')}</th><th className="text-start">{t('rpMargin')}</th><th className="text-start">{t('rpNetRisk')}</th></tr></thead>
                <tbody>{steps.map((s) => (
                  <tr key={s.order} className="text-slate-200 tabular-nums"><td className="py-1">{s.order}</td><td>{formatPrice(Number(s.entry), lang)}</td><td>{Number(s.qty)}</td><td>{formatNumber(Number(s.margin), lang, 4)}</td><td>{formatNumber(Number(s.netRisk), lang, 4)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {e.max_safe_leverage !== null && <p className="text-xs text-slate-400">{t('rpMaxSafeLev')}: <b className="text-slate-200">{formatNumber(e.max_safe_leverage, lang, 0)}x</b></p>}
          {e.liq_estimate !== null && <p className="text-[11px] text-slate-500">{t('rpLiqNote')}</p>}
          {(e.contract_known === false || e.plan?.estimated) && <p className="text-[11px] text-warning-400">{t('rpEstimate')}</p>}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------
function TradesTab({ trades, evals, settings, userId, onChanged }: {
  trades: PlusTrade[]; evals: PlusEvaluation[]; settings: PlusSettingsRow | null; userId: string; onChanged: () => Promise<void>;
}) {
  const { t, lang } = useSettings();
  const [mode, setMode] = useState<'PAPER' | 'ACTUAL'>('PAPER');
  const rows = trades.filter((x) => x.mode === mode);
  return (
    <div className="space-y-4">
      <PillRow>
        <Pill active={mode === 'PAPER'} onClick={() => setMode('PAPER')}>{t('rpPaper')}</Pill>
        <Pill active={mode === 'ACTUAL'} onClick={() => setMode('ACTUAL')}>{t('rpActual')}</Pill>
      </PillRow>
      <p className="text-[11px] text-slate-500">{t('rpModeNote')}</p>
      {mode === 'ACTUAL' && <ActualForm evals={evals} settings={settings} userId={userId} onSaved={onChanged} />}
      {rows.length === 0 ? <EmptyState message={t('rpNoData')} /> : rows.map((r) => (
        <Card key={r.id} className="!p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2"><span className="font-semibold text-slate-100">{r.symbol}</span><Chip>{r.timeframe}</Chip><Chip tone={r.side === 'BUY' ? 'bg-success-500/20 text-success-400' : 'bg-error-500/20 text-error-400'}>{r.side}</Chip></div>
            <div className="flex items-center gap-2"><Chip>{r.outcome}</Chip>{mode === 'ACTUAL' && <button aria-label="delete" onClick={() => void deleteActualTrade(r.id).then(onChanged)}><Trash2 className="w-4 h-4 text-slate-500" /></button>}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Metric label={t('rpEntries')} value={`${r.entries_filled ?? 0}/${r.entries_planned ?? r.entries_filled ?? 0}`} />
            <Metric label={t('rpAvgEntry')} value={r.avg_entry === null ? '—' : formatPrice(r.avg_entry, lang)} />
            <Metric label={t('rpActualExit')} value={r.exit_price === null ? '—' : formatPrice(r.exit_price, lang)} />
            <Metric label="R" value={r.final_r === null ? '—' : formatNumber(r.final_r, lang, 2)} tone={(r.final_r ?? 0) >= 0 ? 'text-success-400' : 'text-error-400'} />
            <Metric label={t('rpNetPnl')} value={r.net_pnl === null ? '—' : formatNumber(r.net_pnl, lang, 4)} />
            <Metric label={t('rpQuality')} value={r.quality_score ?? '—'} />
            <Metric label={t('rpMargin')} value={r.margin_used === null ? '—' : formatNumber(r.margin_used, lang, 4)} />
            <TimeStamp value={r.signal_at} compact />
          </div>
        </Card>
      ))}
    </div>
  );
}

function ActualForm({ evals, settings, userId, onSaved }: { evals: PlusEvaluation[]; settings: PlusSettingsRow | null; userId: string; onSaved: () => Promise<void> }) {
  const { t } = useSettings();
  const [sel, setSel] = useState('');
  const [fills, setFills] = useState<{ price: string; qty: string }[]>([{ price: '', qty: '' }]);
  const [exit, setExit] = useState('');
  const [fees, setFees] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const ev = evals.find((x) => x.reverse_outcome_id === sel);

  const submit = async () => {
    setMsg(null);
    try {
      if (!ev) throw new Error('select a signal');
      const parsed = fills.filter((f) => f.price && f.qty).map((f) => ({ price: D(f.price), qty: D(f.qty) }));
      const res = computeActual({
        side: ev.side, fills: parsed, exitPrice: D(exit), stop: D(ev.stop_loss), feesTotal: fees ? D(fees) : null,
        feePct: D(settings?.fee_pct ?? DEFAULT_PLUS_SETTINGS.fee_pct),
      });
      if (!res) throw new Error('invalid fills / exit');
      const lev = D(settings?.leverage ?? DEFAULT_PLUS_SETTINGS.leverage);
      const notional = sum(parsed.map((f) => mul(f.qty, f.price)));
      await saveActualTrade({
        user_id: userId, reverse_outcome_id: ev.reverse_outcome_id, origin_outcome_id: ev.origin_outcome_id, symbol: ev.symbol, timeframe: ev.timeframe,
        side: ev.side, quality_score: ev.quality_score, recommended_entry: ev.recommended_entry, stop_loss: String(ev.stop_loss), take_profit: String(ev.take_profit),
        leverage: toString(lev), margin_used: toString(div(notional, lev, 'ceil')), entries_filled: parsed.length, qty_total: toString(res.qty),
        avg_entry: toString(res.avgEntry), fills: jsonSafe(parsed.map((f) => ({ price: f.price, qty: f.qty }))) as { price: string; qty: string }[],
        exit_price: exit, exit_at: new Date().toISOString(), gross_pnl: toString(res.grossPnl), fees: toString(res.fees), net_pnl: toString(res.netPnl),
        risk_at_stop: res.riskAtStop === null ? null : toString(res.riskAtStop), final_r: res.finalR === null ? null : toString(res.finalR),
        outcome: res.outcome, signal_at: ev.signal_at,
      });
      setMsg(t('rpSaved'));
      await onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="!p-4 space-y-3">
      <SectionTitle className="!mb-0">{t('rpAddActual')}</SectionTitle>
      <select className="input-field w-full text-sm" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">{t('rpSignalPick')}…</option>
        {evals.map((e) => <option key={e.id} value={e.reverse_outcome_id}>{e.symbol} · {e.timeframe} · {e.side}</option>)}
      </select>
      {fills.map((f, i) => (
        <div key={i} className="grid grid-cols-2 gap-2">
          <input className="input-field text-sm" inputMode="decimal" placeholder={t('rpActualEntryPrice')} value={f.price} onChange={(e) => setFills(fills.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
          <input className="input-field text-sm" inputMode="decimal" placeholder={t('rpActualQty')} value={f.qty} onChange={(e) => setFills(fills.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
        </div>
      ))}
      <button className="text-xs text-primary-400" onClick={() => setFills([...fills, { price: '', qty: '' }])}>+ {t('rpAddFill')}</button>
      <div className="grid grid-cols-2 gap-2">
        <input className="input-field text-sm" inputMode="decimal" placeholder={t('rpActualExit')} value={exit} onChange={(e) => setExit(e.target.value)} />
        <input className="input-field text-sm" inputMode="decimal" placeholder={t('rpActualFees')} value={fees} onChange={(e) => setFees(e.target.value)} />
      </div>
      <button className="btn-primary text-sm" onClick={() => void submit()}>{t('rpSave')}</button>
      {msg && <p className="text-xs text-slate-400">{msg}</p>}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------
function PerformanceTab({ trades, reverse }: { trades: PlusTrade[]; reverse: ReverseOutcome[] }) {
  const { t, lang } = useSettings();
  const [mode, setMode] = useState<'PAPER' | 'ACTUAL'>('PAPER');
  const rows = useMemo(() => trades.filter((x) => x.mode === mode), [trades, mode]);
  const stats = useMemo(() => computePlusStats(rows.map<StatRow>((r) => ({
    outcome: r.outcome, netPnl: r.net_pnl === null ? null : D(r.net_pnl), finalR: r.final_r, timeframe: r.timeframe,
    qualityScore: r.quality_score, closedAt: r.exit_at,
  }))), [rows]);
  const cmp = useMemo(() => {
    const byRev = new Map(rows.map((r) => [r.reverse_outcome_id, r]));
    const pairs: ModePair[] = reverse.map((r) => {
      const pl = byRev.get(r.id);
      return {
        originId: r.origin_outcome_id, originalStatus: r.origin?.status ?? 'OPEN', originalR: r.origin?.r_multiple ?? null,
        reverseStatus: r.status, reverseR: r.r_multiple, plusOutcome: pl ? pl.outcome : null, plusR: pl?.final_r ?? null,
      };
    });
    return compareModes(pairs);
  }, [rows, reverse]);
  const n = (v: number) => (Number.isFinite(v) ? formatNumber(v, lang, 2) : '∞');
  const bucketTable = (title: string, data: Record<string, { n: number; winRate: number; expectancyR: number; lowSample: boolean }>) => (
    <Card className="!p-4">
      <SectionTitle>{title}</SectionTitle>
      {Object.keys(data).length === 0 ? <p className="text-xs text-slate-500">—</p> : (
        <div className="space-y-1">{Object.entries(data).sort().map(([k, b]) => (
          <div key={k} className="flex items-center justify-between text-xs gap-2">
            <span className="text-slate-300 w-16">{k}</span>
            <span className="text-slate-400 tabular-nums">n={b.n}</span>
            <span className="tabular-nums text-slate-200">{formatNumber(b.winRate, lang, 1)}%</span>
            <span className="tabular-nums text-slate-200">{n(b.expectancyR)}R</span>
            {b.lowSample && <span className="text-warning-400">⚠</span>}
          </div>
        ))}</div>
      )}
    </Card>
  );
  const row = (label: string, s: { n: number; winRate: number; expectancyR: number; totalR: number }) => (
    <div className="flex items-center justify-between text-xs gap-2"><span className="text-slate-300 flex-1">{label}</span><span className="tabular-nums">{formatNumber(s.winRate, lang, 1)}%</span><span className="tabular-nums w-16 text-end">{n(s.expectancyR)}R</span><span className="tabular-nums w-16 text-end">{n(s.totalR)}R</span></div>
  );
  return (
    <div className="space-y-4">
      <PillRow><Pill active={mode === 'PAPER'} onClick={() => setMode('PAPER')}>{t('rpPaper')}</Pill><Pill active={mode === 'ACTUAL'} onClick={() => setMode('ACTUAL')}>{t('rpActual')}</Pill></PillRow>
      <p className="text-[11px] text-slate-500">{t('rpModeNote')}</p>
      <Card className="!p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label={t('rpWinRate')} value={`${formatNumber(stats.winRate, lang, 1)}%`} />
          <Metric label={t('rpExpectancy')} value={n(stats.expectancyR)} />
          <Metric label={t('rpProfitFactor')} value={n(stats.profitFactor)} />
          <Metric label={t('rpNetPnl')} value={formatNumber(toNumber(stats.netPnl), lang, 4)} />
          <Metric label={t('rpAvgWin')} value={formatNumber(toNumber(stats.avgWin), lang, 4)} />
          <Metric label={t('rpAvgLoss')} value={formatNumber(toNumber(stats.avgLoss), lang, 4)} />
          <Metric label={t('rpMaxDd')} value={formatNumber(toNumber(stats.maxDrawdown), lang, 4)} />
          <Metric label={`${t('rpTrades')} / ${t('rpNoFill')}`} value={`${stats.n} / ${stats.noFill}`} />
        </div>
        {stats.lowSample && <p className="text-xs text-warning-400 mt-3">{t('rpLowSample')}</p>}
      </Card>
      {bucketTable(t('rpByTf'), stats.byTimeframe)}
      {bucketTable(t('rpByScore'), stats.byScoreBucket)}
      <Card className="!p-4">
        <SectionTitle>{t('rpCompare')}</SectionTitle>
        <p className="text-[11px] text-slate-500 mb-2">{t('rpCommon')}: {cmp.common} · {t('rpWinRate')} · {t('rpExpectancy')} · ΣR</p>
        <div className="space-y-2">{row(t('rpOriginal'), cmp.original)}{row(t('rpExistingReverse'), cmp.reverse)}{row(t('rpPlusExec'), cmp.plus)}</div>
        {cmp.common < 30 && <p className="text-xs text-warning-400 mt-3">{t('rpLowSample')}</p>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
function SettingsTab({ settings, userId, onSaved }: { settings: PlusSettingsRow | null; userId: string; onSaved: (s: PlusSettingsRow) => void }) {
  const { t } = useSettings();
  const [form, setForm] = useState<PlusPersonalSettings>(settings ?? DEFAULT_PLUS_SETTINGS);
  const [msg, setMsg] = useState<string | null>(null);
  const num = (k: keyof typeof form, label: string, step = 'any') => (
    <label className="block text-xs text-slate-400">{label}
      <input className="input-field w-full text-sm mt-1" type="number" step={step} value={form[k] as number}
        onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
    </label>
  );
  const save = async () => {
    try { onSaved(await savePlusSettings(userId, form)); setMsg(t('rpSaved')); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Card className="!p-4 space-y-4">
      <p className="text-[11px] text-slate-500 leading-relaxed">{t('rpPersonalNote')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {num('account_balance', t('rpBalance'))}{num('risk_pct', t('rpRiskPct'))}{num('max_risk_per_trade', t('rpMaxRisk'))}
        {num('leverage', t('rpLeverage'), '1')}
        <label className="block text-xs text-slate-400">{t('rpMarginMode')}
          <select className="input-field w-full text-sm mt-1" value={form.margin_mode} onChange={(e) => setForm({ ...form, margin_mode: e.target.value as 'ISOLATED' | 'CROSS' })}>
            <option value="ISOLATED">{t('rpIsolated')}</option><option value="CROSS">{t('rpCross')}</option>
          </select>
        </label>
        {num('fee_pct', t('rpFee'))}{num('slippage_pct', t('rpSlippage'))}{num('max_entries', t('rpMaxEntries'), '1')}
        {num('max_margin_pct', t('rpMaxMargin'))}{num('min_rr', t('rpMinRr'))}{num('assumed_mmr_pct', t('rpMmr'))}{num('liq_safety_factor', t('rpLiqFactor'))}
      </div>
      <button className="btn-primary text-sm" onClick={() => void save()}>{t('rpSave')}</button>
      {msg && <p className="text-xs text-slate-400">{msg}</p>}
    </Card>
  );
}
