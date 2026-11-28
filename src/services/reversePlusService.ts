import { supabase } from './supabaseClient';
import { cachedRequest } from './requestCache';

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

const CONFIG_COLS = 'public_since, assumed_mmr_pct, liq_safety_factor, approach_pct, account_balance, risk_pct, max_risk_per_trade, leverage, fee_pct, slippage_pct, min_rr';
/** The reference config changes only when an admin edits it by hand: one read per 15 minutes is plenty (shared by every page). */
export const PUBLIC_CONFIG_TTL_MS = 15 * 60_000;

export async function fetchPublicConfig(opts: { force?: boolean } = {}): Promise<PlusPublicConfig | null> {
  return cachedRequest('rp:config', PUBLIC_CONFIG_TTL_MS, async () => {
    const { data, error } = await supabase.from('reverse_plus_public_config').select(CONFIG_COLS).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as PlusPublicConfig | null) ?? null;
  }, { force: opts.force });
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

/** Every PlusBacktest field, nothing else (the table also holds `assumptions` / `created_at`, which no screen reads). */
export const BACKTEST_COLS = 'id, reverse_outcome_id, symbol, timeframe, side, signal_at, signal_close_time, entry_level, stop_loss, take_profit, strategy_status, outcome, reason, entry_time, entry_price, exit_time, exit_price, exit_reason, bars_to_entry, bars_held, worst_price, best_price, candles_used, lower_tf_used, engine_version';

export async function fetchBacktestFor(reverseOutcomeId: string): Promise<PlusBacktest | null> {
  // a backtest row is written once and never changes; a missing row (not evaluated yet) is re-checked after a minute
  return cachedRequest(`rp:bt:${reverseOutcomeId}`, 60_000, async () => {
    const { data, error } = await supabase.from('reverse_plus_backtests').select(BACKTEST_COLS).eq('reverse_outcome_id', reverseOutcomeId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as PlusBacktest | null) ?? null;
  });
}

const EVAL_BASE_COLS = 'id, reverse_outcome_id, origin_outcome_id, symbol, timeframe, side, eval_kind, as_of_close_time, current_price, zone_low, zone_high, reverse_entry, stop_loss, take_profit, recommended_entry, entry_range_low, entry_range_high, distance_to_entry_pct, risk_distance, reward_distance, rr_gross, rr_net, rr_basis, min_rr_used, entry_status, quality_score, quality_grade, leverage, risk_amount, total_notional, total_margin, avg_entry, entries_count, max_safe_leverage, liq_estimate, contract_known, signal_at';
/** Signal detail page: every field. */
export const EVAL_FULL_COLS = `${EVAL_BASE_COLS}, status_reasons, quality_factors, plan, plan_issues`;
/** Lists: without the four large JSON columns (no list / card reads them). */
export const EVAL_LIST_COLS = EVAL_BASE_COLS;

/** Central SIGNAL_TIME + LIVE evaluations of one signal. */
export async function fetchEvaluationsFor(reverseOutcomeId: string, opts: { force?: boolean } = {}): Promise<{ signalTime: PlusEvaluation | null; live: PlusEvaluation | null }> {
  return cachedRequest(`rp:ev:${reverseOutcomeId}`, 15_000, async () => {
    const { data, error } = await supabase.from('reverse_plus_evaluations').select(EVAL_FULL_COLS).is('user_id', null).eq('owner_key', REVERSE_PLUS_CENTRAL_OWNER).eq('source', 'CENTRAL').eq('reverse_outcome_id', reverseOutcomeId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as PlusEvaluation[];
    return { signalTime: rows.find((r) => r.eval_kind === 'SIGNAL_TIME') ?? null, live: rows.find((r) => r.eval_kind === 'LIVE') ?? null };
  }, { force: opts.force });
}

/** Evaluations of a page of signals in ONE request (central rows only). Missing entries simply mean "not evaluated yet". */
export interface EvaluationPair { signalTime: PlusEvaluation | null; live: PlusEvaluation | null }

/** LIVE rows change at most when a candle closes; 30 s only collapses repeated mounts / tab switches / double effects. */
export const EVALUATIONS_TTL_MS = 30_000;

export async function fetchEvaluationsForIds(ids: string[], opts: { force?: boolean } = {}): Promise<Map<string, EvaluationPair>> {
  if (ids.length === 0) return new Map();
  const key = `rp:evs:${[...ids].sort().join(',')}`;
  return cachedRequest(key, EVALUATIONS_TTL_MS, async () => {
    const out = new Map<string, EvaluationPair>();
    const { data, error } = await supabase
      .from('reverse_plus_evaluations')
      .select(EVAL_LIST_COLS)
      .is('user_id', null)
      .eq('owner_key', REVERSE_PLUS_CENTRAL_OWNER)
      .eq('source', 'CENTRAL')
      .in('reverse_outcome_id', ids);
    if (error) throw new Error(error.message);
    for (const raw of (data ?? []) as unknown as PlusEvaluation[]) {
      // the large JSON columns are not fetched for lists; keep the declared shape with neutral values
      const r: PlusEvaluation = { ...raw, status_reasons: [], quality_factors: null, plan: null, plan_issues: [] };
      const cur = out.get(r.reverse_outcome_id) ?? { signalTime: null, live: null };
      if (r.eval_kind === 'SIGNAL_TIME') cur.signalTime = r;
      else cur.live = r;
      out.set(r.reverse_outcome_id, cur);
    }
    return out;
  }, { force: opts.force });
}

export { FALLBACK_PUBLIC_CONFIG } from '@/reversePlus/fallbackConfig';
