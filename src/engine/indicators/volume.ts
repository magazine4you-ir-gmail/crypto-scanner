import { sma } from './movingAverage';

export function volumeMovingAverage(volumes: number[], period = 20): (number | null)[] {
  return sma(volumes, period);
}

export function relativeVolume(volumes: number[], period = 20): (number | null)[] {
  const avg = sma(volumes, period);
  return volumes.map((v, i) => {
    const a = avg[i];
    return a !== null && a > 0 ? v / a : null;
  });
}
