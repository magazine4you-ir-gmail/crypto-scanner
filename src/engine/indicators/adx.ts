import type { Candle } from '@/types/market';

export function adx(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period * 2) return result;

  const plusDm: number[] = [0];
  const minusDm: number[] = [0];
  const tr: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const highLow = candles[i].high - candles[i].low;
    const highPrevClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowPrevClose = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }

  const smoothedTr = wilderSmooth(tr, period);
  const smoothedPlusDm = wilderSmooth(plusDm, period);
  const smoothedMinusDm = wilderSmooth(minusDm, period);

  const dx: (number | null)[] = candles.map((_, i) => {
    const t = smoothedTr[i];
    const pDm = smoothedPlusDm[i];
    const mDm = smoothedMinusDm[i];
    if (t === null || pDm === null || mDm === null || t === 0) return null;
    const plusDi = (pDm / t) * 100;
    const minusDi = (mDm / t) * 100;
    const diSum = plusDi + minusDi;
    return diSum === 0 ? 0 : (Math.abs(plusDi - minusDi) / diSum) * 100;
  });

  const dxValues = dx.filter((v): v is number => v !== null);
  const firstValidIndex = dx.findIndex((v) => v !== null);
  if (firstValidIndex < 0 || dxValues.length <= period) return result;

  const adxSeed = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[firstValidIndex + period - 1] = adxSeed;
  let prevAdx = adxSeed;

  for (let i = period; i < dxValues.length; i++) {
    prevAdx = (prevAdx * (period - 1) + dxValues[i]) / period;
    result[firstValidIndex + i] = prevAdx;
  }

  return result;
}

function wilderSmooth(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum;

  for (let i = period; i < values.length; i++) {
    const prev = result[i - 1] as number;
    result[i] = prev - prev / period + values[i];
  }

  return result;
}
