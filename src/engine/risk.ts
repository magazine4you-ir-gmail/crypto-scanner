import type { Candle } from '@/types/market';
import type { SupportResistanceLevel, RiskPlan, RiskLevel } from '@/types/signal';
import { nearestSupport, nearestResistance } from './supportResistance';

export interface RiskConfig {
  minRiskReward: number;
  riskPercent: number;
  capital: number;
  atrMultiplier: number;
}

export function computeRiskPlan(
  candles: Candle[],
  levels: SupportResistanceLevel[],
  atrValue: number | null,
  config: RiskConfig,
): RiskPlan | null {
  if (candles.length === 0 || atrValue === null || atrValue <= 0) return null;

  const lastClose = candles[candles.length - 1].close;
  const support = nearestSupport(levels, lastClose);
  const resistance = nearestResistance(levels, lastClose);

  const stopDistance = atrValue * config.atrMultiplier;
  const entryLow = lastClose;
  const entryHigh = lastClose + atrValue * 0.3;

  const invalidation = lastClose - stopDistance;
  const stopLoss = invalidation;

  if (support !== null && support < invalidation) {
    // Support below invalidation — tighten stop to support
  }

  const riskPerUnit = lastClose - stopLoss;
  if (riskPerUnit <= 0) return null;

  const target1 = lastClose + riskPerUnit * 2;
  const target2 = lastClose + riskPerUnit * 3;
  const target3 = lastClose + riskPerUnit * 5;

  const riskReward = (target1 - lastClose) / riskPerUnit;

  const riskAmount = config.capital * (config.riskPercent / 100);
  const positionSize = riskAmount / riskPerUnit;

  let riskLevel: RiskLevel;
  const atrPct = (atrValue / lastClose) * 100;
  if (atrPct < 2) riskLevel = 'LOW';
  else if (atrPct < 4) riskLevel = 'MEDIUM';
  else riskLevel = 'HIGH';

  return {
    entryLow,
    entryHigh,
    invalidation,
    stopLoss,
    target1,
    target2,
    target3,
    riskReward,
    riskLevel,
    positionSize,
  };
}

export function isResistanceTooClose(
  levels: SupportResistanceLevel[],
  currentPrice: number,
  threshold = 0.02,
): boolean {
  const resistance = nearestResistance(levels, currentPrice);
  if (resistance === null) return false;
  const distPct = (resistance - currentPrice) / currentPrice;
  return distPct > 0 && distPct < threshold;
}
