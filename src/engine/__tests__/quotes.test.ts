import { describe, it, expect } from 'vitest';
import {
  analyzeCore,
  baseOf,
  counterpartSymbol,
  normalizeSymbol,
  priceDecimals,
  quoteOf,
  splitSymbol,
  type Candle,
} from '@engine';
import { classify, computeConfluence, confluenceFor, isDualSignal, type Leg } from '@/engine/confluence';
import { pickScanTargets } from '@/engine/scanTargets';
import { formatPrice } from '@/i18n/format';

describe('symbols and quote assets', () => {
  it('splits USDT and BTC pairs', () => {
    expect(splitSymbol('ETHUSDT')).toEqual({ base: 'ETH', quote: 'USDT' });
    expect(splitSymbol('ETHBTC')).toEqual({ base: 'ETH', quote: 'BTC' });
    expect(splitSymbol('solbtc')).toEqual({ base: 'SOL', quote: 'BTC' });
    expect(splitSymbol('BTCUSDT')).toEqual({ base: 'BTC', quote: 'USDT' });
    expect(splitSymbol('USDT')).toBeNull();
    expect(splitSymbol('BTC')).toBeNull();
  });

  it('does not mistake wrapped-BTC tickers for BTC pairs', () => {
    expect(splitSymbol('WBTC')).toBeNull();
    expect(normalizeSymbol('wbtc')).toBe('WBTCUSDT');
    expect(normalizeSymbol('WBTCBTC')).toBe('WBTCBTC');
    expect(splitSymbol('WBTCBTC')).toEqual({ base: 'WBTC', quote: 'BTC' });
  });

  it('normalises user input', () => {
    expect(normalizeSymbol('eth')).toBe('ETHUSDT');
    expect(normalizeSymbol('BTC')).toBe('BTCUSDT');
    expect(normalizeSymbol('ethbtc')).toBe('ETHBTC');
    expect(normalizeSymbol('SOLUSDT')).toBe('SOLUSDT');
    expect(quoteOf('LINKBTC')).toBe('BTC');
    expect(quoteOf('LINKUSDT')).toBe('USDT');
    expect(baseOf('LINKBTC')).toBe('LINK');
  });

  it('finds the counterpart pair, and none for BTC itself', () => {
    expect(counterpartSymbol('ETHUSDT')).toBe('ETHBTC');
    expect(counterpartSymbol('ETHBTC')).toBe('ETHUSDT');
    expect(counterpartSymbol('BTCUSDT')).toBeNull();
  });

  it('shows enough decimals for BTC-scale prices', () => {
    expect(priceDecimals(0.0000021)).toBe(8);
    expect(priceDecimals(0.0312)).toBe(6);
    expect(priceDecimals(2.5)).toBe(4);
    expect(priceDecimals(64000)).toBe(2);
    expect(formatPrice(0.0000021, 'en')).toContain('0.00000210');
    expect(formatPrice(0.0312, 'en')).toContain('0.031200');
  });
});

describe('cross-quote confluence', () => {
  const leg = (symbol: string, signalType: string, score = 70): Leg => ({ symbol, quote: quoteOf(symbol), signalType: signalType as Leg['signalType'], score });

  it('classifies every combination', () => {
    expect(classify(leg('ETHUSDT', 'BUY'), leg('ETHBTC', 'BUY'))).toBe('STRONG_BUY');
    expect(classify(leg('ETHUSDT', 'SELL'), leg('ETHBTC', 'SELL'))).toBe('STRONG_SELL');
    expect(classify(leg('ETHUSDT', 'BUY'), leg('ETHBTC', 'SELL'))).toBe('LAGGING_BUY');
    expect(classify(leg('ETHUSDT', 'SELL'), leg('ETHBTC', 'BUY'))).toBe('RELATIVE_STRENGTH');
    expect(classify(leg('ETHUSDT', 'BUY'), leg('ETHBTC', 'WAIT'))).toBe('USDT_ONLY');
    expect(classify(leg('ETHUSDT', 'NO_TRADE'), leg('ETHBTC', 'BUY'))).toBe('BTC_ONLY');
    expect(classify(leg('ETHUSDT', 'BUY'), null)).toBe('USDT_ONLY');
    expect(classify(leg('ETHUSDT', 'WAIT'), leg('ETHBTC', 'WAIT'))).toBe('NONE');
    expect(classify(null, null)).toBe('NONE');
  });

  it('groups by coin and timeframe, never mixing timeframes or coins', () => {
    const map = computeConfluence([
      { symbol: 'ETHUSDT', timeframe: '1h', signalType: 'BUY', score: 78 },
      { symbol: 'ETHBTC', timeframe: '1h', signalType: 'BUY', score: 74 },
      { symbol: 'ETHUSDT', timeframe: '4h', signalType: 'BUY', score: 80 },
      { symbol: 'ETHBTC', timeframe: '4h', signalType: 'SELL', score: 66 },
      { symbol: 'SOLUSDT', timeframe: '1h', signalType: 'BUY', score: 71 },
      { symbol: 'BTCUSDT', timeframe: '1h', signalType: 'SELL', score: 60 },
    ]);
    const eth1h = confluenceFor(map, 'ETHBTC', '1h')!; // looked up through EITHER leg
    expect(eth1h.kind).toBe('STRONG_BUY');
    expect(eth1h.aligned).toBe(true);
    expect(eth1h.combinedScore).toBe(83); // best leg 78 + alignment bonus 5
    expect(confluenceFor(map, 'ETHUSDT', '1h')).toBe(eth1h);
    expect(confluenceFor(map, 'ETHUSDT', '4h')!.kind).toBe('LAGGING_BUY');
    expect(isDualSignal(confluenceFor(map, 'ETHUSDT', '4h'))).toBe(true);
    expect(confluenceFor(map, 'SOLUSDT', '1h')!.kind).toBe('USDT_ONLY');
    expect(isDualSignal(confluenceFor(map, 'SOLUSDT', '1h'))).toBe(false);
    expect(confluenceFor(map, 'BTCUSDT', '1h')!.btc).toBeNull(); // BTC has no BTC pair
    expect(confluenceFor(map, 'DOGEUSDT', '1h')).toBeNull();
  });

  it('caps the combined score at 100', () => {
    const map = computeConfluence([
      { symbol: 'ADAUSDT', timeframe: '1d', signalType: 'BUY', score: 98 },
      { symbol: 'ADABTC', timeframe: '1d', signalType: 'BUY', score: 97 },
    ]);
    expect(confluenceFor(map, 'ADAUSDT', '1d')!.combinedScore).toBe(100);
  });
});

describe('scan target selection', () => {
  const markets = [
    { symbol: 'btc', market_cap_rank: 1 },
    { symbol: 'eth', market_cap_rank: 2 },
    { symbol: 'usdt', market_cap_rank: 3 },
    { symbol: 'sol', market_cap_rank: 5 },
    { symbol: 'wbtc', market_cap_rank: 9 },
    { symbol: 'xyz', market_cap_rank: 12 }, // USDT only
    { symbol: 'foo', market_cap_rank: 14 }, // BTC only
    { symbol: 'doge', market_cap_rank: 15 },
  ];
  const pair = (symbol: string, baseAsset: string, quoteAsset: string) => ({ symbol, baseAsset, quoteAsset });
  const pairs = [
    pair('BTCUSDT', 'BTC', 'USDT'), pair('ETHUSDT', 'ETH', 'USDT'), pair('ETHBTC', 'ETH', 'BTC'),
    pair('SOLUSDT', 'SOL', 'USDT'), pair('SOLBTC', 'SOL', 'BTC'), pair('WBTCUSDT', 'WBTC', 'USDT'),
    pair('XYZUSDT', 'XYZ', 'USDT'), pair('FOOBTC', 'FOO', 'BTC'), pair('DOGEUSDT', 'DOGE', 'USDT'), pair('DOGEBTC', 'DOGE', 'BTC'),
  ];

  it('USDT mode matches the old behaviour (no BTC pairs, no stablecoins or wrapped tokens)', () => {
    const t = pickScanTargets(markets, pairs, 10, 'USDT');
    expect(t.map((x) => x.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XYZUSDT', 'DOGEUSDT']);
  });

  it('BOTH mode yields USDT then BTC per coin; BTC has no BTC pair', () => {
    const t = pickScanTargets(markets, pairs, 10, 'BOTH');
    expect(t.map((x) => x.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'ETHBTC', 'SOLUSDT', 'SOLBTC', 'XYZUSDT', 'FOOBTC', 'DOGEUSDT', 'DOGEBTC']);
    expect(t.find((x) => x.symbol === 'ETHBTC')).toMatchObject({ base: 'ETH', quote: 'BTC', rank: 2 });
  });

  it('BTC mode skips coins without a BTC pair', () => {
    expect(pickScanTargets(markets, pairs, 10, 'BTC').map((x) => x.symbol)).toEqual(['ETHBTC', 'SOLBTC', 'FOOBTC', 'DOGEBTC']);
  });

  it('counts coins, not pairs, towards the universe size', () => {
    const t = pickScanTargets(markets, pairs, 2, 'BOTH');
    expect(t.map((x) => x.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'ETHBTC']);
  });
});

describe('engine is scale-free (BTC-quoted prices work exactly like USDT prices)', () => {
  /** Uptrend with pullbacks, deterministic. */
  function series(scale: number): Candle[] {
    const out: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 320; i++) {
      const drift = 0.35 + 1.6 * Math.sin(i / 6) + 0.5 * Math.sin(i / 2.1);
      const o = p;
      const c = Math.max(5, o + drift);
      const h = Math.max(o, c) + 0.6 + ((i * 7) % 5) * 0.1;
      const l = Math.min(o, c) - 0.6 - ((i * 3) % 5) * 0.1;
      const t = 1_700_000_000_000 + i * 3_600_000;
      out.push({ openTime: t, open: o * scale, high: h * scale, low: l * scale, close: c * scale, volume: 1000 + (i % 7) * 120, closeTime: t + 3_599_999 });
      p = c;
    }
    return out;
  }

  it('gives the same signal, score and (scaled) risk plan at 1e-6 price scale', () => {
    const usd = analyzeCore(series(1), { timeframe: '1h' })!;
    const btc = analyzeCore(series(1e-6), { timeframe: '1h' })!;
    expect(btc.signalType).toBe(usd.signalType);
    expect(btc.score).toBe(usd.score);
    expect(btc.bullScore).toBe(usd.bullScore);
    expect(btc.regime).toBe(usd.regime);
    if (usd.risk && btc.risk) {
      expect(btc.risk.stopLoss / 1e-6).toBeCloseTo(usd.risk.stopLoss, 4);
      expect(btc.risk.target1 / 1e-6).toBeCloseTo(usd.risk.target1, 4);
      expect(btc.risk.riskReward).toBeCloseTo(usd.risk.riskReward, 6);
    }
  });
});
