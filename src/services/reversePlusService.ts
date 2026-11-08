import { supabase } from './supabaseClient';

/**
 * Reverse Signal Plus client service. Reads its OWN tables only (reverse_plus_*); the only rows the browser can
 * write are the user's settings and their own ACTUAL trade records (RLS). Evaluations and PAPER trades are written
 * by the `reverse-plus-eval` Edge Function. Numeric columns arrive as JSON numbers: they are used for DISPLAY only —
 * every calculation of the module runs in fixed-point decimals (see supabase/functions/_shared/reversePlus/money.ts).
 */

export interface PlusSettingsRow {
  user_id: string;
  enabled: boolean;
  enabled_at: string | null;
  account_balance: number;
  risk_pct: number;
  max_risk_per_trade: number;
  leverage: number;
  margin_mode: 'ISOLATED' | 'CROSS';
  fee_pct: number;
  slippage_pct: number;
  max_entries: number;
  max_margin_pct: number;
  min_rr: number;
  assumed_mmr_pct: number;
  liq_safety_factor: number;
  approach_pct: number;
}

export const DEFAULT_PLUS_SETTINGS: Omit<PlusSettingsRow, 'user_id' | 'enabled_at'> = {
  enabled: false,
  account_balance: 100,
  risk_pct: 1,
  max_risk_per_trade: 1,
  leverage: 50,
  margin_mode: 'ISOLATED',
  fee_pct: 0.05,
  slippage_pct: 0.02,
  max_entries: 3,
  max_margin_pct: 50,
  min_rr: 0.7,
  assumed_mmr_pct: 0.5,
  liq_safety_factor: 0.8,
  approach_pct: 0.5,
};

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

export interface PlusEvaluation {
  id: string;
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
  signal_at: string | null;
}

export type PlusOutcome = 'PENDING' | 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED' | 'BREAKEVEN' | 'NO_FILL' | 'CANCELLED';

export interface PlusTrade {
  id: string;
  mode: 'PAPER' | 'ACTUAL';
  reverse_outcome_id: string;
  origin_outcome_id: string | null;
  symbol: string;
  timeframe: string;
  side: 'BUY' | 'SELL';
  quality_score: number | null;
  recommended_entry: number | null;
  stop_loss: number;
  take_profit: number;
  leverage: number | null;
  margin_used: number | null;
  entries_planned: number | null;
  entries_filled: number | null;
  qty_total: number | null;
  avg_entry: number | null;
  exit_price: number | null;
  exit_at: string | null;
  gross_pnl: number | null;
  fees: number | null;
  net_pnl: number | null;
  final_r: number | null;
  outcome: PlusOutcome;
  signal_at: string | null;
  notes: string | null;
}

export async function fetchPlusSettings(): Promise<PlusSettingsRow | null> {
  const { data, error } = await supabase.from('reverse_plus_settings').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PlusSettingsRow | null) ?? null;
}

export async function savePlusSettings(userId: string, patch: Partial<PlusSettingsRow>): Promise<PlusSettingsRow> {
  const { data, error } = await supabase
    .from('reverse_plus_settings')
    .upsert({ ...DEFAULT_PLUS_SETTINGS, ...patch, user_id: userId }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as PlusSettingsRow;
}

export async function fetchEvaluations(kind: 'LIVE' | 'SIGNAL_TIME' = 'LIVE', limit = 150): Promise<PlusEvaluation[]> {
  const { data, error } = await supabase
    .from('reverse_plus_evaluations')
    .select('*')
    .eq('eval_kind', kind)
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PlusEvaluation[];
}

export async function fetchPlusTrades(limit = 500): Promise<PlusTrade[]> {
  const { data, error } = await supabase
    .from('reverse_plus_trades')
    .select('*')
    .order('signal_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PlusTrade[];
}

export interface ActualTradeInput {
  user_id: string;
  reverse_outcome_id: string;
  origin_outcome_id: string | null;
  symbol: string;
  timeframe: string;
  side: 'BUY' | 'SELL';
  quality_score: number | null;
  recommended_entry: number | null;
  stop_loss: string;
  take_profit: string;
  leverage: string | null;
  margin_used: string | null;
  entries_filled: number;
  qty_total: string;
  avg_entry: string;
  fills: { price: string; qty: string }[];
  exit_price: string;
  exit_at: string;
  gross_pnl: string;
  fees: string;
  net_pnl: string;
  risk_at_stop: string | null;
  final_r: string | null;
  outcome: PlusOutcome;
  signal_at: string | null;
}

/** Numbers are sent as exact decimal strings (PostgREST casts them into `numeric`). */
export async function saveActualTrade(row: ActualTradeInput): Promise<void> {
  const { error } = await supabase
    .from('reverse_plus_trades')
    .upsert({ ...row, mode: 'ACTUAL', updated_at: new Date().toISOString() }, { onConflict: 'user_id,mode,reverse_outcome_id' });
  if (error) throw new Error(error.message);
}

export async function deleteActualTrade(id: string): Promise<void> {
  const { error } = await supabase.from('reverse_plus_trades').delete().eq('id', id).eq('mode', 'ACTUAL');
  if (error) throw new Error(error.message);
}
