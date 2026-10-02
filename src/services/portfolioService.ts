import { supabase } from './supabaseClient';

export interface PortfolioHolding {
  id: string;
  symbol: string;
  quantity: number;
  avg_entry_price: number;
  created_at: string;
  updated_at: string;
}

export async function getHoldings(): Promise<PortfolioHolding[]> {
  try {
    const { data, error } = await supabase.from('portfolio_holdings').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function addHolding(symbol: string, quantity: number, avgEntryPrice: number): Promise<void> {
  try {
    const { error } = await supabase
      .from('portfolio_holdings')
      .insert({ symbol, quantity, avg_entry_price: avgEntryPrice });
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function updateHolding(id: string, updates: Partial<PortfolioHolding>): Promise<void> {
  try {
    const { error } = await supabase
      .from('portfolio_holdings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function deleteHolding(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('portfolio_holdings').delete().eq('id', id);
    if (error) throw error;
  } catch {
    // ignore
  }
}
