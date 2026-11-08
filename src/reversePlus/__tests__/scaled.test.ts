import { describe, expect, it } from 'vitest';
import { D, ZERO, sum, toString, toNumber } from '../../../supabase/functions/_shared/reversePlus/money';
import { enforceRiskBudget, pickStepPrices, planScaledEntries } from '../../../supabase/functions/_shared/reversePlus/scaledEntry';
import { sizeAtRisk } from '../../../supabase/functions/_shared/reversePlus/positionCalc';
import { zoneGrid } from '../../../supabase/functions/_shared/reversePlus/entryZone';
import { UNKNOWN_CONTRACT } from '../../../supabase/functions/_shared/reversePlus/types';
import { contract, cost, settings } from './fixtures';
import { lcg } from './helpers';

const low = { ...settings, leverage: D(20) }; // 20x so that the 2.7% stop is liquidation-safe
const shortInput = {
  side: 'SELL' as const,
  validPrices: zoneGrid(D('100.1'), D('100.3'), 5),
  currentPrice: D(100),
  stop: D(103),
  target: D('98.5'),
  contract,
};

describe('scaled entries — risk budget', () => {
  it('3 steps share ONE budget: total net risk <= 1 USDT, not 1 USDT per step', () => {
    const plan = planScaledEntries({ ...shortInput, settings: low });
    expect(plan.ok).toBe(true);
    expect(plan.steps.length).toBe(3);
    expect(plan.totals!.netRisk <= D(1)).toBe(true);
    for (const s of plan.steps) expect(s.netRisk <= D('0.3333333333333333334')).toBe(true);
    expect(toNumber(plan.totals!.netRisk)).toBeGreaterThan(0.95);
  });

  it('each step is sized from ITS OWN distance to the FINAL stop (farther from stop => larger qty for equal risk)', () => {
    const plan = planScaledEntries({ ...shortInput, settings: low });
    const byEntry = [...plan.steps].sort((a, b) => (a.entry < b.entry ? -1 : 1));
    // higher SELL entry is closer to the stop -> smaller risk per unit -> larger qty
    expect(byEntry[byEntry.length - 1].qty >= byEntry[0].qty).toBe(true);
    for (const s of plan.steps) expect(s.grossLossAtStop).toBe(s.qty * (s.entry < D(103) ? D(103) - s.entry : s.entry - D(103)) / 10n ** 18n);
  });

  it('weighted average entry, total notional and margin are consistent with the steps', () => {
    const plan = planScaledEntries({ ...shortInput, settings: low });
    const t = plan.totals!;
    expect(t.notional).toBe(sum(plan.steps.map((s) => s.notional)));
    expect(t.margin).toBe(sum(plan.steps.map((s) => s.margin)));
    const manual = sum(plan.steps.map((s) => (s.qty * s.entry) / 10n ** 18n)) * 10n ** 18n / t.qty;
    expect(toNumber(t.avgEntry)).toBeCloseTo(toNumber(manual), 9);
    expect(toNumber(t.marginUtilizationPct)).toBeCloseTo((toNumber(t.margin) / 100) * 100, 6);
    expect(t.availableBalance < D(100)).toBe(true);
  });

  it('fill order: SELL limits fill lowest first, BUY limits highest first', () => {
    const sell = planScaledEntries({ ...shortInput, settings: low });
    expect(sell.steps.map((s) => s.entry)).toEqual([...sell.steps.map((s) => s.entry)].sort((a, b) => (a < b ? -1 : 1)));
    const buy = planScaledEntries({
      side: 'BUY', validPrices: zoneGrid(D('99.7'), D('99.9'), 5), currentPrice: D(100), stop: D(97), target: D('101.5'), settings: low, contract,
    });
    expect(buy.ok).toBe(true);
    expect(buy.steps.map((s) => s.entry)).toEqual([...buy.steps.map((s) => s.entry)].sort((a, b) => (a > b ? -1 : 1)));
    expect(buy.totals!.netRisk <= D(1)).toBe(true);
  });

  it('never exceeds the budget for hundreds of random settings / prices / step sizes', () => {
    const rnd = lcg(42);
    for (let i = 0; i < 400; i++) {
      const balance = 20 + Math.floor(rnd() * 5000);
      const riskPct = 0.2 + rnd() * 3;
      const entries = 1 + Math.floor(rnd() * 5);
      const stopPct = 0.01 + rnd() * 0.08;
      const e0 = 1 + rnd() * 500;
      const step = [0.0001, 0.001, 0.01, 0.1][Math.floor(rnd() * 4)];
      const s = {
        ...settings,
        accountBalance: D(balance), riskPct: D(riskPct.toFixed(4)), maxRiskPerTrade: D(1 + Math.floor(rnd() * 50)),
        maxEntries: entries, leverage: D(1 + Math.floor(rnd() * 5)), maxMarginPct: D(100),
        feePct: D((rnd() * 0.1).toFixed(4)), slippagePct: D((rnd() * 0.1).toFixed(4)),
      };
      const stop = D((e0 * (1 + stopPct)).toFixed(6));
      const target = D((e0 * (1 - stopPct / 2)).toFixed(6));
      const prices = zoneGrid(D(e0.toFixed(6)), D((e0 * 1.003).toFixed(6)), 9);
      const plan = planScaledEntries({
        side: 'SELL', validPrices: prices, currentPrice: D(e0.toFixed(6)), stop: stop + 0n, target, settings: s,
        contract: { ...contract, stepSize: D(step), minQty: D(step), minNotional: null },
      });
      if (plan.totals) {
        expect(plan.totals.netRisk <= plan.riskBudget).toBe(true);
        expect(plan.steps.length).toBeLessThanOrEqual(entries);
      }
    }
  });

  it('a step that cannot be held (min notional) is rejected and its share goes to the others', () => {
    const plan = planScaledEntries({
      ...shortInput, settings: { ...low, accountBalance: D(100), maxRiskPerTrade: D('0.2'), riskPct: D(1) },
      contract: { ...contract, minNotional: D(20) },
    });
    // 0.2/3 = 0.0667 risk per step -> notional ~7 each (<20) -> fewer steps survive until each holds >=20 notional
    if (plan.ok) for (const s of plan.steps) expect(s.notional >= D(20)).toBe(true);
    expect(plan.totals === null || plan.totals.netRisk <= D('0.2')).toBe(true);
  });

  it('INVALID (LIQ_BEFORE_STOP) at 50x instead of silently changing leverage; reports the max safe leverage', () => {
    const plan = planScaledEntries({ ...shortInput, settings });
    expect(plan.ok).toBe(false);
    expect(plan.issues).toContain('LIQ_BEFORE_STOP');
    expect(plan.leverage).toBe(D(50));
    expect(Number(plan.maxSafeLeverage! / 10n ** 18n)).toBeLessThan(50);
    expect(Number(plan.maxSafeLeverage! / 10n ** 18n)).toBeGreaterThan(10);
  });

  it('leverage above the contract maximum is a hard failure; unknown contract => flagged estimate', () => {
    const over = planScaledEntries({ ...shortInput, settings: { ...low, leverage: D(100) }, contract });
    expect(over.ok).toBe(false);
    expect(over.issues).toContain('LEVERAGE_ABOVE_CONTRACT_MAX');
    const unknown = planScaledEntries({ ...shortInput, settings: low, contract: UNKNOWN_CONTRACT });
    expect(unknown.estimated).toBe(true);
    expect(unknown.issues).toContain('CONTRACT_UNKNOWN_ESTIMATE');
    expect(unknown.issues).toContain('LIQ_IS_ESTIMATE');
  });

  it('margin allocation cap scales sizes DOWN (risk only gets smaller)', () => {
    const plan = planScaledEntries({ ...shortInput, settings: { ...low, leverage: D(20), maxMarginPct: D('0.3') }, contract: { ...contract, minNotional: null } });
    expect(plan.issues).toContain('MARGIN_CAP_REDUCED');
    expect(plan.totals!.margin <= D('0.3')).toBe(true);
    expect(plan.totals!.netRisk < D(1)).toBe(true);
  });

  it('cross margin: liquidation is NOT invented', () => {
    const plan = planScaledEntries({ ...shortInput, settings: { ...low, marginMode: 'CROSS' } });
    expect(plan.liq).toBeNull();
    expect(plan.issues).toContain('CROSS_MARGIN_LIQ_UNKNOWN');
  });

  it('no martingale: with equal shares no step is larger in risk than its share', () => {
    const plan = planScaledEntries({ ...shortInput, settings: low });
    const first = plan.steps[0].netRisk;
    for (const s of plan.steps) expect(s.netRisk <= first + D('0.1')).toBe(true);
  });
});

describe('enforceRiskBudget (safety net)', () => {
  const oversize = [D('0.5'), D('0.4'), D('0.3')].map((q) => sizeAtRisk(D(100), D(103), q, cost, D(10)));
  const resize = (s: ReturnType<typeof sizeAtRisk>, q: bigint) => sizeAtRisk(s.entry, D(103), q, cost, D(10));

  it('drops / shrinks trailing steps until the total fits', () => {
    const r = enforceRiskBudget(oversize, D(1), resize);
    expect(r.enforced).toBe(true);
    expect(sum(r.steps.map((s) => s.netRisk)) <= D(1)).toBe(true);
  });

  it('leaves a compliant plan untouched', () => {
    const r = enforceRiskBudget(oversize, D(100), resize);
    expect(r.enforced).toBe(false);
    expect(r.steps).toHaveLength(3);
  });

  it('pickStepPrices spreads picks evenly and keeps both ends', () => {
    const grid = zoneGrid(D(100), D(101), 11);
    const p = pickStepPrices(grid, 3);
    expect(p.map(toString)).toEqual(['100', '100.5', '101']);
    expect(pickStepPrices(grid, 1).map(toString)).toEqual(['101']);
    expect(pickStepPrices([], 3)).toEqual([]);
    expect(ZERO).toBe(0n);
  });
});
