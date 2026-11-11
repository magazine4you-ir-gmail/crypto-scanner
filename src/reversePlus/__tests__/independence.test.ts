import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint } from '../../../scripts/golden-signal-output';
import baseline from './golden/baseline-signal-output.json';
import { isReversePlusEnabled, withReversePlusNav } from '../featureFlag';
import { D } from '../../../supabase/functions/_shared/reversePlus/money';
import { buildPlusAnalysis } from '../../../supabase/functions/_shared/reversePlus/plan';
import { UNKNOWN_CONTRACT } from '../../../supabase/functions/_shared/reversePlus/types';
import { settings } from './fixtures';
import { series } from './helpers';

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((f) => {
    const rel = `${dir}/${f}`;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });

const PROTECTED_TABLES = ['signal_outcomes', 'reverse_signal_outcomes', 'scan_results', 'user_settings', 'signals', 'scan_runs', 'portfolio', 'journal'];
const MODULE_FILES = [
  ...walk('supabase/functions/_shared/reversePlus'),
  'supabase/functions/reverse-plus-eval/index.ts',
  'src/services/reversePlusService.ts',
  'src/pages/ReversePlusPage.tsx',
];

describe('independence from the existing signal system', () => {
  it('the existing signal / reverse-signal / analysis output is byte-identical to the pre-change baseline', () => {
    expect(JSON.parse(fingerprint())).toEqual(baseline);
  });

  it('no module file ever writes (insert/update/upsert/delete) to an existing table', () => {
    for (const file of MODULE_FILES) {
      const src = read(file);
      for (const table of PROTECTED_TABLES) {
        const re = new RegExp(`from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, 'g');
        for (const m of src.matchAll(re)) {
          const stmt = src.slice(m.index!, src.indexOf(';', m.index!));
          expect(stmt, `${file} → ${table}`).not.toMatch(/\.(insert|update|upsert|delete)\(/);
        }
      }
    }
  });

  it('the module reads existing data ONLY from reverse_signal_outcomes (select) and writes only reverse_plus_* tables', () => {
    const edge = read('supabase/functions/reverse-plus-eval/index.ts');
    const tables = new Set([...edge.matchAll(/from\(\s*["']([a-z_]+)["']\s*\)/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(['reverse_plus_evaluations', 'reverse_plus_settings', 'reverse_plus_trades', 'reverse_signal_outcomes']);
  });

  it('the new migrations only create reverse_plus_* objects and never alter an existing table', () => {
    const files = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.includes('reverse_plus'));
    expect(files.length).toBe(3);
    for (const f of files) {
      const sql = read(`supabase/migrations/${f}`).replace(/\/\*[\s\S]*?\*\//g, '');
      const alters = [...sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((m) => m[1]);
      for (const t of alters) expect(t.startsWith('reverse_plus_'), `${f}: alter on ${t}`).toBe(true);
      expect(sql).not.toMatch(/drop\s+table\s+(?!if exists public\.reverse_plus_)/i);
      for (const t of PROTECTED_TABLES) expect(sql).not.toMatch(new RegExp(`references\\s+(public\\.)?${t}\\b`, 'i'));
    }
  });

  it('the client service is read-only and has no per-user server-side settings (scenario values stay in the browser)', () => {
    const svc = read('src/services/reversePlusService.ts');
    expect(svc).not.toMatch(/user_settings|settingsService|reverse_plus_settings|reverse_plus_trades/);
    expect(svc).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it('OFF means off: the global switch is checked before any client / network / DB access', () => {
    const edge = read('supabase/functions/reverse-plus-eval/index.ts');
    expect(edge.indexOf('REVERSE_PLUS_ENABLED')).toBeGreaterThan(-1);
    expect(edge.indexOf('REVERSE_PLUS_ENABLED')).toBeLessThan(edge.indexOf('createClient(Deno'));
    expect(edge).toMatch(/no user has Reverse Signal Plus enabled/);
  });

  it('flag OFF leaves the navigation exactly as before (same array); flag ON adds one entry after Reverse Lab', () => {
    const items = [{ key: 'dashboard', path: '/' }, { key: 'reverseLab', path: '/reverse-lab' }, { key: 'scalp', path: '/scalp' }];
    const entry = { key: 'reversePlus', path: '/reverse-plus' };
    expect(withReversePlusNav(items, false, entry)).toBe(items);
    const on = withReversePlusNav(items, true, entry);
    expect(on.map((i) => i.key)).toEqual(['dashboard', 'reverseLab', 'reversePlus', 'scalp']);
    expect(items).toHaveLength(3); // not mutated
    expect(isReversePlusEnabled({})).toBe(true);
    expect(isReversePlusEnabled({ VITE_REVERSE_PLUS_ENABLED: 'false' })).toBe(false);
    expect(isReversePlusEnabled({ VITE_REVERSE_PLUS_ENABLED: 'off' })).toBe(false);
  });

  it('analysis never mutates the existing signal data (deep-frozen inputs do not throw, nothing changes)', () => {
    const candles = series(260, { drift: 0.0008, noise: 0.6, seed: 11 });
    const price = candles[199].close;
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o); }
      return o;
    };
    const input = deepFreeze({
      side: 'SELL' as const, timeframe: '1h', zoneLow: D(price.toFixed(4)), zoneHigh: D((price * 1.003).toFixed(4)), refEntry: D(price.toFixed(4)),
      stop: D((price * 1.03).toFixed(4)), target: D((price * 0.985).toFixed(4)), currentPrice: D(price.toFixed(4)), candles: candles.slice(0, 200),
      asOfCloseTime: candles[199].closeTime, ageBars: 0, expiryBars: 48, settings: { ...settings, leverage: D(10), minRr: D('0.4') },
      contract: UNKNOWN_CONTRACT, futuresAvailable: true,
    });
    expect(() => buildPlusAnalysis(input)).not.toThrow();
  });

  it('protected source files are byte-identical to the baseline git tag (skipped when the tag is not available)', () => {
    let hasTag = true;
    try { execFileSync('git', ['rev-parse', '--verify', 'pre-reverse-plus'], { cwd: root, stdio: 'pipe' }); } catch { hasTag = false; }
    if (!hasTag) return;
    const diff = execFileSync('git', ['diff', '--stat', 'pre-reverse-plus', '--',
      'supabase/functions/_shared/engine.ts', 'supabase/functions/scheduled-scan', 'supabase/functions/track-signal',
      'src/engine', 'src/services/outcomeService.ts', 'src/services/reverseOutcomeService.ts', 'supabase/cron_setup.sql',
    ], { cwd: root, encoding: 'utf8' });
    expect(diff.trim()).toBe('');
  });
});
