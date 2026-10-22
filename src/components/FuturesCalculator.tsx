import { useMemo, useState, useEffect } from 'react';
import { Calculator, X, Plus, Trash2, AlertTriangle, RotateCcw } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import {
  calculate,
  parseNum,
  type FeeKind,
  type Side,
  type TpMode,
} from '@/lib/futuresCalc';

const L = {
  title: { fa: 'ماشین حساب فیوچرز', en: 'Futures Calculator' },
  open: { fa: 'ماشین حساب ترید', en: 'Trade calculator' },
  long: { fa: 'خرید (لانگ)', en: 'Buy / Long' },
  short: { fa: 'فروش (شورت)', en: 'Sell / Short' },
  capital: { fa: 'سرمایه (مارجین)', en: 'Capital (margin)' },
  leverage: { fa: 'لوریج', en: 'Leverage' },
  entry: { fa: 'قیمت ورود', en: 'Entry price' },
  sl: { fa: 'حد ضرر (SL)', en: 'Stop loss (SL)' },
  tp: { fa: 'حد سود', en: 'Take profit' },
  addTp: { fa: 'افزودن حد سود', en: 'Add take profit' },
  closePct: { fa: 'درصد بستن', en: 'Close %' },
  modeSplit: { fa: 'تقسیم پوزیشن', en: 'Split position' },
  modeFull: { fa: 'کل پوزیشن', en: 'Full position' },
  modeHintSplit: {
    fa: 'هر حد سود درصدی از پوزیشن را می‌بندد.',
    en: 'Each TP closes a % of the position.',
  },
  modeHintFull: {
    fa: 'سود هر حد سود برای کل پوزیشن محاسبه می‌شود.',
    en: 'Each TP is calculated on the whole position.',
  },
  fees: { fa: 'کارمزد', en: 'Fees' },
  maker: { fa: 'میکر %', en: 'Maker %' },
  taker: { fa: 'تیکر %', en: 'Taker %' },
  entryOrder: { fa: 'ورود', en: 'Entry' },
  tpOrder: { fa: 'حد سود', en: 'TP' },
  slOrder: { fa: 'حد ضرر', en: 'SL' },
  mmr: { fa: 'مارجین نگهداری %', en: 'Maint. margin %' },
  result: { fa: 'نتیجه', en: 'Result' },
  margin: { fa: 'مارجین', en: 'Margin' },
  positionSize: { fa: 'سایز پوزیشن', en: 'Position size' },
  quantity: { fa: 'مقدار', en: 'Quantity' },
  liq: { fa: 'قیمت لیکوییدیشن (تقریبی)', en: 'Liq. price (approx.)' },
  move: { fa: 'جابجایی قیمت', en: 'Price move' },
  roe: { fa: 'بازده روی مارجین', en: 'ROE' },
  gross: { fa: 'سود/ضرر ناخالص', en: 'Gross P&L' },
  feesTotal: { fa: 'کارمزد', en: 'Fees' },
  net: { fa: 'سود/ضرر خالص', en: 'Net P&L' },
  rr: { fa: 'ریسک به ریوارد', en: 'Risk : Reward' },
  combined: { fa: 'مجموع همه حد سودها', en: 'All TPs combined' },
  noSl: { fa: 'برای محاسبه ریسک به ریوارد حد ضرر وارد کنید.', en: 'Enter a stop loss to get risk : reward.' },
  empty: { fa: 'سرمایه، لوریج و قیمت ورود را وارد کنید.', en: 'Enter capital, leverage and entry price.' },
  reset: { fa: 'بازنشانی', en: 'Reset' },
  close: { fa: 'بستن', en: 'Close' },
  disclaimer: {
    fa: 'محاسبات تقریبی است و ممکن است با قوانین دقیق صرافی (فاندینگ، مارجین نگهداری پلکانی) تفاوت داشته باشد.',
    en: 'Estimates only; exchange rules (funding, tiered maintenance margin) may differ.',
  },
  w_tpWrongSide: { fa: 'یکی از حد سودها سمت اشتباه قیمت ورود است.', en: 'A take profit is on the wrong side of entry.' },
  w_slWrongSide: { fa: 'حد ضرر سمت اشتباه قیمت ورود است.', en: 'Stop loss is on the wrong side of entry.' },
  w_slBeyondLiq: { fa: 'حد ضرر بعد از قیمت لیکوییدیشن است؛ قبل از رسیدن به آن لیکویید می‌شوید.', en: 'Stop loss is beyond liquidation; you would be liquidated first.' },
  w_pctOver100: { fa: 'مجموع درصدهای بستن بیشتر از ۱۰۰٪ است.', en: 'Close percentages add up to more than 100%.' },
  w_pctUnder100: { fa: 'مجموع درصدهای بستن کمتر از ۱۰۰٪ است؛ بقیه پوزیشن باز می‌ماند.', en: 'Close percentages add up to less than 100%; the rest stays open.' },
} as const;
type K = keyof typeof L;

interface TpRow { id: number; price: string; pct: string }

const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const price = (n: number) => fmt(n, Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 1 ? 4 : 8);
const signed = (n: number, d = 2) => `${n > 0 ? '+' : ''}${fmt(n, d)}`;
const tone = (n: number) => (n > 0 ? 'text-success-400' : n < 0 ? 'text-error-400' : 'text-slate-200');

const inputCls =
  'w-full bg-surface-100 border border-surface-300 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500 [direction:ltr] text-left';
const labelCls = 'block text-xs text-slate-400 mb-1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: Array<{ v: T; label: string; cls?: string }>;
}) {
  return (
    <div className="grid gap-1 p-1 bg-surface-100 rounded-lg" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`py-1.5 rounded-md text-xs font-medium transition-colors ${
            value === o.v ? o.cls ?? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ k, v, cls = '' }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-0.5">
      <span className="text-slate-400">{k}</span>
      <span className={`font-mono [direction:ltr] ${cls || 'text-slate-200'}`}>{v}</span>
    </div>
  );
}

export function FuturesCalculatorButton() {
  const { lang } = useSettings();
  const [open, setOpen] = useState(false);
  const tr = (k: K) => L[k][lang];

  const [side, setSide] = useState<Side>('long');
  const [capital, setCapital] = useState('10');
  const [leverage, setLeverage] = useState('10');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [mode, setMode] = useState<TpMode>('split');
  const [tps, setTps] = useState<TpRow[]>([{ id: 1, price: '', pct: '100' }]);
  const [nextId, setNextId] = useState(2);
  const [maker, setMaker] = useState('0.02');
  const [taker, setTaker] = useState('0.05');
  const [entryFee, setEntryFee] = useState<FeeKind>('taker');
  const [tpFee, setTpFee] = useState<FeeKind>('maker');
  const [slFee, setSlFee] = useState<FeeKind>('taker');
  const [mmr, setMmr] = useState('0.5');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const addTp = () => {
    if (tps.length >= 5) return;
    setTps([...tps, { id: nextId, price: '', pct: '' }]);
    setNextId(nextId + 1);
  };
  const updTp = (id: number, patch: Partial<TpRow>) => setTps(tps.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const delTp = (id: number) => setTps(tps.filter((t) => t.id !== id));

  const reset = () => {
    setSide('long'); setCapital('10'); setLeverage('10'); setEntry(''); setSl('');
    setMode('split'); setTps([{ id: 1, price: '', pct: '100' }]); setNextId(2);
  };

  const res = useMemo(() => {
    const slN = parseNum(sl);
    return calculate({
      side,
      margin: parseNum(capital),
      leverage: parseNum(leverage),
      entry: parseNum(entry),
      sl: Number.isFinite(slN) ? slN : null,
      tps: tps
        .map((t) => ({ price: parseNum(t.price), closePct: Number.isFinite(parseNum(t.pct)) ? parseNum(t.pct) : 0 }))
        .filter((t) => Number.isFinite(t.price)),
      mode,
      makerFeePct: parseNum(maker) || 0,
      takerFeePct: parseNum(taker) || 0,
      entryFee, tpFee, slFee,
      mmrPct: parseNum(mmr) || 0,
    });
  }, [side, capital, leverage, entry, sl, tps, mode, maker, taker, entryFee, tpFee, slFee, mmr]);

  const feeOpts = [
    { v: 'maker' as FeeKind, label: lang === 'fa' ? 'میکر' : 'Maker' },
    { v: 'taker' as FeeKind, label: lang === 'fa' ? 'تیکر' : 'Taker' },
  ];
  const marginN = parseNum(capital);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tr('open')}
        title={tr('open')}
        className="fixed z-40 end-4 bottom-24 lg:bottom-6 flex items-center gap-2 px-4 py-3 rounded-full bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-900/40 transition-colors"
      >
        <Calculator className="w-5 h-5" />
        <span className="hidden sm:inline text-sm font-medium">{tr('open')}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-surface-0/80 backdrop-blur-sm sm:p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={tr('title')}
        >
          <div
            className="w-full sm:max-w-4xl max-h-[92dvh] flex flex-col bg-surface-50 border border-surface-200 rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-surface-200">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-primary-400" />
                <h2 className="text-base sm:text-lg font-bold text-slate-100">{tr('title')}</h2>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={reset} className="p-2 rounded-lg text-slate-400 hover:bg-surface-100" aria-label={tr('reset')} title={tr('reset')}>
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-lg text-slate-400 hover:bg-surface-100" aria-label={tr('close')}>
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto overscroll-contain p-4 sm:p-6 grid md:grid-cols-2 gap-6">
              {/* Inputs */}
              <div className="space-y-4">
                <Seg
                  value={side}
                  onChange={setSide}
                  options={[
                    { v: 'long', label: tr('long'), cls: 'bg-success-600 text-white' },
                    { v: 'short', label: tr('short'), cls: 'bg-error-600 text-white' },
                  ]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`${tr('capital')} (USDT)`}>
                    <input className={inputCls} inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} />
                  </Field>
                  <Field label={`${tr('leverage')} (x)`}>
                    <input className={inputCls} inputMode="decimal" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
                  </Field>
                </div>
                <input
                  type="range" min={1} max={200} step={1}
                  value={Math.min(200, Math.max(1, Number.isFinite(parseNum(leverage)) ? parseNum(leverage) : 1))}
                  onChange={(e) => setLeverage(e.target.value)}
                  className="w-full accent-primary-500 [direction:ltr]"
                  aria-label={tr('leverage')}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`${tr('entry')} (USDT)`}>
                    <input className={inputCls} inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="82010.2" />
                  </Field>
                  <Field label={`${tr('sl')} (USDT)`}>
                    <input className={`${inputCls} border-error-500/40`} inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
                  </Field>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">{tr('tp')}</span>
                    <Seg
                      value={mode}
                      onChange={setMode}
                      options={[
                        { v: 'split', label: tr('modeSplit') },
                        { v: 'full', label: tr('modeFull') },
                      ]}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">{mode === 'split' ? tr('modeHintSplit') : tr('modeHintFull')}</p>
                  {tps.map((t, idx) => (
                    <div key={t.id} className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className={labelCls}>{`TP${idx + 1}`}</label>
                        <input className={`${inputCls} border-success-500/40`} inputMode="decimal" value={t.price} onChange={(e) => updTp(t.id, { price: e.target.value })} />
                      </div>
                      {mode === 'split' && (
                        <div className="w-24">
                          <label className={labelCls}>{tr('closePct')}</label>
                          <input className={inputCls} inputMode="decimal" value={t.pct} onChange={(e) => updTp(t.id, { pct: e.target.value })} />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => delTp(t.id)}
                        disabled={tps.length === 1}
                        className="p-2 mb-0.5 rounded-lg text-slate-500 hover:text-error-400 disabled:opacity-30 disabled:hover:text-slate-500"
                        aria-label="remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {tps.length < 5 && (
                    <button type="button" onClick={addTp} className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300">
                      <Plus className="w-4 h-4" /> {tr('addTp')}
                    </button>
                  )}
                </div>

                <details className="group rounded-lg border border-surface-200 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-300">{tr('fees')}</summary>
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <Field label={tr('maker')}><input className={inputCls} inputMode="decimal" value={maker} onChange={(e) => setMaker(e.target.value)} /></Field>
                      <Field label={tr('taker')}><input className={inputCls} inputMode="decimal" value={taker} onChange={(e) => setTaker(e.target.value)} /></Field>
                      <Field label={tr('mmr')}><input className={inputCls} inputMode="decimal" value={mmr} onChange={(e) => setMmr(e.target.value)} /></Field>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label={tr('entryOrder')}><Seg value={entryFee} onChange={setEntryFee} options={feeOpts} /></Field>
                      <Field label={tr('tpOrder')}><Seg value={tpFee} onChange={setTpFee} options={feeOpts} /></Field>
                      <Field label={tr('slOrder')}><Seg value={slFee} onChange={setSlFee} options={feeOpts} /></Field>
                    </div>
                  </div>
                </details>
              </div>

              {/* Results */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-300">{tr('result')}</h3>
                {!res ? (
                  <p className="text-sm text-slate-500 py-8 text-center">{tr('empty')}</p>
                ) : (
                  <>
                    <div className="rounded-xl bg-surface-100 border border-surface-200 p-3">
                      <Row k={tr('margin')} v={`${fmt(marginN, 4)} USDT`} />
                      <Row k={tr('positionSize')} v={`${fmt(res.notional, 2)} USDT`} />
                      <Row k={tr('quantity')} v={fmt(res.quantity, 6)} />
                      <Row k={tr('liq')} v={price(res.liqPrice)} cls="text-warning-400" />
                    </div>

                    {res.warnings.map((w) => (
                      <div key={w} className="flex items-start gap-2 text-xs text-warning-300 bg-warning-500/10 border border-warning-500/30 rounded-lg p-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{tr(`w_${w}` as K)}</span>
                      </div>
                    ))}

                    {res.sl && res.sl.valid ? (
                      <div className="rounded-xl bg-error-500/5 border border-error-500/30 p-3">
                        <div className="text-xs font-semibold text-error-400 mb-1">{tr('sl')} · {price(res.sl.price)}</div>
                        <Row k={tr('move')} v={`${signed(res.sl.movePct)}%`} cls="text-error-400" />
                        <Row k={tr('roe')} v={`${signed(res.sl.roePct)}%`} cls="text-error-400" />
                        <Row k={tr('feesTotal')} v={fmt(res.sl.fees, 4)} />
                        <Row k={tr('net')} v={`${signed(res.sl.netPnl, 4)} USDT`} cls="text-error-400" />
                      </div>
                    ) : (
                      !res.sl && <p className="text-xs text-slate-500">{tr('noSl')}</p>
                    )}

                    {res.tps.map((t, i) => (
                      <div key={i} className="rounded-xl bg-success-500/5 border border-success-500/30 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-success-400">TP{i + 1} · {price(t.price)}</span>
                          {mode === 'split' && <span className="text-[11px] text-slate-400 font-mono">{fmt(t.closePct, 0)}%</span>}
                        </div>
                        <Row k={tr('move')} v={`${signed(t.movePct)}%`} cls={tone(t.movePct)} />
                        <Row k={tr('roe')} v={`${signed(t.roePct)}%`} cls={tone(t.roePct)} />
                        <Row k={tr('gross')} v={`${signed(t.grossPnl, 4)} USDT`} cls={tone(t.grossPnl)} />
                        <Row k={tr('feesTotal')} v={fmt(t.fees, 4)} />
                        <Row k={tr('net')} v={`${signed(t.netPnl, 4)} USDT`} cls={tone(t.netPnl)} />
                        {t.rr !== null && <Row k={tr('rr')} v={`1 : ${fmt(t.rr, 2)}`} cls="text-primary-400 font-semibold" />}
                      </div>
                    ))}

                    {res.combined && res.tps.length > 1 && (
                      <div className="rounded-xl bg-primary-500/10 border border-primary-500/30 p-3">
                        <div className="text-xs font-semibold text-primary-300 mb-1">{tr('combined')}</div>
                        <Row k={tr('roe')} v={`${signed(res.combined.roePct)}%`} cls={tone(res.combined.roePct)} />
                        <Row k={tr('net')} v={`${signed(res.combined.netPnl, 4)} USDT`} cls={tone(res.combined.netPnl)} />
                        {res.combined.rr !== null && <Row k={tr('rr')} v={`1 : ${fmt(res.combined.rr, 2)}`} cls="text-primary-400 font-semibold" />}
                      </div>
                    )}
                  </>
                )}
                <p className="text-[11px] text-slate-500 leading-relaxed">{tr('disclaimer')}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
