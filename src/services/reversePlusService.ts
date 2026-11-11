import { supabase } from './supabaseClient';

/**
 * Reverse Signal Plus client service (read-only).
 *
 * The list of signals and their open / closed / profit / loss / expired state come from `reverse_signal_outcomes`
 * (see reverseOutcomeService). This service only reads the CENTRAL evaluation rows (`reverse_plus_evaluations`) as
 * enrichment (recommended entry, quality score, last known price) and the public reference config. It writes nothing:
 * there are no per-user server-side settings. Leverage / sizing choices live in the browser (see reversePlus/scenarioPrefs).
 */

export interface QualityFactorRow {
  key: string;
  max: number;
  earned: number;
  available: boolean;
  reason: { fa: string; en: string };
}

export interface PlanStepRow {
  order: number;
  entry: string;
  qty: string;
  notional: string;
  margin: string;
  netRisk: string;
}

export const REVERSE_PLUS_CENTRAL_OWNER = '8f7a2b6e-4c91-4d35-a8e2-6b1f9c3d7e50';

export interface PlusEvaluation {
  id: string;
  user_id?: string | null;
  owner_key?: string | null;
  reverse_outcome_id: string;
  origin_outcome_id: string | null;
  symbol: string;
  timeframe: string;
  side: 'BUY' | 'SELL';
  eval_kind: 'SIGNAL_TIME' | 'LIVE';
  as_of_close_time: string;
  current_price: number | null;
  zone_low: number | null;
  zone_high: number | null;
  reverse_entry: number | null;
  stop_loss: number;
  take_profit: number;
  recommended_entry: number | null;
  entry_range_low: number | null;
  entry_range_high: number | null;
  distance_to_entry_pct: number | null;
  risk_distance: number | null;
  reward_distance: number | null;
  rr_gross: number | null;
  rr_net: number | null;
  rr_basis: string;
  min_rr_used: number | null;
  /** 'INVALID' only exists on LEGACY stored rows; it is retired and must never be shown (see reversePlus/summary.ts). */
  entry_status: 'WAITING' | 'APPROACHING' | 'READY' | 'INVALID' | 'EXPIRED';
  status_reasons: string[];
  quality_score: number | null;
  quality_grade: string | null;
  quality_factors: QualityFactorRow[] | null;
  leverage: number | null;
  risk_amount: number | null;
  total_notional: number | null;
  total_margin: number | null;
  avg_entry: number | null;
  entries_count: number | null;
  max_safe_leverage: number | null;
  liq_estimate: number | null;
  plan: { steps?: PlanStepRow[]; issues?: string[]; estimated?: boolean } | null;
  plan_issues: string[];
  contract_known: boolean | null;
  source?: 'CENTRAL' | 'LEGACY_USER_COPY';
  signal_at: string | null;
}

/** Public reference configuration used by the central evaluator (read-only for users). */
export interface PlusPublicConfig {
  public_since: string;
  assumed_mmr_pct: number;
  liq_safety_factor: number;
  approach_pct: number;
  account_balance: number;
  risk_pct: number;
  max_risk_per_trade: number;
  leverage: number;
  fee_pct: number;
  slippage_pct: number;
  min_rr: number;
}

export async function fetchPublicConfig(): Promise<PlusPublicConfig | null> {
  const { data, error } = await supabase.from('reverse_plus_public_config').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PlusPublicConfig | null) ?? null;
}

/** Central historical backtest row (raw facts; leverage / PnL are derived in the browser by the pure engine). */
export interface PlusBacktest {
  id: string;
  reverse_outcome_id: string;
  symbol: string;
  timeframe: string;
  side: 'BUY' | 'SELL';
  signal_at: string | null;
  signal_close_time: string;
  entry_level: number;
  stop_loss: number;
  take_profit: number;
  strategy_status: string | null;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'NO_ENTRY' | 'EXPIRED' | 'AMBIGUOUS' | 'UNKNOWN';
  reason: string;
  entry_time: string | null;
  entry_price: number | null;
  exit_time: string | null;
  exit_price: number | null;
  exit_reason: 'TARGET' | 'STOP' | null;
  bars_to_entry: number | null;
  bars_held: number | null;
  worst_price: number | null;
  best_price: number | null;
  candles_used: number;
  lower_tf_used: boolean;
  engine_version: string;
}

export async function fetchBacktestFor(reverseOutcomeId: string): Promise<PlusBacktest | null> {
  const { data, error } = await supabase.from('reverse_plus_backtests').select('*').eq('reverse_outcome_id', reverseOutcomeId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PlusBacktest | null) ?? null;
}

/** Central SIGNAL_TIME + LIVE evaluations of one signal. */
export async function fetchEvaluationsFor(reverseOutcomeId: string): Promise<{ signalTime: PlusEvaluation | null; live: PlusEvaluation | null }> {
  const { data, error } = await supabase.from('reverse_plus_evaluations').select('*').is('user_id', null).eq('owner_key', REVERSE_PLUS_CENTRAL_OWNER).eq('source', 'CENTRAL').eq('reverse_outcome_id', reverseOutcomeId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PlusEvaluation[];
  return { signalTime: rows.find((r) => r.eval_kind === 'SIGNAL_TIME') ?? null, live: rows.find((r) => r.eval_kind === 'LIVE') ?? null };
}

/** Evaluations of a page of signals in ONE request (central rows only). Missing entries simply mean "not evaluated yet". */
export interface EvaluationPair { signalTime: PlusEvaluation | null; live: PlusEvaluation | null }

export async function fetchEvaluationsForIds(ids: string[]): Promise<Map<string, EvaluationPair>> {
  const out = new Map<string, EvaluationPair>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('reverse_plus_evaluations')
    .select('*')
    .is('user_id', null)
    .eq('owner_key', REVERSE_PLUS_CENTRAL_OWNER)
    .eq('source', 'CENTRAL')
    .in('reverse_outcome_id', ids);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as PlusEvaluation[]) {
    const cur = out.get(r.reverse_outcome_id) ?? { signalTime: null, live: null };
    if (r.eval_kind === 'SIGNAL_TIME') cur.signalTime = r;
    else cur.live = r;
    out.set(r.reverse_outcome_id, cur);
  }
  return out;
}

export { FALLBACK_PUBLIC_CONFIG } from '@/reversePlus/fallbackConfig';
