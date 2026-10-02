import { supabase } from './supabaseClient';
import type { SignalResult } from '@/types/signal';

export interface SignalRecord {
  id: string;
  symbol: string;
  timeframe: string;
  signal_type: string;
  score: number;
  regime: string;
  trend: string;
  structure: string;
  risk_level: string;
  entry_low: number | null;
  entry_high: number | null;
  invalidation: number | null;
  stop_loss: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  risk_reward: number | null;
  price_at_signal: number;
  factors: any[];
  reasons: string[];
  explanation_fa: string;
  explanation_en: string;
  created_at: string;
}

export async function saveSignal(signal: SignalResult): Promise<void> {
  try {
    const { error } = await supabase.from('signals').insert({
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      signal_type: signal.signalType,
      score: signal.score,
      regime: signal.regime,
      trend: signal.trend,
      structure: signal.structure,
      risk_level: signal.riskLevel,
      entry_low: signal.risk?.entryLow ?? null,
      entry_high: signal.risk?.entryHigh ?? null,
      invalidation: signal.risk?.invalidation ?? null,
      stop_loss: signal.risk?.stopLoss ?? null,
      target1: signal.risk?.target1 ?? null,
      target2: signal.risk?.target2 ?? null,
      target3: signal.risk?.target3 ?? null,
      risk_reward: signal.risk?.riskReward ?? null,
      price_at_signal: signal.priceAtSignal,
      factors: signal.factors,
      reasons: signal.reasons,
      explanation_fa: signal.explanationFa,
      explanation_en: signal.explanationEn,
    });
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function getSignals(limit = 50, symbol?: string): Promise<SignalRecord[]> {
  try {
    let query = supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(limit);
    if (symbol) {
      query = query.eq('symbol', symbol);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function getSignalHistory(symbol: string, limit = 20): Promise<SignalRecord[]> {
  try {
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}
