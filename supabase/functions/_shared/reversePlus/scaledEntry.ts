// Reverse Signal Plus — scaled (multi-step) entry planner.
//
// RULE: the TOTAL net risk of all steps (price loss to the FINAL stop + fees + slippage) never exceeds the
// trade's risk budget. The budget is SPLIT between the steps, it is not granted to each of them.
// Every step is sized from ITS OWN distance to the final reverse stop. No martingale: sizes are never
// increased to recover a loss.
import { ZERO, cmp, div, floorToStep, mul, sub, sum } from './money.ts';
import type { Dec } from './money.ts';
import {
  HARD_ISSUES,
  checkLiquidation,
  maxSafeLeverage,
  quantityForRisk,
  riskBudget,
  sizeAtRisk,
  totalsOf,
  violatesContract,
} from './positionCalc.ts';
import type { LiqCheck, PlanIssue, StepSize, Totals } from './positionCalc.ts';
import { geometryOk } from './entryZone.ts';
import type { ContractSpec, PlusSettings, Side } from './types.ts';

export interface PlannedStep extends StepSize {
  /** 1 = first order expected to fill (closest to the current price). */
  order: number;
}

export interface ScaledPlanInput {
  side: Side;
  /** Candidate prices inside the existing zone that already passed the minimum-RR test. */
  validPrices: Dec[];
  currentPrice: Dec;
  stop: Dec;
  target: Dec;
  settings: PlusSettings;
  contract: ContractSpec;
}

export interface ScaledPlan {
  ok: boolean;
  issues: PlanIssue[];
  riskBudget: Dec;
  steps: PlannedStep[];
  totals: Totals | null;
  /** liquidation check at the average entry once EVERY step is filled (ISOLATED only). */
  liq: LiqCheck | null;
  maxSafeLeverage: Dec | null;
  leverage: Dec;
  estimated: boolean;
}

/** Picks up to `n` prices spread evenly over the (sorted ascending) valid prices, always keeping both ends. */
export function pickStepPrices(sortedAsc: Dec[], n: number): Dec[] {
  if (n <= 0 || sortedAsc.length === 0) return [];
  if (sortedAsc.length <= n) return [...sortedAsc];
  if (n === 1) return [sortedAsc[sortedAsc.length - 1]];
  const out: Dec[] = [];
  for (let i = 0; i < n; i++) out.push(sortedAsc[Math.round((i * (sortedAsc.length - 1)) / (n - 1))]);
  return Array.from(new Set(out.map((p) => p.toString()))).map((s) => BigInt(s));
}

/**
 * Safety net: if the sum of net risks is above the budget (cannot happen with the allocation below, but the
 * invariant is enforced anyway), the LAST steps are dropped / reduced until it fits.
 */
export function enforceRiskBudget(
  steps: StepSize[],
  budget: Dec,
  resize: (step: StepSize, qty: Dec) => StepSize,
): { steps: StepSize[]; enforced: boolean } {
  const out = [...steps];
  let enforced = false;
  while (out.length && cmp(sum(out.map((s) => s.netRisk)), budget) > 0) {
    enforced = true;
    const last = out[out.length - 1];
    const others = sum(out.slice(0, -1).map((s) => s.netRisk));
    const room = sub(budget, others);
    if (room <= ZERO || last.netRisk <= ZERO) {
      out.pop();
      continue;
    }
    // shrink the last step proportionally (rounded down), drop it if nothing is left
    const qty = div(mul(last.qty, room), last.netRisk, 'floor');
    if (qty <= ZERO) out.pop();
    else out[out.length - 1] = resize(last, qty);
  }
  return { steps: out, enforced };
}

export function planScaledEntries(input: ScaledPlanInput): ScaledPlan {
  const { side, stop, target, settings, contract } = input;
  const cost = { feePct: settings.feePct, slippagePct: settings.slippagePct };
  const budget = riskBudget(settings);
  const issues: PlanIssue[] = [];
  const estimated = !contract.known;
  if (estimated) issues.push('CONTRACT_UNKNOWN_ESTIMATE');

  const fail = (extra: PlanIssue[]): ScaledPlan => ({
    ok: false,
    issues: [...issues, ...extra],
    riskBudget: budget,
    steps: [],
    totals: null,
    liq: null,
    maxSafeLeverage: null,
    leverage: settings.leverage,
    estimated,
  });

  if (contract.maxLeverage !== null && settings.leverage > contract.maxLeverage) {
    issues.push('LEVERAGE_ABOVE_CONTRACT_MAX');
  }

  const sorted = [...input.validPrices]
    .filter((p) => geometryOk(side, p, stop, target))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const wanted = pickStepPrices(sorted, Math.max(1, Math.floor(settings.maxEntries)));
  if (wanted.length === 0 || budget <= ZERO) return fail(['NO_STEPS']);

  // Fill order: the order in which the market reaches the limits (nearest to the current price first).
  // SELL limits sit above a rising market -> lowest price first. BUY limits sit below -> highest first.
  let prices = side === 'SELL' ? [...wanted].sort((a, b) => (a < b ? -1 : 1)) : [...wanted].sort((a, b) => (a > b ? -1 : 1));

  // Equal risk share per step; steps the contract cannot hold are dropped and their share goes to the rest.
  let sized: StepSize[] = [];
  for (let guard = 0; guard <= wanted.length; guard++) {
    const share = div(budget, BigInt(prices.length) * 10n ** 18n, 'floor');
    sized = [];
    const rejected: Dec[] = [];
    for (const p of prices) {
      const qty = quantityForRisk(share, p, stop, target, cost, contract);
      const bad = violatesContract(qty, p, contract);
      if (bad) rejected.push(p);
      else sized.push(sizeAtRisk(p, stop, qty, cost, settings.leverage));
    }
    if (rejected.length === 0 || sized.length === 0) {
      if (sized.length === 0) {
        const why = violatesContract(quantityForRisk(share, prices[0], stop, target, cost, contract), prices[0], contract);
        return fail([why ?? 'ZERO_QTY']);
      }
      break;
    }
    prices = prices.filter((p) => !rejected.includes(p));
    if (prices.length === 0) return fail(['ZERO_QTY']);
  }

  // Margin allocation cap: scale every step down (never up).
  const maxMargin = div(mul(settings.accountBalance, settings.maxMarginPct), 100n * 10n ** 18n, 'floor');
  let totalMargin = sum(sized.map((s) => s.margin));
  if (cmp(totalMargin, maxMargin) > 0 && totalMargin > ZERO) {
    issues.push('MARGIN_CAP_REDUCED');
    const k = div(maxMargin, totalMargin, 'floor');
    sized = sized
      .map((s) => {
        const q0 = mul(s.qty, k, 'floor');
        const q = contract.stepSize ? floorToStep(q0, contract.stepSize) : q0;
        return sizeAtRisk(s.entry, stop, q, cost, settings.leverage);
      })
      .filter((s) => violatesContract(s.qty, s.entry, contract) === null);
    totalMargin = sum(sized.map((s) => s.margin));
    if (sized.length === 0) return fail(['NO_STEPS']);
  }

  const resize = (s: StepSize, qty: Dec) => sizeAtRisk(s.entry, stop, qty, cost, settings.leverage);
  const enforced = enforceRiskBudget(sized, budget, resize);
  if (enforced.enforced) issues.push('RISK_BUDGET_ENFORCED');
  sized = enforced.steps;
  if (sized.length === 0) return fail(['NO_STEPS']);

  const steps: PlannedStep[] = sized.map((s, i) => ({ ...s, order: i + 1 }));
  const totals = totalsOf(steps, settings, cost);

  // Liquidation: checked for EVERY partial-fill state (first k steps filled), not just the final one.
  let liq: LiqCheck | null = null;
  if (settings.marginMode === 'ISOLATED') {
    issues.push('LIQ_IS_ESTIMATE');
    for (let k = 1; k <= steps.length; k++) {
      const part = steps.slice(0, k);
      const avg = totalsOf(part, settings, cost).avgEntry;
      const c = checkLiquidation(side, avg, stop, settings);
      if (k === steps.length) liq = c;
      if (!c.stopBeforeLiq && !issues.includes('LIQ_BEFORE_STOP')) issues.push('LIQ_BEFORE_STOP');
    }
  } else {
    issues.push('CROSS_MARGIN_LIQ_UNKNOWN');
  }

  const msl = maxSafeLeverage(totals.avgEntry, stop, settings, contract);
  const ok = !issues.some((i) => (HARD_ISSUES as readonly string[]).includes(i));
  // invariant (defensive): the final answer can never exceed the budget
  if (cmp(totals.netRisk, budget) > 0) return fail(['RISK_BUDGET_ENFORCED']);
  return { ok, issues, riskBudget: budget, steps, totals, liq, maxSafeLeverage: msl, leverage: settings.leverage, estimated };
}

