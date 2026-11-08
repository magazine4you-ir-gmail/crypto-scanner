// Reverse Signal Plus — shared types. Money / price / quantity fields are `Dec` (see money.ts).
import type { Dec } from './money.ts';

/** Direction of the REVERSE trade (what Reverse Signal Plus would actually open). */
export type Side = 'BUY' | 'SELL';

export type EntryStatus = 'WAITING' | 'APPROACHING' | 'READY' | 'INVALID' | 'EXPIRED';
export type RrGrade = 'INVALID' | 'REVIEW' | 'FAVORABLE';
export type MarginMode = 'ISOLATED' | 'CROSS';

/** Per-side costs, in percent (0.05 = 0.05 %). */
export interface CostConfig {
  feePct: Dec;
  slippagePct: Dec;
}

/** Contract filters from Binance Futures exchangeInfo. All null when the data could not be fetched. */
export interface ContractSpec {
  tickSize: Dec | null;
  stepSize: Dec | null;
  minQty: Dec | null;
  minNotional: Dec | null;
  maxLeverage: Dec | null;
  /** true only when the filters come from the exchange. When false every size is an ESTIMATE. */
  known: boolean;
}

export const UNKNOWN_CONTRACT: ContractSpec = {
  tickSize: null,
  stepSize: null,
  minQty: null,
  minNotional: null,
  maxLeverage: null,
  known: false,
};

export interface PlusSettings {
  accountBalance: Dec;
  riskPct: Dec;
  maxRiskPerTrade: Dec;
  leverage: Dec;
  marginMode: MarginMode;
  feePct: Dec;
  slippagePct: Dec;
  maxEntries: number;
  maxMarginPct: Dec;
  minRr: Dec;
  /** Maintenance-margin rate ASSUMED for the liquidation estimate (real value depends on the exchange tier). */
  assumedMmrPct: Dec;
  /** Stop distance must be <= factor * liquidation distance. */
  liqSafetyFactor: Dec;
  /** "Approaching" when the price is within this % of the recommended entry. */
  approachPct: Dec;
}

export interface BilingualText {
  fa: string;
  en: string;
}
