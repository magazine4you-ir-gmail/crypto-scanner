/**
 * Shared request cache + in-flight de-duplication for READ-ONLY queries.
 *
 *  - concurrent callers with the same key share ONE promise (mount / unmount / tab switch / StrictMode double effects),
 *  - a successful value is reused for `ttlMs`; after that the next caller fetches again,
 *  - failures are never cached (the next caller retries) and never poison the in-flight slot,
 *  - `force` skips the stored value but still joins a request that is already running.
 *
 * It is a plain module-level Map: it lives for the browser session and is shared by every component and page.
 * Never use it for writes, and never with a TTL longer than the freshness the screen can tolerate.
 */

interface Entry<T> { value: T; at: number }

const values = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export interface CacheOptions {
  /** bypass a stored value (an already running identical request is still shared) */
  force?: boolean;
  /** injectable clock (tests) */
  now?: () => number;
}

export function cachedRequest<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts: CacheOptions = {}): Promise<T> {
  const now = (opts.now ?? Date.now)();
  if (!opts.force && ttlMs > 0) {
    const hit = values.get(key) as Entry<T> | undefined;
    if (hit && now - hit.at < ttlMs) return Promise.resolve(hit.value);
  }
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const value = await fn();
      values.set(key, { value, at: (opts.now ?? Date.now)() });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Drops stored values whose key starts with `prefix` (running requests finish normally). */
export function invalidateRequests(prefix = ''): void {
  for (const k of [...values.keys()]) if (k.startsWith(prefix)) values.delete(k);
}

/** Test helper. */
export function resetRequestCache(): void {
  values.clear();
  inflight.clear();
}

export function requestCacheStats(): { stored: number; inflight: number } {
  return { stored: values.size, inflight: inflight.size };
}
