import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal React stand-in: effects run immediately, cleanups are collected, refs are plain boxes.
const h = vi.hoisted(() => {
  const state = { cleanups: [] as Array<() => void> };
  return { state };
});
vi.mock('react', () => ({
  useRef: (v: unknown) => ({ current: v }),
  useEffect: (fn: () => void | (() => void)) => { const c = fn(); if (typeof c === 'function') h.state.cleanups.push(c); },
}));

import { useVisibleInterval } from '../useVisibleInterval';

type Listener = () => void;
function fakeDocument() {
  const listeners = new Set<Listener>();
  const doc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    setVisibility(v: 'visible' | 'hidden') { doc.visibilityState = v; [...listeners].forEach((l) => l()); },
    listenerCount: () => listeners.size,
  };
  return doc;
}

describe('useVisibleInterval', () => {
  let doc: ReturnType<typeof fakeDocument>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    h.state.cleanups.length = 0;
    doc = fakeDocument();
    vi.stubGlobal('document', doc);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('runs on the interval while the tab is visible', () => {
    const cb = vi.fn();
    useVisibleInterval(cb, 1000);
    vi.advanceTimersByTime(3500);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('makes no calls while the tab is hidden', () => {
    const cb = vi.fn();
    useVisibleInterval(cb, 1000);
    vi.advanceTimersByTime(1000);
    doc.setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('on return it refreshes immediately when data is older than one interval, then continues', () => {
    const cb = vi.fn();
    useVisibleInterval(cb, 1000);
    doc.setVisibility('hidden');
    vi.advanceTimersByTime(30_000);
    doc.setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);          // immediate catch-up
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);          // regular cadence resumes
  });

  it('on a quick return it does not fire twice', () => {
    const cb = vi.fn();
    useVisibleInterval(cb, 10_000);
    vi.advanceTimersByTime(2000);
    doc.setVisibility('hidden'); doc.setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('does not start a hidden tab, and does nothing when disabled', () => {
    doc.visibilityState = 'hidden';
    const cb = vi.fn();
    useVisibleInterval(cb, 1000);
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
    const off = vi.fn();
    useVisibleInterval(off, 1000, false);
    vi.advanceTimersByTime(5000);
    expect(off).not.toHaveBeenCalled();
  });

  it('cleanup stops the timer and removes the listener (no leak on unmount)', () => {
    const cb = vi.fn();
    useVisibleInterval(cb, 1000);
    expect(doc.listenerCount()).toBe(1);
    h.state.cleanups.forEach((c) => c());
    expect(doc.listenerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });
});
