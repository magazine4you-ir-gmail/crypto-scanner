import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The optimisation switches that change WHEN rows are written must be opt-in. These read the Edge Function source, so a
// future edit that flips a default fails the build before it can reach production.
const src = readFileSync('supabase/functions/reverse-plus-eval/index.ts', 'utf8');

describe('reverse-plus-eval safe defaults', () => {
  it('REVERSE_PLUS_LIVE_SKIP_UNCHANGED defaults to false (opt-in)', () => {
    expect(src).toMatch(/envFlag\(Deno\.env\.get\("REVERSE_PLUS_LIVE_SKIP_UNCHANGED"\), false\)/);
  });
  it('REVERSE_PLUS_HOT_ONLY defaults to false (opt-in)', () => {
    expect(src).toMatch(/envFlag\(Deno\.env\.get\("REVERSE_PLUS_HOT_ONLY"\), false\)/);
  });
  it('with the skip switch off the force-refresh interval is 0, i.e. isLiveRowCurrent can never skip a rewrite', () => {
    expect(src).toMatch(/LIVE_FORCE_REFRESH_MS = LIVE_SKIP_UNCHANGED \? .* : 0;/);
  });
  it('no database read result is ignored: every state read either throws or is checked', () => {
    expect(src).toMatch(/if \(openErr\) throw/);
    expect(src).toMatch(/if \(missErr\) throw/);
    expect(src).toMatch(/if \(existingTradeErr\) throw/);
    expect(src).toMatch(/if \(cancelErr\) throw/);
  });
  it('the signal list is paginated with a total order (signal_at alone is not unique)', () => {
    expect(src).toMatch(/\.order\("signal_at", \{ ascending: false \}\)\.order\("id", \{ ascending: false \}\)\.range\(/);
  });
});
