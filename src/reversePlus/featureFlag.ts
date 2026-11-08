// Reverse Signal Plus — feature flag. Default ON; VITE_REVERSE_PLUS_ENABLED=false hides the page and the menu item.
// With the flag off the app behaves exactly like before: the nav list is returned UNCHANGED (same reference).

export function isReversePlusEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  const v = String(env.VITE_REVERSE_PLUS_ENABLED ?? 'true').trim().toLowerCase();
  return !(v === 'false' || v === 'off' || v === '0');
}

export function withReversePlusNav<T extends { key: string; path: string }>(items: T[], enabled: boolean, entry: T): T[] {
  if (!enabled) return items;
  const at = items.findIndex((i) => i.key === 'reverseLab');
  const out = [...items];
  out.splice(at >= 0 ? at + 1 : out.length, 0, entry);
  return out;
}
