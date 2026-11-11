// Reverse Signal Plus — orchestrator: turns ONE existing reverse signal into a complete, read-only analysis.
// Pure function. Inputs are the existing signal levels (never changed) + settings + candles up to `asOf`.
import type { Dec } from './money.ts';
import { analyzeEntryZone } from './entryZone.ts';
import type { EntryReason, EntryZoneResult } from './entryZone.ts';
import { planScaledEntries } from './scaledEntry.ts';
import type { ScaledPlan } from './scaledEntry.ts';
import { computeEntryQuality } from './quality.ts';
import type { QualityResult } from './quality.ts';
import type { ContractSpec, EntryStatus, PlusSettings, Side } from './types.ts';
import type { Candle } from '../engine.ts';

export interface PlanInput {
  side: Side;
  timeframe: string;
  /** existing reverse levels — READ ONLY */
  zoneLow: Dec | null;
  zoneHigh: Dec | null;
  refEntry: Dec;
  stop: Dec;
  target: Dec;
  /** last CLOSED candle close price known at `asOf` */
  currentPrice: Dec;
  candles: Candle[];
  asOfCloseTime: number;
  ageBars: number;
  expiryBars: number;
  stopTouched?: boolean;
  targetTouched?: boolean;
  settings: PlusSettings;
  contract: ContractSpec;
  /** the pair is USDT-quoted AND (for a short) has a USDT perpetual */
  futuresAvailable: boolean;
}

export type FinalReason = EntryReason | 'LOW_QUALITY' | 'QUALITY_INSUFFICIENT' | 'LIQ_BEFORE_STOP' | 'NO_FUTURES_CONTRACT' | 'PLAN_NOT_POSSIBLE';

export interface PlusAnalysis {
  entry: EntryZoneResult;
  quality: QualityResult;
  plan: ScaledPlan | null;
  /** entry-timing status (WAITING / APPROACHING / READY / EXPIRED). Informational findings live in `reasons`, never in the status. */
  status: EntryStatus;
  reasons: FinalReason[];
}

export function buildPlusAnalysis(input: PlanInput): PlusAnalysis {
  const { settings } = input;
  const cost = { feePct: settings.feePct, slippagePct: settings.slippagePct };
  const entry = analyzeEntryZone({
    side: input.side,
    zoneLow: input.zoneLow,
    zoneHigh: input.zoneHigh,
    refEntry: input.refEntry,
    stop: input.stop,
    target: input.target,
    currentPrice: input.currentPrice,
    cost,
    minRr: settings.minRr,
    approachPct: settings.approachPct,
    ageBars: input.ageBars,
    expiryBars: input.expiryBars,
    stopTouched: input.stopTouched,
    targetTouched: input.targetTouched,
  });

  const quality = computeEntryQuality({
    candles: input.candles,
    asOfCloseTime: input.asOfCloseTime,
    timeframe: input.timeframe,
    side: input.side,
    recommendedEntry: entry.recommendedEntry === null ? null : Number(entry.recommendedEntry) / 1e18,
    stop: Number(input.stop) / 1e18,
    target: Number(input.target) / 1e18,
  });

  // The entry-timing status comes from the zone analysis ONLY. Plan / quality / liquidation / contract findings are
  // appended as informational `reasons` for developers and neutral UI numbers; they never reject or hide a signal.
  const status: EntryStatus = entry.status;
  const reasons: FinalReason[] = [...entry.reasons];

  let plan: ScaledPlan | null = null;
  if (entry.recommendedEntry !== null) {
    // The server-side reference plan is only built for candidates that meet the reference minimum RR (unchanged);
    // the UI recalculates margin / notional / liquidation locally for any signal, so nothing is hidden when there is none.
    const validPrices = entry.candidates.filter((c) => c.valid).map((c) => c.price);
    if (!input.futuresAvailable) {
      reasons.push('NO_FUTURES_CONTRACT');
    } else if (validPrices.length) {
      plan = planScaledEntries({
        side: input.side,
        validPrices,
        currentPrice: input.currentPrice,
        stop: input.stop,
        target: input.target,
        settings,
        contract: input.contract,
      });
      if (!plan.ok) reasons.push(plan.issues.includes('LIQ_BEFORE_STOP') ? 'LIQ_BEFORE_STOP' : 'PLAN_NOT_POSSIBLE');
    }
  }

  if (quality.grade === 'INSUFFICIENT_DATA') reasons.push('QUALITY_INSUFFICIENT');
  else if (quality.grade === 'NO_ENTRY') reasons.push('LOW_QUALITY');
  return { entry, quality, plan, status, reasons };
}
