// Reverse Plus — ONE pure summary of a reverse signal, used by the list card AND the detail page so both always agree.
// Inputs: the reverse signal row (reverse_signal_outcomes), the optional central evaluation (enrichment only), the public
// reference costs and the LOCAL scenario (leverage / sizing / amount). Nothing here can hide or reject a signal.
import type { ReverseOutcome } from '@/services/reverseOutcomeService';
import type { PlusEvaluation, PlusPublicConfig } from '@/services/reversePlusService';
import {
  D, buildScenario, toNumber, unitEconomics,
  type Scenario, type ScenarioParams,
} from '../../supabase/functions/_shared/reversePlus/index';
import { amountOf, type ScenarioPrefs } from './scenarioPrefs';

export type ReverseStatus = ReverseOutcome['status'];

export interface SignalSummary {
  status: ReverseStatus;
  side: 'BUY' | 'SELL';
  /** open: last known market price; closed: the exit price of the reverse trade */
  priceLabel: 'CURRENT' | 'EXIT';
  price: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  entry: number;
  stop: number;
  target: number;
  rrNet: number | null;
  rrGross: number | null;
  distancePct: number | null;
  riskUsd: number | null;
  notional: number | null;
  margin: number | null;
  leverage: number;
  liq: number | null;
  maxSafeLeverage: number | null;
  /** 0..100, rounded; null when the score could not be computed */
  qualityPct: number | null;
  scenario: Scenario | null;
}

type CostCfg = Pick<PlusPublicConfig, 'fee_pct' | 'slippage_pct' | 'assumed_mmr_pct' | 'liq_safety_factor'>;

/** Entry used everywhere: the stored recommended entry, else the signal's own price (never an invented level). */
export function entryOf(rev: ReverseOutcome, st: PlusEvaluation | null, backtestEntry?: number | null): number {
  return st?.recommended_entry ?? backtestEntry ?? Number(rev.price_at_signal);
}

export function scenarioParams(rev: ReverseOutcome, entry: number, cfg: CostCfg, prefs: ScenarioPrefs): ScenarioParams {
  const a = amountOf(prefs);
  return {
    side: rev.signal_type,
    entry: D(entry),
    stop: D(Number(rev.stop_loss)),
    target: D(Number(rev.target1)),
    leverage: D(prefs.leverage),
    mode: prefs.sizing,
    amount: D(Number.isFinite(a) && a > 0 ? a : 0),
    cost: { feePct: D(cfg.fee_pct), slippagePct: D(cfg.slippage_pct) },
    assumedMmrPct: D(cfg.assumed_mmr_pct),
    liqSafetyFactor: D(cfg.liq_safety_factor),
    // no account balance: the user's real balance is unknown here, so margin is never compared to a reference balance
    accountBalance: null,
  };
}

export function computeSignalSummary(args: {
  rev: ReverseOutcome;
  st: PlusEvaluation | null;
  live: PlusEvaluation | null;
  cfg: CostCfg;
  prefs: ScenarioPrefs;
  backtestEntry?: number | null;
}): SignalSummary {
  const { rev, st, live, cfg, prefs } = args;
  const entry = entryOf(rev, st, args.backtestEntry);
  const stop = Number(rev.stop_loss);
  const target = Number(rev.target1);
  const open = rev.status === 'OPEN';
  const price = open ? (live?.current_price ?? null) : (rev.exit_price ?? null);

  const params = scenarioParams(rev, entry, cfg, prefs);
  const sc = buildScenario(params);
  const geometryOk = !sc.issues.includes('BAD_GEOMETRY');
  const sized = geometryOk && !sc.issues.includes('BAD_SIZE');
  const ue = geometryOk ? unitEconomics(params.entry, params.stop, params.target, params.cost) : null;

  return {
    status: rev.status,
    side: rev.signal_type,
    priceLabel: open ? 'CURRENT' : 'EXIT',
    price,
    zoneLow: rev.entry_low ?? st?.zone_low ?? null,
    zoneHigh: rev.entry_high ?? st?.zone_high ?? null,
    entry, stop, target,
    rrNet: ue ? toNumber(ue.rrNet) : null,
    rrGross: ue ? toNumber(ue.rrGross) : null,
    distancePct: open && price ? (Math.abs(entry - price) / price) * 100 : null,
    riskUsd: sized ? toNumber(sc.riskAmount) : null,
    notional: sized ? toNumber(sc.notional) : null,
    margin: sized ? toNumber(sc.margin) : null,
    leverage: prefs.leverage,
    liq: geometryOk ? toNumber(sc.liqPrice) : null,
    maxSafeLeverage: geometryOk ? toNumber(sc.maxSafeLeverage) : null,
    qualityPct: st?.quality_score == null ? null : Math.round(st.quality_score),
    scenario: sc,
  };
}
