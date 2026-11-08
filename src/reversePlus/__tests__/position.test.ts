import { describe, expect, it } from 'vitest';
import { D, toString, toNumber } from '../../../supabase/functions/_shared/reversePlus/money';
import {
  checkLiquidation, estimateLiquidation, maxSafeLeverage, quantityForRisk, riskBudget, sizeAtRisk, violatesContract,
} from '../../../supabase/functions/_shared/reversePlus/positionCalc';
import { UNKNOWN_CONTRACT } from '../../../supabase/functions/_shared/reversePlus/types';

import { contract, cost, settings } from './fixtures';

describe('risk budget', () => {
  it('defaults: 1% of 100 USDT capped at 1 USDT', () => {
    expect(toString(riskBudget(settings))).toBe('1');
    expect(toString(riskBudget({ ...settings, riskPct: D(5) }))).toBe('1'); // cap wins
    expect(toString(riskBudget({ ...settings, riskPct: D('0.5') }))).toBe('0.5');
  });
});

describe('position size — SHORT (reverse of a BUY)', () => {
  const entry = D('100.3'), stop = D(103), target = D('98.5');

  it('sizes from the real entry→stop distance, net of fees + slippage', () => {
    const qty = quantityForRisk(D(1), entry, stop, target, cost, contract);
    expect(toString(qty)).toBe('0.351'); // 1 / 2.84231 = 0.35182 floored to the 0.001 step
    const s = sizeAtRisk(entry, stop, qty, cost, D(50));
    expect(toString(s.grossLossAtStop)).toBe('0.9477'); // 0.351 * 2.7
    expect(toNumber(s.fees)).toBeCloseTo(0.351 * (100.3 + 103) * 0.0005, 6);
    expect(toNumber(s.slippage)).toBeCloseTo(0.351 * (100.3 + 103) * 0.0002, 6);
    expect(s.netRisk <= D(1)).toBe(true);
    expect(toNumber(s.netRisk)).toBeCloseTo(0.99765, 4);
    expect(toNumber(s.notional)).toBeCloseTo(35.2053, 3);
    expect(toNumber(s.margin)).toBeCloseTo(0.7041, 3);
  });

  it('floors the quantity: the budget can never be exceeded by rounding', () => {
    for (const share of ['0.3', '0.77', '1', '0.123456']) {
      const q = quantityForRisk(D(share), entry, stop, target, cost, contract);
      expect(sizeAtRisk(entry, stop, q, cost, D(50)).netRisk <= D(share)).toBe(true);
    }
  });

  it('fees and slippage reduce the quantity', () => {
    const none = quantityForRisk(D(1), entry, stop, target, { feePct: D(0), slippagePct: D(0) }, UNKNOWN_CONTRACT);
    const withCosts = quantityForRisk(D(1), entry, stop, target, cost, UNKNOWN_CONTRACT);
    expect(withCosts < none).toBe(true);
    expect(toString(none)).toBe(toString(D(1) * 10n ** 18n / D('2.7')));
  });

  it('flags contract violations (min qty / min notional) and treats unknown contracts as estimates', () => {
    expect(violatesContract(D('0.0005'), entry, contract)).toBe('BELOW_MIN_QTY');
    expect(violatesContract(D('0.01'), entry, contract)).toBe('BELOW_MIN_NOTIONAL'); // 1.003 < 5
    expect(violatesContract(D('0.1'), entry, contract)).toBeNull();
    expect(violatesContract(D('0.0000001'), entry, UNKNOWN_CONTRACT)).toBeNull(); // unknown: not enforced
    expect(UNKNOWN_CONTRACT.known).toBe(false);
  });
});

describe('position size — LONG (reverse of a SELL)', () => {
  // original SELL at 100: zone 99.7..100, stop 101.5, target 97 -> reverse BUY stop 97, target 101.5
  const entry = D('99.7'), stop = D(97), target = D('101.5');

  it('is symmetric to the short case', () => {
    const qty = quantityForRisk(D(1), entry, stop, target, cost, contract);
    // netRiskUnit = 2.7 + 99.7*0.0007 + 97*0.0007 = 2.837679 -> 0.3524 -> 0.352
    expect(toString(qty)).toBe('0.352');
    const s = sizeAtRisk(entry, stop, qty, cost, D(50));
    expect(toNumber(s.grossLossAtStop)).toBeCloseTo(0.9504, 4);
    expect(s.netRisk <= D(1)).toBe(true);
  });

  it('long liquidation is BELOW the entry, short liquidation ABOVE it', () => {
    const longLiq = estimateLiquidation('BUY', D(100), D(10), D('0.5'));
    const shortLiq = estimateLiquidation('SELL', D(100), D(10), D('0.5'));
    expect(toString(longLiq)).toBe('90.5');
    expect(toString(shortLiq)).toBe('109.5');
  });
});

describe('liquidation vs stop', () => {
  it('50x isolated with a 2.7% stop is INVALID (liquidation comes first) — leverage is never raised silently', () => {
    const c = checkLiquidation('SELL', D('100.3'), D(103), settings);
    expect(c.stopBeforeLiq).toBe(false);
    expect(toNumber(c.liqPrice)).toBeCloseTo(101.8045, 3);
  });

  it('a lower leverage makes the same stop safe', () => {
    const c = checkLiquidation('SELL', D('100.3'), D(103), { ...settings, leverage: D(20) });
    expect(c.stopBeforeLiq).toBe(true);
  });

  it('max safe leverage is whole, derived from the stop distance and capped by the contract', () => {
    expect(toString(maxSafeLeverage(D('100.3'), D(103), settings, contract))).toBe('25');
    expect(toString(maxSafeLeverage(D(100), D('99.9'), settings, contract))).toBe('75'); // capped by contract max
    expect(toString(maxSafeLeverage(D(100), D('99.9'), settings, UNKNOWN_CONTRACT))).toBe('160'); // uncapped estimate
  });
});
