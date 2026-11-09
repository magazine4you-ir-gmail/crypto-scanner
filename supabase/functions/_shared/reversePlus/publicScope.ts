// Reverse Signal Plus — public (central) scope helpers. Pure functions, shared by the Edge Function and the UI.
//
// Central rows have user_id === null. They are produced once per signal by the Edge Function with the reference
// configuration (reverse_plus_public_config) and are identical for every user. Per-user rows (legacy evaluations,
// legacy PAPER trades, the user's own ACTUAL trades) keep their owner's user_id.

export const PUBLIC_OWNER = "PUBLIC";

/** A signal issued BEFORE the central pipeline started is historical: SIGNAL_TIME snapshot only, never a PAPER trade. */
export function isHistoricalSignal(signalAt: string | null | undefined, publicSince: string | null | undefined): boolean {
  if (!signalAt || !publicSince) return false;
  const s = Date.parse(signalAt);
  const p = Date.parse(publicSince);
  if (!Number.isFinite(s) || !Number.isFinite(p)) return false;
  return s < p;
}

/** A PAPER trade may be created only for a signal at or after `publicSince` (never back-filled). */
export function mayCreatePaperTrade(signalAt: string | null | undefined, publicSince: string | null | undefined): boolean {
  return !!signalAt && !!publicSince && !isHistoricalSignal(signalAt, publicSince);
}

export interface OwnedRow { user_id: string | null; mode?: string }

/** Evaluations shown to everybody: central rows only (legacy per-user rows are not mixed in -> no duplicates). */
export function centralOnly<T extends OwnedRow>(rows: T[]): T[] {
  return rows.filter((r) => r.user_id === null || r.user_id === undefined);
}

/** Trades shown to a user: central PAPER + that user's own ACTUAL. Legacy per-user PAPER rows are excluded (duplicates). */
export function visibleTrades<T extends OwnedRow & { mode: string }>(rows: T[], userId: string | null): T[] {
  return rows.filter((r) =>
    (r.mode === "PAPER" && (r.user_id === null || r.user_id === undefined)) ||
    (r.mode === "ACTUAL" && !!userId && r.user_id === userId));
}
