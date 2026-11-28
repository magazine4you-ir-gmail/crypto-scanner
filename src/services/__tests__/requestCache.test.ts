import { beforeEach, describe, expect, it } from 'vitest';
import { cachedRequest, invalidateRequests, requestCacheStats, resetRequestCache } from '../requestCache';

const deferred = <T,>() => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('requestCache — de-duplication and TTL', () => {
  beforeEach(() => resetRequestCache());

  it('concurrent callers with the same key share ONE request (mount / unmount / StrictMode double effects)', async () => {
    let calls = 0;
    const d = deferred<string>();
    const fn = () => { calls++; return d.promise; };
    const a = cachedRequest('k', 1000, fn);
    const b = cachedRequest('k', 1000, fn);
    const c = cachedRequest('k', 1000, fn);
    d.resolve('v');
    expect(await Promise.all([a, b, c])).toEqual(['v', 'v', 'v']);
    expect(calls).toBe(1);
    expect(requestCacheStats().inflight).toBe(0);
  });

  it('reuses a fresh value and fetches again once the TTL has passed', async () => {
    let t = 1_000; let calls = 0;
    const now = () => t;
    const fn = async () => ++calls;
    expect(await cachedRequest('k', 100, fn, { now })).toBe(1);
    t += 99;
    expect(await cachedRequest('k', 100, fn, { now })).toBe(1); // still fresh
    t += 1;
    expect(await cachedRequest('k', 100, fn, { now })).toBe(2); // expired -> new request
    expect(calls).toBe(2);
  });

  it('different keys never share a value', async () => {
    expect(await cachedRequest('a', 1000, async () => 'A')).toBe('A');
    expect(await cachedRequest('b', 1000, async () => 'B')).toBe('B');
  });

  it('force bypasses a stored value but still joins a request that is already running', async () => {
    let calls = 0;
    await cachedRequest('k', 10_000, async () => ++calls);
    expect(await cachedRequest('k', 10_000, async () => ++calls, { force: true })).toBe(2);
    const d = deferred<number>();
    const running = cachedRequest('k', 10_000, () => d.promise, { force: true });
    const joined = cachedRequest('k', 10_000, async () => 999, { force: true });
    d.resolve(7);
    expect(await Promise.all([running, joined])).toEqual([7, 7]);
  });

  it('failures are not cached and do not poison the key', async () => {
    let calls = 0;
    await expect(cachedRequest('k', 10_000, async () => { calls++; throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await cachedRequest('k', 10_000, async () => { calls++; return 'ok'; })).toBe('ok');
    expect(calls).toBe(2);
    expect(requestCacheStats().inflight).toBe(0);
  });

  it('ttl 0 only de-duplicates, it never stores', async () => {
    let calls = 0;
    await cachedRequest('k', 0, async () => ++calls);
    await cachedRequest('k', 0, async () => ++calls);
    expect(calls).toBe(2);
  });

  it('invalidateRequests drops matching stored values only', async () => {
    await cachedRequest('rp:a', 10_000, async () => 1);
    await cachedRequest('mix:b', 10_000, async () => 2);
    invalidateRequests('rp:');
    let calls = 0;
    expect(await cachedRequest('rp:a', 10_000, async () => { calls++; return 3; })).toBe(3);
    expect(await cachedRequest('mix:b', 10_000, async () => { calls++; return 4; })).toBe(2);
    expect(calls).toBe(1);
  });
});
