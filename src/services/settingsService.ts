import { supabase } from './supabaseClient';

export interface UserSettings {
  user_id: string;
  language: 'fa' | 'en';
  theme: 'dark' | 'light';
  default_timeframe: string;
  signal_threshold_strong: number;
  signal_threshold_buy: number;
  signal_threshold_watch: number;
  risk_percent: number;
  min_risk_reward: number;
  asset_universe: string;
  default_watchlist_id: string | null;
}

export async function getSettings(): Promise<UserSettings | null> {
  try {
    const { data, error } = await supabase.from('user_settings').select('*').maybeSingle();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

export async function upsertSettings(settings: Partial<UserSettings>): Promise<UserSettings | null> {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert({ ...settings, updated_at: new Date().toISOString() })
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

export async function ensureSettings(): Promise<UserSettings | null> {
  const existing = await getSettings();
  if (existing) return existing;
  return upsertSettings({});
}
