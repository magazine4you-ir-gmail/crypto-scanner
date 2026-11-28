import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- a recording fake of the supabase client -------------------------------------------------------------------------
interface Call { table: string; select: string | null; selectOpts: unknown; filters: string[]; head: boolean }
const h = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    respond: (_c: Call): { data: unknown; error: null | { message: string }; count?: number | null } => ({ data: [], error: null }),
  };
  const builder = (table: string) => {
    const call: Call = { table, select: null, selectOpts: undefined, filters: [], head: false };
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => { call.filters.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`); return b; };
    for (const m of ['eq', 'neq', 'in', 'is', 'not', 'ilike', 'order', 'range', 'limit', 'gte']) b[m] = chain(m);
    b.select = (cols: string, opts?: { head?: boolean }) => { call.select = cols; call.selectOpts = opts; call.head = !!opts?.head; return b; };
    b.maybeSingle = () => { call.filters.push('maybeSingle'); return b; };
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => { state.calls.push(call); return Promise.resolve(state.respond(call)).then(res, rej); };
    return b;
  };
  return { state, builder };
});
vi.mock('../supabaseClient', () => ({
  supabase: { from: (t: string) => h.builder(t), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { resetRequestCache } from '../requestCache';
import { BACKTEST_COLS, EVAL_FULL_COLS, EVAL_LIST_COLS, fetchBacktestFor, fetchEvaluationsFor, fetchEvaluationsForIds, fetchPublicConfig } from '../reversePlusService';
import { fetchReverseOutcomeCounts, fetchReverseOutcomePage } from '../reverseOutcomeService';
import { BACKTEST_MISS_TTL_MS, fetchBacktestsForIds, resetBacktestCache } from '../powerMixService';
import { fetchLatestScanRun, fetchScanResults, scanRunSignature } from '../scanService';
import { BACKTEST_ENGINE_VERSION } from '../../../supabase/functions/_shared/reversePlus/index';

const reset = () => { h.state.calls.length = 0; h.state.respond = () => ({ data: [], error: null }); resetRequestCache(); resetBacktestCache(); };
const callsTo = (table: string) => h.state.calls.filter((c) => c.table === table);

describe('Reverse Plus reads', () => {
  beforeEach(reset);

  it('public config: one request however many components / tabs ask, explicit columns, no select(*)', async () => {
    h.state.respond = () => ({ data: { public_since: '2026-11-09T00:00:00Z', leverage: 10 }, error: null });
    const [a, b, c] = await Promise.all([fetchPublicConfig(), fetchPublicConfig(), fetchPublicConfig()]);
    await fetchPublicConfig();
    expect(callsTo('reverse_plus_public_config')).toHaveLength(1);
    expect(a).toBe(b); expect(b).toBe(c);
    expect(callsTo('reverse_plus_public_config')[0].select).not.toBe('*');
    await fetchPublicConfig({ force: true });
    expect(callsTo('reverse_plus_public_config')).toHaveLength(2);
  });

  it('list evaluations: light columns (no plan / quality_factors), one request per identical page, neutral defaults', async () => {
    h.state.respond = () => ({ data: [
      { reverse_outcome_id: 'r1', eval_kind: 'SIGNAL_TIME', entry_status: 'WAITING' },
      { reverse_outcome_id: 'r1', eval_kind: 'LIVE', entry_status: 'READY' },
    ], error: null });
    const m1 = await fetchEvaluationsForIds(['r2', 'r1']);
    const m2 = await fetchEvaluationsForIds(['r1', 'r2']); // same page, different order -> same key
    expect(callsTo('reverse_plus_evaluations')).toHaveLength(1);
    expect(m1).toBe(m2);
    const sel = callsTo('reverse_plus_evaluations')[0].select!;
    expect(sel).toBe(EVAL_LIST_COLS);
    for (const heavy of ['plan', 'quality_factors', 'plan_issues', 'status_reasons']) expect(sel.split(', ')).not.toContain(heavy);
    const pair = m1.get('r1')!;
    expect(pair.live?.entry_status).toBe('READY');
    expect(pair.live?.plan).toBeNull();
    expect(pair.live?.quality_factors).toBeNull();
    expect(pair.signalTime?.plan_issues).toEqual([]);
    await fetchEvaluationsForIds(['r1', 'r2'], { force: true });
    expect(callsTo('reverse_plus_evaluations')).toHaveLength(2);
    expect((await fetchEvaluationsForIds([])).size).toBe(0);
    expect(callsTo('reverse_plus_evaluations')).toHaveLength(2); // empty page: no request
  });

  it('detail page evaluations keep the full columns and are shared by concurrent callers', async () => {
    h.state.respond = () => ({ data: [{ reverse_outcome_id: 'r1', eval_kind: 'LIVE', plan: { steps: [] } }], error: null });
    await Promise.all([fetchEvaluationsFor('r1'), fetchEvaluationsFor('r1')]);
    expect(callsTo('reverse_plus_evaluations')).toHaveLength(1);
    expect(callsTo('reverse_plus_evaluations')[0].select).toBe(EVAL_FULL_COLS);
    expect(EVAL_FULL_COLS).toContain('quality_factors');
    expect(EVAL_FULL_COLS).toContain('plan');
  });

  it('backtest: explicit columns (no assumptions / created_at), cached per signal', async () => {
    h.state.respond = () => ({ data: { reverse_outcome_id: 'r1', outcome: 'WIN' }, error: null });
    await fetchBacktestFor('r1'); await fetchBacktestFor('r1');
    expect(callsTo('reverse_plus_backtests')).toHaveLength(1);
    expect(callsTo('reverse_plus_backtests')[0].select).toBe(BACKTEST_COLS);
    expect(BACKTEST_COLS).not.toContain('assumptions');
    expect(BACKTEST_COLS).not.toContain('*');
  });
});

describe('Reverse signal list reads', () => {
  beforeEach(reset);

  it('only the first page asks for the exact total; later pages skip the COUNT and return total null', async () => {
    h.state.respond = (c) => ({ data: [], error: null, count: c.selectOpts ? 321 : null });
    const p0 = await fetchReverseOutcomePage({ status: 'OPEN', page: 0, withCount: true });
    const p1 = await fetchReverseOutcomePage({ status: 'OPEN', page: 1, withCount: false });
    expect(p0.total).toBe(321);
    expect(p1.total).toBeNull();
    const [c0, c1] = callsTo('reverse_signal_outcomes');
    expect(c0.selectOpts).toEqual({ count: 'exact' });
    expect(c1.selectOpts).toBeUndefined();
  });

  it('the same page requested twice (tab switch / remount) is one request; force re-reads', async () => {
    await fetchReverseOutcomePage({ status: 'WIN', page: 0 });
    await fetchReverseOutcomePage({ status: 'WIN', page: 0 });
    expect(callsTo('reverse_signal_outcomes')).toHaveLength(1);
    await fetchReverseOutcomePage({ status: 'WIN', page: 0, force: true });
    expect(callsTo('reverse_signal_outcomes')).toHaveLength(2);
    await fetchReverseOutcomePage({ status: 'LOSS', page: 0 }); // a different filter is a different request
    expect(callsTo('reverse_signal_outcomes')).toHaveLength(3);
  });

  it('counts: four HEAD counts once, not on every filter / page change', async () => {
    h.state.respond = () => ({ data: null, error: null, count: 5 });
    const a = await fetchReverseOutcomeCounts();
    await fetchReverseOutcomeCounts(); await fetchReverseOutcomeCounts();
    expect(a.total).toBe(20);
    expect(callsTo('reverse_signal_outcomes')).toHaveLength(4);
    expect(callsTo('reverse_signal_outcomes').every((c) => c.head)).toBe(true);
  });
});

describe('Power Mix backtest reads', () => {
  beforeEach(reset);
  const row = (id: string, version = BACKTEST_ENGINE_VERSION) => ({ reverse_outcome_id: id, engine_version: version, outcome: 'WIN' });

  it('reads each signal once: rows of the current engine are final, misses are retried only after the TTL', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `s${i}`);
    h.state.respond = (c) => {
      const asked = JSON.parse(c.filters.find((f) => f.startsWith('in('))!.slice(3, -1).replace(/^"reverse_outcome_id",/, '')) as string[];
      return { data: asked.filter((id) => Number(id.slice(1)) < 200).map((id) => row(id)), error: null };
    };
    let t = 1_000_000; const now = () => t;
    const first = await fetchBacktestsForIds(ids, { now });
    expect(first.size).toBe(200);
    expect(callsTo('reverse_plus_backtests')).toHaveLength(3); // 250 ids / 100 per request
    expect(callsTo('reverse_plus_backtests').every((c) => c.select === BACKTEST_COLS)).toBe(true);

    const again = await fetchBacktestsForIds(ids, { now });   // reopening the page
    expect(again.size).toBe(200);
    expect(callsTo('reverse_plus_backtests')).toHaveLength(3); // nothing re-requested (found = final, missing = within TTL)

    t += BACKTEST_MISS_TTL_MS + 1;
    await fetchBacktestsForIds(ids, { now });
    expect(callsTo('reverse_plus_backtests')).toHaveLength(4); // only the 50 missing ids -> one request
    await fetchBacktestsForIds(ids, { now, force: true });
    expect(callsTo('reverse_plus_backtests').length).toBeGreaterThan(4);
  });

  it('a row of an OLD engine version is never treated as final (a newer row may replace it)', async () => {
    h.state.respond = () => ({ data: [row('a', 'old-engine')], error: null });
    await fetchBacktestsForIds(['a']); await fetchBacktestsForIds(['a']);
    expect(callsTo('reverse_plus_backtests')).toHaveLength(2);
  });
});

describe('Auto scan reads', () => {
  beforeEach(reset);
  it('latest run is shared; results use explicit columns and are cached for a minute', async () => {
    h.state.respond = () => ({ data: [{ id: 'x' }], error: null });
    await Promise.all([fetchScanResults(), fetchScanResults()]);
    await fetchScanResults();
    expect(callsTo('scan_results')).toHaveLength(1);
    expect(callsTo('scan_results')[0].select).not.toBe('*');
    await fetchScanResults({ force: true });
    expect(callsTo('scan_results')).toHaveLength(2);
    h.state.respond = () => ({ data: { id: 'run1' }, error: null });
    await Promise.all([fetchLatestScanRun(), fetchLatestScanRun()]);
    expect(callsTo('scan_runs')).toHaveLength(1);
  });
  it('run signature changes when a scan starts or finishes', () => {
    const a = scanRunSignature({ id: '1', status: 'running', finished_at: null });
    const b = scanRunSignature({ id: '1', status: 'ok', finished_at: '2026-11-27T10:01:00Z' });
    const c = scanRunSignature({ id: '2', status: 'running', finished_at: null });
    expect(new Set([a, b, c, scanRunSignature(null)]).size).toBe(4);
    expect(scanRunSignature({ id: '1', status: 'ok', finished_at: '2026-11-27T10:01:00Z' })).toBe(b);
  });
});
