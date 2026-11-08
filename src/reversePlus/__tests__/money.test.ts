import { describe, expect, it } from 'vitest';
import { D, add, ceilToStep, div, floorToStep, fromString, mul, pctOf, roundToDecimals, toNumber, toString, jsonSafe } from '../../../supabase/functions/_shared/reversePlus/money';

describe('money (BigInt fixed-point)', () => {
  it('has no binary floating point error', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(add(D(0.1), D(0.2))).toBe(D(0.3));
    expect(toString(add(D('0.1'), D('0.2')))).toBe('0.3');
  });

  it('parses exponent notation and tiny BTC-pair prices exactly', () => {
    expect(toString(fromString('1.5e-7'))).toBe('0.00000015');
    expect(toString(D(0.00000123))).toBe('0.00000123');
    expect(toString(fromString('-12.50'))).toBe('-12.5');
    expect(() => fromString('abc')).toThrow();
    expect(() => D(Number.NaN)).toThrow();
  });

  it('rounds explicitly: floor / ceil / half_up, also for negatives', () => {
    const third = div(D(1), D(3), 'floor');
    const thirdUp = div(D(1), D(3), 'ceil');
    expect(thirdUp - third).toBe(1n);
    expect(toString(div(D(2), D(3), 'half_up'))).toBe('0.666666666666666667');
    expect(toString(div(D(-1), D(3), 'floor'))).toBe('-0.333333333333333334');
    expect(toString(div(D(-1), D(3), 'ceil'))).toBe('-0.333333333333333333');
  });

  it('multiplies and takes percentages exactly', () => {
    expect(toString(mul(D('0.35'), D('2.84231')))).toBe('0.9948085');
    expect(toString(pctOf(D(100), D('1')))).toBe('1');
    expect(toString(pctOf(D('99.99'), D('0.05')))).toBe('0.049995');
    expect(toString(roundToDecimals(D('1.23456789'), 4))).toBe('1.2346');
    expect(toString(roundToDecimals(D('1.23456789'), 4, 'floor'))).toBe('1.2345');
  });

  it('floors quantities to the contract step, never up', () => {
    expect(toString(floorToStep(D('0.35182'), D('0.001')))).toBe('0.351');
    expect(toString(floorToStep(D('0.0009'), D('0.001')))).toBe('0');
    expect(toString(ceilToStep(D('0.3511'), D('0.001')))).toBe('0.352');
    expect(() => floorToStep(D(1), D(0))).toThrow();
  });

  it('converts to number only for display and serialises to exact strings', () => {
    expect(toNumber(D('0.35'))).toBe(0.35);
    expect(jsonSafe({ a: D('1.5'), b: [D('0.1')] })).toEqual({ a: '1.5', b: ['0.1'] });
  });

  it('throws on division by zero', () => {
    expect(() => div(D(1), D(0))).toThrow(RangeError);
  });
});
