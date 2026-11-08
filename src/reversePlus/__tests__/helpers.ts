import type { Candle } from '@engine';

/** deterministic pseudo random generator (no flaky tests) */
export function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const H1 = 3_600_000;

export function mkCandle(i: number, open: number, high: number, low: number, close: number, volume = 1000, t0 = 1_700_000_000_000): Candle {
  const openTime = t0 + i * H1;
  return { openTime, closeTime: openTime + H1 - 1, open, high, low, close, volume };
}

/** `n` hourly candles: drift + noise, deterministic. */
export function series(n: number, opts: { start?: number; drift?: number; noise?: number; seed?: number; t0?: number } = {}): Candle[] {
  const rnd = lcg(opts.seed ?? 7);
  let price = opts.start ?? 100;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = price;
    const change = (opts.drift ?? 0) + ((rnd() - 0.5) * 2 * (opts.noise ?? 0.8)) / 100;
    const close = open * (1 + change);
    const high = Math.max(open, close) * (1 + rnd() * 0.004);
    const low = Math.min(open, close) * (1 - rnd() * 0.004);
    out.push(mkCandle(i, open, high, low, close, 800 + rnd() * 600, opts.t0));
    price = close;
  }
  return out;
}
