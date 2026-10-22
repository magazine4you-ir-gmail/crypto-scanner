import { describe, it, expect } from 'vitest';
import { calculate, parseNum, liquidationPrice, type CalcInput } from './futuresCalc';

const base: CalcInput = {
  side: 'long', margin: 10, leverage: 10, entry: 100, sl: 95,
  tps: [{ price: 110, closePct: 50 }, { price: 120, closePct: 50 }],
  mode: 'split', makerFeePct: 0, takerFeePct: 0,
  entryFee: 'taker', tpFee: 'maker', slFee: 'taker', mmrPct: 0.5,
};

describe('futuresCalc', () => {
  it('computes notional and quantity', () => {
    const r = calculate(base)!;
    expect(r.notional).toBe(100);
    expect(r.quantity).toBe(1);
  });
  it('long split mode with no fees', () => {
    const r = calculate(base)!;
    expect(r.sl!.netPnl).toBeCloseTo(-5);
    expect(r.tps[0].netPnl).toBeCloseTo(5);   // 50 notional * 10%
    expect(r.tps[1].netPnl).toBeCloseTo(10);  // 50 notional * 20%
    expect(r.tps[0].movePct).toBeCloseTo(10);
    expect(r.tps[0].roePct).toBeCloseTo(100);
    expect(r.tps[0].rr).toBeCloseTo(1);
    expect(r.combined!.netPnl).toBeCloseTo(15);
    expect(r.combined!.rr).toBeCloseTo(3);
  });
  it('full mode evaluates each TP on whole position', () => {
    const r = calculate({ ...base, mode: 'full' })!;
    expect(r.tps[0].netPnl).toBeCloseTo(10);
    expect(r.tps[1].netPnl).toBeCloseTo(20);
    expect(r.tps[0].rr).toBeCloseTo(2);
    expect(r.combined).toBeNull();
  });
  it('short side flips direction', () => {
    const r = calculate({ ...base, side: 'short', sl: 105, tps: [{ price: 90, closePct: 100 }] })!;
    expect(r.tps[0].netPnl).toBeCloseTo(10);
    expect(r.sl!.netPnl).toBeCloseTo(-5);
    expect(r.tps[0].rr).toBeCloseTo(2);
  });
  it('applies fees', () => {
    const r = calculate({ ...base, makerFeePct: 0.02, takerFeePct: 0.05, tps: [{ price: 110, closePct: 100 }] })!;
    // open taker 100*0.0005=0.05 ; close maker 110*0.0002=0.022
    expect(r.tps[0].fees).toBeCloseTo(0.072);
    expect(r.tps[0].netPnl).toBeCloseTo(10 - 0.072);
  });
  it('flags wrong-side prices and sl beyond liq', () => {
    const r = calculate({ ...base, sl: 105, tps: [{ price: 90, closePct: 100 }] })!;
    expect(r.warnings).toContain('slWrongSide');
    expect(r.warnings).toContain('tpWrongSide');
    const r2 = calculate({ ...base, leverage: 50, sl: 95 })!;
    expect(r2.warnings).toContain('slBeyondLiq');
  });
  it('flags split percentages', () => {
    expect(calculate({ ...base, tps: [{ price: 110, closePct: 70 }, { price: 120, closePct: 50 }] })!.warnings).toContain('pctOver100');
    expect(calculate({ ...base, tps: [{ price: 110, closePct: 40 }] })!.warnings).toContain('pctUnder100');
  });
  it('liq price', () => {
    expect(liquidationPrice('long', 100, 10, 0.5)).toBeCloseTo(90.5);
    expect(liquidationPrice('short', 100, 10, 0.5)).toBeCloseTo(109.5);
  });
  it('parses Persian digits', () => {
    expect(parseNum('۸۲٬۰۱۰٫۵')).toBe(82010.5);
    expect(parseNum('')).toBeNaN();
  });
  it('returns null for invalid input', () => {
    expect(calculate({ ...base, margin: 0 })).toBeNull();
  });
});
