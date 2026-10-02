import { supabase } from './supabaseClient';

export interface Watchlist {
  id: string;
  name: string;
  created_at: string;
}

export interface WatchlistItem {
  id: string;
  watchlist_id: string;
  symbol: string;
  created_at: string;
}

export async function getWatchlists(): Promise<Watchlist[]> {
  try {
    const { data, error } = await supabase.from('watchlists').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function createWatchlist(name: string): Promise<Watchlist | null> {
  try {
    const { data, error } = await supabase.from('watchlists').insert({ name }).select().maybeSingle();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

export async function renameWatchlist(id: string, name: string): Promise<void> {
  try {
    const { error } = await supabase.from('watchlists').update({ name }).eq('id', id);
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function deleteWatchlist(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('watchlists').delete().eq('id', id);
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function getWatchlistItems(watchlistId: string): Promise<WatchlistItem[]> {
  try {
    const { data, error } = await supabase
      .from('watchlist_items')
      .select('*')
      .eq('watchlist_id', watchlistId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function addWatchlistItem(watchlistId: string, symbol: string): Promise<void> {
  try {
    const { error } = await supabase.from('watchlist_items').insert({ watchlist_id: watchlistId, symbol });
    if (error) throw error;
  } catch {
    // ignore
  }
}

export async function removeWatchlistItem(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('watchlist_items').delete().eq('id', id);
    if (error) throw error;
  } catch {
    // ignore
  }
}
