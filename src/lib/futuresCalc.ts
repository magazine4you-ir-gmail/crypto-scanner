export type Side = 'long' | 'short';
export type TpMode = 'split' | 'full';
export type FeeKind = 'maker' | 'taker';

export interface TpInput {
  price: number;
  /** Percent of the position closed at this TP (used in "split" mode). */
  closePct: number;
}

export interface CalcInput {
  side: Side;
  margin: number; // USDT capital used as margin
  leverage: number;
  entry: number;
  sl: number | null;
  tps: TpInput[];
  mode: TpMode;
  makerFeePct: number; // e.g. 0.02
  takerFeePct: number; // e.g. 0.05
  entryFee: FeeKind;
  tpFee: FeeKind;
  slFee: FeeKind;
  /** Maintenance margin rate in percent, used for the approximate liq price. */
  mmrPct: number;
}

export interface LegResult {
  price: number;
  /** Price move (in the trade direction) from entry, percent. Negative = against. */
  movePct: number;
  /** Return on margin, percent (move * leverage). */
  roePct: number;
  closePct: number;
  notional: number; // notional closed at this leg (at entry price)
  grossPnl: number;
  fees: number; // open + close fees attributable to this leg
  netPnl: number;
  valid: boolean; // price is on the correct side of entry
}

export interface TpResult extends LegResult {
  /** Reward/risk on the full-position stop loss. Null when no SL. */
  rr: number | null;
}

export interface CalcResult {
  notional: number;
  quantity: number;
  liqPrice: number;
  sl: LegResult | null;
  tps: TpResult[];
  totalClosePct: number;
  /** Combined result when every TP is hit (split mode: sum of legs). */
  combined: { grossPnl: number; netPnl: number; roePct: number; rr: number | null } | null;
  warnings: Array<'tpWrongSide' | 'slWrongSide' | 'slBeyondLiq' | 'pctOver100' | 'pctUnder100'>;
}

const feeRate = (i: CalcInput, k: FeeKind) => (k === 'maker' ? i.makerFeePct : i.takerFeePct) / 100;

export function liquidationPrice(side: Side, entry: number, leverage: number, mmrPct: number): number {
  const mmr = mmrPct / 100;
  return side === 'long' ? entry * (1 - 1 / leverage + mmr) : entry * (1 + 1 / leverage - mmr);
}

function leg(i: CalcInput, price: number, closePct: number, closeFee: FeeKind): LegResult {
  const dir = i.side === 'long' ? 1 : -1;
  const notionalTotal = i.margin * i.leverage;
  const share = closePct / 100;
  const notional = notionalTotal * share;
  const move = ((price - i.entry) / i.entry) * dir;
  const grossPnl = notional * move;
  const openFee = notional * feeRate(i, i.entryFee);
  const closeNotional = notional * (price / i.entry);
  const fees = openFee + closeNotional * feeRate(i, closeFee);
  return {
    price,
    movePct: move * 100,
    roePct: move * 100 * i.leverage,
    closePct,
    notional,
    grossPnl,
    fees,
    netPnl: grossPnl - fees,
    valid: true,
  };
}

export function calculate(i: CalcInput): CalcResult | null {
  if (!(i.margin > 0) || !(i.leverage >= 1) || !(i.entry > 0)) return null;
  const notional = i.margin * i.leverage;
  const dir = i.side === 'long' ? 1 : -1;
  const warnings: CalcResult['warnings'] = [];
  const liqPrice = liquidationPrice(i.side, i.entry, i.leverage, i.mmrPct);

  let sl: LegResult | null = null;
  if (i.sl !== null && i.sl > 0) {
    sl = leg(i, i.sl, 100, i.slFee);
    sl.valid = (i.sl - i.entry) * dir < 0;
    if (!sl.valid) warnings.push('slWrongSide');
    if ((i.sl - liqPrice) * dir <= 0) warnings.push('slBeyondLiq');
  }
  const risk = sl && sl.valid ? Math.abs(sl.netPnl) : null;

  const valid = i.tps.filter((t) => t.price > 0);
  const totalClosePct = i.mode === 'split' ? valid.reduce((s, t) => s + t.closePct, 0) : 100;
  if (i.mode === 'split' && valid.length) {
    if (totalClosePct > 100.0001) warnings.push('pctOver100');
    else if (totalClosePct < 99.9999) warnings.push('pctUnder100');
  }

  const tps: TpResult[] = valid.map((t) => {
    const r = leg(i, t.price, i.mode === 'split' ? t.closePct : 100, i.tpFee);
    r.valid = (t.price - i.entry) * dir > 0;
    if (!r.valid) warnings.push('tpWrongSide');
    // R:R is always against the full-position risk, so partial TPs read as honest.
    const rr = risk && risk > 0 ? r.netPnl / risk : null;
    return { ...r, rr };
  });

  let combined: CalcResult['combined'] = null;
  if (i.mode === 'split' && tps.length) {
    const gross = tps.reduce((s, t) => s + t.grossPnl, 0);
    const net = tps.reduce((s, t) => s + t.netPnl, 0);
    combined = { grossPnl: gross, netPnl: net, roePct: (gross / i.margin) * 100, rr: risk && risk > 0 ? net / risk : null };
  }

  return {
    notional,
    quantity: notional / i.entry,
    liqPrice,
    sl,
    tps,
    totalClosePct,
    combined,
    warnings: Array.from(new Set(warnings)),
  };
}

/** Accepts Persian/Arabic digits and separators. Returns NaN when empty/invalid. */
export function parseNum(raw: string): number {
  const s = raw
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.');
  if (s.trim() === '') return NaN;
  return Number(s);
}
