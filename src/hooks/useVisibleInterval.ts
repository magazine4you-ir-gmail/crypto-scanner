import { useEffect, useRef } from 'react';

/**
 * Polling that does not run in a hidden tab.
 *
 *  - while the document is visible the callback runs every `ms` (same cadence as a plain setInterval),
 *  - while hidden the timer is stopped (no requests from background tabs),
 *  - when the tab becomes visible again the callback runs immediately if more than `ms` has passed since the last run,
 *    so a returning user never looks at data older than one interval,
 *  - the interval is cleared on unmount / when `enabled` turns false, and the latest callback is always used
 *    (no stale closures), so effects that depend on it do not have to restart the timer.
 */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true): void {
  const cb = useRef(callback);
  cb.current = callback;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let last = Date.now();

    const run = () => { last = Date.now(); cb.current(); };
    const start = () => { if (timer === null) timer = setInterval(run, ms); };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { stop(); return; }
      if (Date.now() - last >= ms) run();
      start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [ms, enabled]);
}
