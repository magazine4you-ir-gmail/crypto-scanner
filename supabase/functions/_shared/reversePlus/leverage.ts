// Reverse Signal Plus — leverage scenarios and the money side of a (backtested) signal.
//
// Principles (from the product spec):
//  * Changing the leverage NEVER changes entry / TP / SL: only margin, liquidation price, safety and ROI change.
//  * Margin, Notional, Risk Amount, Gross PnL, Net PnL and ROI-on-margin are always separate numbers.
//  * Two sizing modes that are never mixed:  FIXED_NOTIONAL (margin = notional / L)  and  FIXED_RISK (qty from |entry-stop|).
//  * Costs are explicit assumptions (fee / slippage in %); funding is NOT modelled (flagged `fundingIncluded: false`).
//  * The liquidation price is an ESTIMATE (isolated margin, assumed maintenance margin rate).
import { D, ZERO, abs, add, div, fraction, mul, ratioPct, sub, type Dec } from './money.ts';
import { UNKNOWN_CONTRACT, type CostConfig, type Side } from './types.ts';
import { checkLiquidation, estimateLiquidation, maxSafeLeverage } from './positionCalc.ts';
import { unitEconomics } from './entryZone.ts';
import type { BacktestResult } from './backtest.ts';

export const DEFAULT_LEVERAGES = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100] as const;
export const COMPARE_LEVERAGES = [5, 10, 20, 30, 50] as const;

export type SizingMode = 'FIXED_NOTIONAL' | 'FIXED_RISK';

export interface ScenarioParams {
  side: Side;
  entry: Dec;
  stop: Dec;
  target: Dec;
  leverage: Dec;
  mode: SizingMode;
  /** FIXED_NOTIONAL: position notional in USDT. FIXED_RISK: risk amount in USDT (loss at the stop, costs included). */
  amount: Dec;
  cost: CostConfig;
  assumedMmrPct: Dec;
  liqSafetyFactor: Dec;
  /** optional account balance: margin above it makes the scenario invalid */
  accountBalance?: Dec | null;
  /** exchange cap when known (public exchangeInfo has none) */
  maxLeverage?: Dec | null;
}

export type ScenarioIssue = 'LIQ_BEFORE_STOP' | 'MARGIN_EXCEEDS_BALANCE' | 'LEVERAGE_ABOVE_EXCHANGE_MAX' | 'BAD_GEOMETRY' | 'BAD_SIZE';

export interface Scenario {
  valid: boolean;
  issues: ScenarioIssue[];
  qty: Dec;
  notional: Dec;
  margin: Dec;
  riskAmount: Dec;          // loss if the stop is hit (costs included)
  liqPrice: Dec;
  liqDistancePct: Dec;
  stopDistancePct: Dec;
  /** liquidation distance / stop distance: >1 means the stop comes first; shown as "safety" */
  liqSafetyRatio: Dec;
  stopBeforeLiq: boolean;
  maxSafeLeverage: Dec;
  /** net PnL / ROI if the target is hit, and if the stop is hit */
  netAtTarget: Dec;
  netAtStop: Dec;
  roiAtTargetPct: Dec;
  roiAtStopPct: Dec;
  rrNet: Dec;
  fundingIncluded: false;
}

export function buildScenario(p: ScenarioParams): Scenario {
  const issues: ScenarioIssue[] = [];
  const geomOk = p.side === 'SELL' ? p.target < p.entry && p.entry < p.stop : p.stop < p.entry && p.entry < p.target;
  if (!geomOk) issues.push('BAD_GEOMETRY');
  const ue = unitEconomics(p.entry, p.stop, p.target, p.cost);
  let qty = ZERO;
  if (p.amount > ZERO && p.entry > ZERO) {
    qty = p.mode === 'FIXED_NOTIONAL' ? div(p.amount, p.entry) : ue.netRiskPerUnit > ZERO ? div(p.amount, ue.netRiskPerUnit) : ZERO;
  }
  if (qty <= ZERO) issues.push('BAD_SIZE');
  const notional = mul(qty, p.entry);
  const margin = p.leverage > ZERO ? div(notional, p.leverage, 'ceil') : ZERO;
  const liq = checkLiquidation(p.side, p.entry, p.stop, { leverage: p.leverage, assumedMmrPct: p.assumedMmrPct, liqSafetyFactor: p.liqSafetyFactor });
  if (!liq.stopBeforeLiq) issues.push('LIQ_BEFORE_STOP');
  if (p.accountBalance && margin > p.accountBalance) issues.push('MARGIN_EXCEEDS_BALANCE');
  if (p.maxLeverage && p.leverage > p.maxLeverage) issues.push('LEVERAGE_ABOVE_EXCHANGE_MAX');
  const netAtTarget = mul(qty, ue.netRewardPerUnit);
  const netAtStop = -mul(qty, ue.netRiskPerUnit);
  const roi = (v: Dec) => (margin > ZERO ? ratioPct(v, margin) : ZERO);
  return {
    valid: issues.length === 0, issues, qty, notional, margin, riskAmount: mul(qty, ue.netRiskPerUnit),
    liqPrice: liq.liqPrice, liqDistancePct: liq.liqDistancePct, stopDistancePct: liq.stopDistancePct,
    liqSafetyRatio: liq.stopDistancePct > ZERO ? div(liq.liqDistancePct, liq.stopDistancePct) : ZERO,
    stopBeforeLiq: liq.stopBeforeLiq,
    maxSafeLeverage: maxSafeLeverage(p.entry, p.stop, { assumedMmrPct: p.assumedMmrPct, liqSafetyFactor: p.liqSafetyFactor }, UNKNOWN_CONTRACT),
    netAtTarget, netAtStop, roiAtTargetPct: roi(netAtTarget), roiAtStopPct: roi(netAtStop), rrNet: ue.rrNet,
    fundingIncluded: false,
  };
}

/** The same signal under several leverages, in ONE sizing mode (Fixed Notional or Fixed Risk). Entry/TP/SL never change. */
export function compareLeverages(base: Omit<ScenarioParams, 'leverage'>, leverages: readonly number[] = COMPARE_LEVERAGES): { leverage: number; scenario: Scenario }[] {
  return leverages.map((l) => ({ leverage: l, scenario: buildScenario({ ...base, leverage: D(l) }) }));
}

// ---------------------------------------------------------------------------------------------
// realised result of a backtested signal under one scenario
// ---------------------------------------------------------------------------------------------
export interface TradeMetrics {
  outcome: BacktestResult['outcome'];
  closed: boolean;            // WIN / LOSS (counts in win rate)
  liquidated: boolean;
  entryPrice: Dec | null;
  exitPrice: Dec | null;
  qty: Dec; notional: Dec; margin: Dec; leverage: Dec;
  riskAtStop: Dec;
  grossPnl: Dec | null; fees: Dec | null; slippage: Dec | null; netPnl: Dec | null;
  roiPct: Dec | null;
  rMultiple: Dec | null;
  holdingMs: number | null;
  /** MFE / MAE as % of entry and in R (R = distance to stop) */
  mfePct: Dec | null; maePct: Dec | null; mfeR: Dec | null; maeR: Dec | null;
  scenario: Scenario;
  exitTime: number | null;
  fundingIncluded: false;
}

export function applyScenarioToBacktest(bt: BacktestResult, p: ScenarioParams): TradeMetrics {
  const sc = buildScenario(p);
  const base: TradeMetrics = {
    outcome: bt.outcome, closed: false, liquidated: false, entryPrice: bt.entryPrice, exitPrice: bt.exitPrice,
    qty: sc.qty, notional: sc.notional, margin: sc.margin, leverage: p.leverage, riskAtStop: sc.riskAmount,
    grossPnl: null, fees: null, slippage: null, netPnl: null, roiPct: null, rMultiple: null,
    holdingMs: bt.entryTime !== null && bt.exitTime !== null ? bt.exitTime - bt.entryTime : null,
    mfePct: null, maePct: null, mfeR: null, maeR: null, scenario: sc,
    exitTime: bt.exitTime, fundingIncluded: false,
  };
  if (bt.entryPrice === null) return base;
  const entry = bt.entryPrice;
  const stopDist = abs(sub(entry, p.stop));
  const sideSign = (px: Dec) => (p.side === 'BUY' ? sub(px, entry) : sub(entry, px));
  if (bt.worstPrice !== null && stopDist > ZERO) {
    const adv = abs(sub(bt.worstPrice, entry));
    base.maePct = ratioPct(adv, entry); base.maeR = div(adv, stopDist);
  }
  if (bt.bestPrice !== null && stopDist > ZERO) {
    const fav = abs(sub(bt.bestPrice, entry));
    base.mfePct = ratioPct(fav, entry); base.mfeR = div(fav, stopDist);
  }
  if (bt.outcome !== 'WIN' && bt.outcome !== 'LOSS') return base;
  if (bt.exitPrice === null || sc.qty <= ZERO) return base;

  // liquidation: the adverse extreme before the exit reached the (estimated) liquidation price
  const liq = estimateLiquidation(p.side, entry, p.leverage, p.assumedMmrPct);
  const liquidated = bt.worstPrice !== null && (p.side === 'SELL' ? bt.worstPrice >= liq : bt.worstPrice <= liq);
  const f = fraction(p.cost.feePct);
  const s = fraction(p.cost.slippagePct);
  if (liquidated) {
    // isolated margin: the margin is lost. Exchange liquidation fees are NOT modelled (flagged by the UI).
    const net = -sc.margin;
    return { ...base, outcome: 'LOSS', closed: true, liquidated: true, exitPrice: liq, grossPnl: net, fees: ZERO, slippage: ZERO, netPnl: net,
      roiPct: D(-100), rMultiple: sc.riskAmount > ZERO ? div(net, sc.riskAmount) : null };
  }
  const gross = mul(sc.qty, sideSign(bt.exitPrice));
  const fees = add(mul(mul(sc.qty, entry), f), mul(mul(sc.qty, bt.exitPrice), f));
  // entry is a limit fill with slippage assumed (per the cost model); a stop exit is a market order (slippage); a target is a limit (none)
  const slip = add(mul(mul(sc.qty, entry), s), bt.exitReason === 'STOP' ? mul(mul(sc.qty, bt.exitPrice), s) : ZERO);
  const net = sub(sub(gross, fees), slip);
  return { ...base, closed: true, grossPnl: gross, fees, slippage: slip, netPnl: net,
    roiPct: sc.margin > ZERO ? ratioPct(net, sc.margin) : null, rMultiple: sc.riskAmount > ZERO ? div(net, sc.riskAmount) : null };
}


