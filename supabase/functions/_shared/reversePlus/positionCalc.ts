// Reverse Signal Plus — Futures position calculator (analysis only, no order execution).
//
// All sizes are derived from the REAL distance between the entry and the (unchanged) reverse stop and
// are net of fees + slippage, so `netRisk <= risk budget` always holds. Quantities are floored to the
// contract stepSize (never rounded up). When the exchange filters are unknown nothing is rounded and the
// result is flagged as an ESTIMATE.
import { ZERO, ONE, abs, add, cmp, div, floorToStep, fraction, max, min, mul, pctOf, ratioPct, sub, sum } from './money.ts';
import type { Dec } from './money.ts';
import { unitEconomics } from './entryZone.ts';
import type { ContractSpec, CostConfig, PlusSettings, Side } from './types.ts';

export type PlanIssue =
  | 'BELOW_MIN_QTY'
  | 'BELOW_MIN_NOTIONAL'
  | 'ZERO_QTY'
  | 'LIQ_BEFORE_STOP'
  | 'LEVERAGE_ABOVE_CONTRACT_MAX'
  | 'MARGIN_CAP_REDUCED'
  | 'RISK_BUDGET_ENFORCED'
  | 'NO_STEPS'
  | 'CONTRACT_UNKNOWN_ESTIMATE'
  | 'LIQ_IS_ESTIMATE'
  | 'CROSS_MARGIN_LIQ_UNKNOWN'
  | 'GEOMETRY_INVALID';

/** Hard failures make the plan unusable; the rest are warnings. */
export const HARD_ISSUES: readonly PlanIssue[] = [
  'LIQ_BEFORE_STOP',
  'LEVERAGE_ABOVE_CONTRACT_MAX',
  'NO_STEPS',
  'GEOMETRY_INVALID',
];

export function riskBudget(s: Pick<PlusSettings, 'accountBalance' | 'riskPct' | 'maxRiskPerTrade'>): Dec {
  return min(pctOf(s.accountBalance, s.riskPct, 'floor'), s.maxRiskPerTrade);
}

export interface StepSize {
  entry: Dec;
  qty: Dec;
  notional: Dec;
  /** Initial margin (rounded UP so it is never understated). */
  margin: Dec;
  /** |entry - stop| * qty (price loss only). */
  grossLossAtStop: Dec;
  /** Entry + stop-exit fees. */
  fees: Dec;
  slippage: Dec;
  /** grossLossAtStop + fees + slippage — what is counted against the risk budget. */
  netRisk: Dec;
}

export function sizeAtRisk(entry: Dec, stop: Dec, qty: Dec, cost: CostConfig, leverage: Dec): StepSize {
  const f = fraction(cost.feePct);
  const s = fraction(cost.slippagePct);
  const priceSum = add(entry, stop);
  const notional = mul(qty, entry);
  const grossLossAtStop = mul(qty, abs(sub(entry, stop)));
  const fees = mul(qty, mul(priceSum, f));
  const slippage = mul(qty, mul(priceSum, s));
  return {
    entry,
    qty,
    notional,
    margin: div(notional, leverage, 'ceil'),
    grossLossAtStop,
    fees,
    slippage,
    netRisk: add(grossLossAtStop, add(fees, slippage)),
  };
}

/** Quantity whose NET risk (price loss + fees + slippage) does not exceed `share`, floored to stepSize. */
export function quantityForRisk(share: Dec, entry: Dec, stop: Dec, target: Dec, cost: CostConfig, contract: ContractSpec): Dec {
  const unit = unitEconomics(entry, stop, target, cost).netRiskPerUnit;
  if (unit <= ZERO || share <= ZERO) return ZERO;
  const raw = div(share, unit, 'floor');
  return contract.stepSize && contract.stepSize > ZERO ? floorToStep(raw, contract.stepSize) : raw;
}

export function violatesContract(qty: Dec, entry: Dec, contract: ContractSpec): PlanIssue | null {
  if (qty <= ZERO) return 'ZERO_QTY';
  if (contract.minQty !== null && qty < contract.minQty) return 'BELOW_MIN_QTY';
  if (contract.minNotional !== null && mul(qty, entry) < contract.minNotional) return 'BELOW_MIN_NOTIONAL';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Liquidation (ISOLATED, linear USDT-M) — an ESTIMATE, never a definitive price.
// ---------------------------------------------------------------------------------------------
export function estimateLiquidation(side: Side, avgEntry: Dec, leverage: Dec, mmrPct: Dec): Dec {
  const invL = div(ONE, leverage);
  const mmr = fraction(mmrPct);
  // long (BUY): entry * (1 - 1/L + mmr)   short (SELL): entry * (1 + 1/L - mmr)
  return side === 'BUY'
    ? mul(avgEntry, add(sub(ONE, invL), mmr))
    : mul(avgEntry, sub(add(ONE, invL), mmr));
}

export interface LiqCheck {
  liqPrice: Dec;
  stopDistancePct: Dec;
  liqDistancePct: Dec;
  /** true when the stop is reached BEFORE the (estimated, safety-margined) liquidation. */
  stopBeforeLiq: boolean;
}

export function checkLiquidation(
  side: Side,
  avgEntry: Dec,
  stop: Dec,
  s: Pick<PlusSettings, 'leverage' | 'assumedMmrPct' | 'liqSafetyFactor'>,
): LiqCheck {
  const liqPrice = estimateLiquidation(side, avgEntry, s.leverage, s.assumedMmrPct);
  const stopDistancePct = ratioPct(abs(sub(avgEntry, stop)), avgEntry);
  const liqDistancePct = ratioPct(abs(sub(avgEntry, liqPrice)), avgEntry);
  const liqOnWrongSide = side === 'BUY' ? liqPrice >= avgEntry : liqPrice <= avgEntry;
  const safeLiq = mul(liqDistancePct, s.liqSafetyFactor);
  return {
    liqPrice,
    stopDistancePct,
    liqDistancePct,
    stopBeforeLiq: !liqOnWrongSide && cmp(stopDistancePct, safeLiq) <= 0,
  };
}

/**
 * Highest integer leverage for which the stop is still reached before the estimated liquidation:
 *   stopDist <= factor * (1/L - mmr)   =>   L <= 1 / (stopDist/factor + mmr)
 * Capped by the contract's max leverage when known. The plan NEVER raises the leverage by itself.
 */
export function maxSafeLeverage(
  avgEntry: Dec,
  stop: Dec,
  s: Pick<PlusSettings, 'assumedMmrPct' | 'liqSafetyFactor'>,
  contract: ContractSpec,
): Dec {
  const stopFrac = div(abs(sub(avgEntry, stop)), avgEntry);
  const denom = add(div(stopFrac, s.liqSafetyFactor), fraction(s.assumedMmrPct));
  if (denom <= ZERO) return ZERO;
  let L = div(ONE, denom, 'floor');
  L = (L / ONE) * ONE; // whole leverage steps
  if (contract.maxLeverage !== null) L = min(L, contract.maxLeverage);
  return max(L, ZERO);
}

/** Weighted average entry of the given steps. */
export function averageEntry(steps: Pick<StepSize, 'entry' | 'qty'>[]): Dec {
  const q = sum(steps.map((x) => x.qty));
  if (q <= ZERO) return ZERO;
  return div(sum(steps.map((x) => mul(x.qty, x.entry))), q);
}

export interface Totals {
  qty: Dec;
  notional: Dec;
  margin: Dec;
  grossLossAtStop: Dec;
  fees: Dec;
  slippage: Dec;
  netRisk: Dec;
  avgEntry: Dec;
  /** margin / balance, % */
  marginUtilizationPct: Dec;
  /** balance - margin - entry fees (never negative) */
  availableBalance: Dec;
}

export function totalsOf(steps: StepSize[], settings: Pick<PlusSettings, 'accountBalance'>, cost: CostConfig): Totals {
  const margin = sum(steps.map((x) => x.margin));
  const notional = sum(steps.map((x) => x.notional));
  const entryFees = sum(steps.map((x) => mul(x.notional, fraction(cost.feePct))));
  const avail = sub(sub(settings.accountBalance, margin), entryFees);
  return {
    qty: sum(steps.map((x) => x.qty)),
    notional,
    margin,
    grossLossAtStop: sum(steps.map((x) => x.grossLossAtStop)),
    fees: sum(steps.map((x) => x.fees)),
    slippage: sum(steps.map((x) => x.slippage)),
    netRisk: sum(steps.map((x) => x.netRisk)),
    avgEntry: averageEntry(steps),
    marginUtilizationPct:
      settings.accountBalance > ZERO ? ratioPct(margin, settings.accountBalance) : ZERO,
    availableBalance: max(avail, ZERO),
  };
}

