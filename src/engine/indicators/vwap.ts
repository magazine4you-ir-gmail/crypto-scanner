import type { Candle } from '@/types/market';

export function vwap(candles: Candle[]): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  let cumulativePv = 0;
  let cumulativeVolume = 0;
  let currentDay = -1;

  for (let i = 0; i < candles.length; i++) {
    const day = Math.floor(candles[i].openTime / 86400000);
    if (day !== currentDay) {
      currentDay = day;
      cumulativePv = 0;
      cumulativeVolume = 0;
    }
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumulativePv += typicalPrice * candles[i].volume;
    cumulativeVolume += candles[i].volume;
    result[i] = cumulativeVolume > 0 ? cumulativePv / cumulativeVolume : null;
  }

  return result;
}
