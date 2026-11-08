import { D } from '../../../supabase/functions/_shared/reversePlus/money';
import type { ContractSpec, PlusSettings } from '../../../supabase/functions/_shared/reversePlus/types';

export const settings: PlusSettings = {
  accountBalance: D(100), riskPct: D(1), maxRiskPerTrade: D(1), leverage: D(50), marginMode: 'ISOLATED',
  feePct: D('0.05'), slippagePct: D('0.02'), maxEntries: 3, maxMarginPct: D(50), minRr: D('0.5'),
  assumedMmrPct: D('0.5'), liqSafetyFactor: D('0.8'), approachPct: D('0.5'),
};
export const cost = { feePct: settings.feePct, slippagePct: settings.slippagePct };
export const contract: ContractSpec = {
  tickSize: D('0.1'), stepSize: D('0.001'), minQty: D('0.001'), minNotional: D(5), maxLeverage: D(75), known: true,
};

