import type { Candle } from '@/types/market';

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return result;

  const trueRanges: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trueRanges.push(candles[i].high - candles[i].low);
      continue;
    }
    const highLow = candles[i].high - candles[i].low;
    const highPrevClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowPrevClose = Math.abs(candles[i].low - candles[i - 1].close);
    trueRanges.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += trueRanges[i];
  let prevAtr = sum / period;
  result[period - 1] = prevAtr;

  for (let i = period; i < candles.length; i++) {
    prevAtr = (prevAtr * (period - 1) + trueRanges[i]) / period;
    result[i] = prevAtr;
  }

  return result;
}
