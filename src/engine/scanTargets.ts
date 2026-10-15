import type { QuoteAsset } from '@engine';
import type { SymbolInfo } from '@/types/market';

export const EXCLUDED_BASES = new Set([
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDE', 'USDS', 'PYUSD', 'USD1', 'USDD', 'GUSD',
  'FRAX', 'LUSD', 'EURC', 'EURI', 'AEUR', 'XUSD', 'RLUSD', 'BFUSD', 'USDG', 'USDY', 'SUSDE', 'USDT0', 'USTB',
  'WBTC', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'WBETH', 'BETH', 'CBBTC', 'CBETH', 'RETH', 'METH', 'EZETH',
  'RSETH', 'BNSOL', 'JITOSOL', 'MSOL', 'WBNB', 'BTCB', 'PAXG', 'XAUT',
]);

export type QuoteMode = 'USDT' | 'BTC' | 'BOTH';

export interface ScanTarget {
  symbol: string;
  base: string;
  quote: QuoteAsset;
  rank: number;
}

/**
 * Pure selection of what to scan: the top-`count` coins by market cap that trade in the requested quote
 * currency(ies). Stablecoins / wrapped tokens are removed, and BTC has no BTC pair. A coin that is listed
 * against both USDT and BTC yields two targets (USDT first), which is what makes cross-quote confluence possible.
 */
export function pickScanTargets(
  markets: { symbol: string; market_cap_rank: number | null }[],
  pairs: SymbolInfo[],
  count: number,
  mode: QuoteMode,
): ScanTarget[] {
  const tradable = new Set(pairs.map((p) => p.symbol));
  const out: ScanTarget[] = [];
  const seen = new Set<string>();
  let coins = 0;
  for (const m of markets) {
    const base = m.symbol.toUpperCase();
    if (EXCLUDED_BASES.has(base) || seen.has(base)) continue;
    const rank = m.market_cap_rank ?? coins + 1;
    const found: ScanTarget[] = [];
    if (mode !== 'BTC' && tradable.has(`${base}USDT`)) found.push({ symbol: `${base}USDT`, base, quote: 'USDT', rank });
    if (mode !== 'USDT' && base !== 'BTC' && tradable.has(`${base}BTC`)) found.push({ symbol: `${base}BTC`, base, quote: 'BTC', rank });
    if (found.length === 0) continue;
    seen.add(base);
    out.push(...found);
    if (++coins >= count) break;
  }
  return out;
}

