import type { Candle } from '@/types/market';
import type { SwingPoint, SupportResistanceLevel } from '@/types/signal';

export function findSupportResistance(
  candles: Candle[],
  swings: SwingPoint[],
): SupportResistanceLevel[] {
  if (swings.length === 0) return [];

  const levels: SupportResistanceLevel[] = [];
  const tolerance = 0.02;

  for (const swing of swings) {
    let merged = false;
    for (const level of levels) {
      const swingType = swing.type === 'HIGH' ? 'RESISTANCE' : 'SUPPORT';
      if (
        level.type === swingType &&
        Math.abs(level.price - swing.price) / level.price < tolerance
      ) {
        level.touches += 1;
        level.strength = level.touches;
        level.price = (level.price + swing.price) / 2;
        merged = true;
        break;
      }
    }
    if (!merged) {
      levels.push({
        price: swing.price,
        type: swing.type === 'HIGH' ? 'RESISTANCE' : 'SUPPORT',
        strength: 1,
        touches: 1,
      });
    }
  }

  return levels.sort((a, b) => b.strength - a.strength);
}

export function nearestResistance(
  levels: SupportResistanceLevel[],
  currentPrice: number,
): number | null {
  const resistances = levels
    .filter((l) => l.type === 'RESISTANCE' && l.price > currentPrice)
    .sort((a, b) => a.price - b.price);
  return resistances.length > 0 ? resistances[0].price : null;
}

export function nearestSupport(
  levels: SupportResistanceLevel[],
  currentPrice: number,
): number | null {
  const supports = levels
    .filter((l) => l.type === 'SUPPORT' && l.price < currentPrice)
    .sort((a, b) => b.price - a.price);
  return supports.length > 0 ? supports[0].price : null;
}
