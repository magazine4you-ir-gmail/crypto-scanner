import { supabase } from './supabaseClient';

/** Timeframes the server accepts for manual tracking. */
export const TRACKABLE_TIMEFRAMES = ['15m', '30m', '1h', '4h', '1d'];

export type TrackResult =
  | { ok: true; already: boolean; signalType: 'BUY' | 'SELL'; score: number }
  | { ok: false; reason: TrackFailure; limit?: number; signalType?: string };

export type TrackFailure =
  | 'unauthorized'
  | 'not_actionable'
  | 'limit_open'
  | 'limit_day'
  | 'data_not_ready'
  | 'unknown_symbol'
  | 'network'
  | 'server_error';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Asks the server to track a signal. Only { symbol, timeframe } is sent: the server recomputes the
 * analysis on the latest closed candle, so entry/stop/target cannot be forged from the browser.
 */
export async function trackSignal(symbol: string, timeframe: string): Promise<TrackResult> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token || !SUPABASE_URL || !ANON_KEY) return { ok: false, reason: 'unauthorized' };

    const res = await fetch(`${SUPABASE_URL}/functions/v1/track-signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
      body: JSON.stringify({ symbol, timeframe }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      already?: boolean;
      reason?: TrackFailure;
      limit?: number;
      signal_type?: string;
      score?: number;
    } | null;

    if (!body) return { ok: false, reason: 'server_error' };
    if (body.ok) {
      return { ok: true, already: Boolean(body.already), signalType: (body.signal_type as 'BUY' | 'SELL') ?? 'BUY', score: body.score ?? 0 };
    }
    return { ok: false, reason: body.reason ?? 'server_error', limit: body.limit, signalType: body.signal_type };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
