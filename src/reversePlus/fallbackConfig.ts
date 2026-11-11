import type { PlusPublicConfig } from '@/services/reversePlusService';

/** Reference values used when the public config row cannot be read, so cards and the detail page always calculate. */
export const FALLBACK_PUBLIC_CONFIG: PlusPublicConfig = {
  public_since: '1970-01-01T00:00:00Z',
  assumed_mmr_pct: 0.5,
  liq_safety_factor: 0.8,
  approach_pct: 0.5,
  account_balance: 100,
  risk_pct: 1,
  max_risk_per_trade: 1,
  leverage: 50,
  fee_pct: 0.05,
  slippage_pct: 0.02,
  min_rr: 0.7,
};
