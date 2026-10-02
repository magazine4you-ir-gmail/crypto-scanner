import { supabase } from './supabaseClient';

export interface JournalEntry {
  id: string;
  asset: string;
  side: 'BUY' | 'SELL';
  entry_price: number;
  exit_price: number | null;
  size: number;
  result: 'OPEN' | 'WIN' | 'LOSS' | 'BREAKEVEN';
  strategy: string | null;
  notes: string | null;
  trade_date: string;
  created_at: string;
}

export async function getJournalEntries(): Promise<JournalEntry[]> {
  try {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .order('trade_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function addJournalEntry(entry: Omit<JournalEntry, 'id' | 'created_at'>): Promise<void> {
  try {
    const { error } = await supabase.from('journal_entries').insert(entry);
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function updateJournalEntry(id: string, updates: Partial<JournalEntry>): Promise<void> {
  try {
    const { error } = await supabase.from('journal_entries').update(updates).eq('id', id);
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function deleteJournalEntry(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('journal_entries').delete().eq('id', id);
    if (error) throw error;
  } catch {
    // ignore
  }
}
