import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the complete removal of the Fast Scalp feature and the integrity of what remains.

const ROOT = process.cwd();
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const text = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(ROOT.length + 1);

describe('Fast Scalp is completely removed', () => {
  // Code, configuration, bundles and migrations. (docs/*.md and *REPORT.md describe the removal and may name it.)
  const codeFiles = [
    ...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'supabase')), ...walk(join(ROOT, 'scripts')),
    ...['package.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'README.md', 'index.html', 'wrangler.toml']
      .map((f) => join(ROOT, f)).filter(existsSync),
  ].filter((p) => !p.endsWith('scalpRemoval.test.ts'));

  it('no Scalp file, page, component, engine module or test is left', () => {
    for (const f of ['src/pages/ScalpPage.tsx', 'src/components/VolumeProfileChart.tsx', 'src/engine/__tests__/scalp.test.ts', 'supabase/functions/_shared/scalp.ts']) {
      expect(existsSync(join(ROOT, f)), f).toBe(false);
    }
    expect(walk(ROOT).filter((p) => /scalp/i.test(rel(p)) && !/REPORT|docs[\\/]/i.test(rel(p)) && !p.endsWith('scalpRemoval.test.ts'))).toEqual([]);
  });

  it('no code, config, bundle, migration or script mentions Scalp', () => {
    const hits = codeFiles.filter((p) => /scalp/i.test(text(p))).map(rel);
    expect(hits).toEqual([]);
  });

  it('the route and the navigation entry are gone, and an old /scalp link lands on the dashboard', () => {
    const app = text(join(ROOT, 'src/App.tsx'));
    expect(app).not.toMatch(/scalp/i);
    expect(app).toMatch(/<Route path="\*" element=\{<Navigate to="\/" replace \/>\} \/>/);
    expect(text(join(ROOT, 'src/components/Layout.tsx'))).not.toMatch(/scalp|'\/scalp'/i);
    expect(text(join(ROOT, 'src/i18n/translations.ts'))).not.toMatch(/scalp/i);
  });

  it('the shared pieces Scalp used are still there (market-data, tickers, klines)', () => {
    const md = text(join(ROOT, 'src/services/marketData.ts'));
    for (const fn of ['export async function fetchKlines', 'export async function fetchKlinesRange', 'export async function fetchTickers']) expect(md).toContain(fn);
    expect(text(join(ROOT, 'supabase/functions/market-data/index.ts'))).toMatch(/case "ticker"|action === "ticker"|"ticker"/);
  });

  it('no Scalp-only npm package was left in package.json (nothing was exclusive to it)', () => {
    const pkg = JSON.parse(text(join(ROOT, 'package.json')));
    expect(JSON.stringify(pkg)).not.toMatch(/scalp/i);
  });
});

describe('what remains is consistent', () => {
  const sources = walk(join(ROOT, 'src')).filter((p) => /\.(ts|tsx)$/.test(p));
  const importRe = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  const candidates = (base: string) => [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];

  it('every relative and @/ import in src resolves to an existing file (no dangling import)', () => {
    const missing: string[] = [];
    for (const f of sources) {
      for (const m of text(f).matchAll(importRe)) {
        const spec = m[1];
        let base: string | null = null;
        if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
        else if (spec === '@engine') base = join(ROOT, 'supabase/functions/_shared/engine');
        else if (spec.startsWith('.')) base = resolve(dirname(f), spec);
        if (!base) continue;
        if (!candidates(base).some((c) => existsSync(c) && statSync(c).isFile()) && !existsSync(base)) missing.push(`${rel(f)} -> ${spec}`);
      }
    }
    // two known, pre-existing gaps unrelated to Scalp: files that are missing from the uploaded project
    expect(missing.filter((m) => !m.includes('golden-signal-output') && !m.includes('20261109000000_reverse_plus_public'))).toEqual([]);
  });

  it('every navigation entry has a route, a page file and a translation', () => {
    const app = text(join(ROOT, 'src/App.tsx'));
    const layout = text(join(ROOT, 'src/components/Layout.tsx'));
    const tr = readdirSync(join(ROOT, 'src/i18n')).filter((f) => f.endsWith('.ts')).map((f) => text(join(ROOT, 'src/i18n', f))).join('\n');
    const items = [...layout.matchAll(/\{\s*key:\s*'(\w+)',\s*path:\s*'([^']+)'/g)].map((m) => ({ key: m[1], path: m[2] }));
    expect(items.length).toBeGreaterThanOrEqual(12);
    for (const { key, path } of items) {
      expect(app, `route ${path}`).toContain(`path="${path}"`);
      expect(tr, `translation ${key}`).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
    // every page imported by App exists
    for (const m of app.matchAll(/from '@\/pages\/(\w+)'/g)) expect(existsSync(join(ROOT, 'src/pages', `${m[1]}.tsx`)), m[1]).toBe(true);
  });

  it('the features that must stay are still routed', () => {
    const app = text(join(ROOT, 'src/App.tsx'));
    for (const p of ['/scanner', '/auto-scan', '/signal-lab', '/reverse-lab', '/power-mix', '/performance', '/backtest', '/settings']) expect(app).toContain(`path="${p}"`);
  });
});
