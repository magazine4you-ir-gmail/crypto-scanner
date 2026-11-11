import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The central reference configuration (SQL) and the client fallback used when that row cannot be read (TS) must agree.
// (The per-user settings UI was removed; the SQL settings columns are only compared to keep the legacy defaults aligned.)
const col = (sql: string, name: string): number => {
  const m = new RegExp(`\\b${name}\\s+(?:numeric|integer)\\s+not null default\\s+([0-9.]+)`).exec(sql);
  if (!m) throw new Error(`column ${name} not found`);
  return Number(m[1]);
};
const settingsSql = readFileSync('supabase/migrations/20261101000000_reverse_plus_settings.sql', 'utf8');
const configSql = readFileSync('supabase/migrations/20261109000000_reverse_plus_public.sql', 'utf8');
const tsSrc = readFileSync('src/reversePlus/fallbackConfig.ts', 'utf8');
const tsDefault = (k: string): number => {
  const block = tsSrc.slice(tsSrc.indexOf('export const FALLBACK_PUBLIC_CONFIG'));
  const m = new RegExp(`\\b${k}:\\s*([0-9.]+)`).exec(block);
  if (!m) throw new Error(`ts default ${k} not found`);
  return Number(m[1]);
};
const KEYS = ['account_balance', 'risk_pct', 'max_risk_per_trade', 'leverage', 'fee_pct', 'slippage_pct', 'min_rr', 'assumed_mmr_pct', 'liq_safety_factor', 'approach_pct'] as const;

describe('Reverse Plus reference configuration is consistent', () => {
  for (const k of KEYS) {
    it(`${k}: public config = legacy settings default = client fallback`, () => {
      expect(col(configSql, k)).toBe(col(settingsSql, k));
      expect(tsDefault(k)).toBe(col(settingsSql, k));
    });
  }
  it('the public config is read-only for users (no write policy in the migration)', () => {
    const block = configSql.slice(configSql.indexOf('reverse_plus_public_config enable row level security'), configSql.indexOf('-- 2.'));
    expect(block).toMatch(/for select to authenticated/);
    expect(block).not.toMatch(/for (insert|update|delete|all)/);
  });
});
