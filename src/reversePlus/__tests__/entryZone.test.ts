import { describe, expect, it } from 'vitest';
import { D, toString } from '../../../supabase/functions/_shared/reversePlus/money';
import { analyzeEntryZone, gradeRr, unitEconomics, zoneGrid } from '../../../supabase/functions/_shared/reversePlus/entryZone';

// Original BUY at 100 (ATR 1): zone 100..100.3, stop 98.5, target 103  ->  REVERSE = SELL, stop 103, target 98.5
const cost = { feePct: D('0.05'), slippagePct: D('0.02') };
const base = {
  side: 'SELL' as const,
  zoneLow: D(100),
  zoneHigh: D('100.3'),
  refEntry: D(100),
  stop: D(103),
  target: D('98.5'),
  currentPrice: D(100),
  cost,
  minRr: D('0.5'),
  approachPct: D('0.5'),
  ageBars: 1,
  expiryBars: 48,
};

describe('entry zone analysis', () => {
  it('computes gross and net RR with fees + slippage (hand-checked numbers)', () => {
    const e = unitEconomics(D('100.3'), D(103), D('98.5'), cost);
    expect(toString(e.riskDistance)).toBe('2.7');
    expect(toString(e.rewardDistance)).toBe('1.8');
    expect(toString(e.netRiskPerUnit)).toBe('2.84231');
    expect(toString(e.netRewardPerUnit)).toBe('1.68054');
    expect(Number(e.rrGross) / 1e18).toBeCloseTo(0.6667, 3);
    expect(Number(e.rrNet) / 1e18).toBeCloseTo(0.5913, 3);
  });

  it('grades RR (informational only): <min BELOW_MIN, min..1 REVIEW, >=1 FAVORABLE', () => {
    expect(gradeRr(D('0.69'), D('0.7'))).toBe('BELOW_MIN');
    expect(gradeRr(D('0.7'), D('0.7'))).toBe('REVIEW');
    expect(gradeRr(D('0.99'), D('0.7'))).toBe('REVIEW');
    expect(gradeRr(D('1'), D('0.7'))).toBe('FAVORABLE');
  });

  it('only samples candidates INSIDE the existing zone and never changes stop / target', () => {
    const r = analyzeEntryZone(base);
    for (const c of r.candidates) {
      expect(c.price >= D(100) && c.price <= D('100.3')).toBe(true);
    }
    expect(toString(r.recommendedEntry!)).toBe('100.3'); // far edge of a SELL zone = best RR
    expect(r.rrBasis).toBe('RECOMMENDED_ENTRY');
    expect(toString(r.zoneLow!)).toBe('100');
    expect(toString(r.zoneHigh!)).toBe('100.3');
  });

  it('a net RR below the reference minimum is only an informational reason: the signal keeps its timing status', () => {
    const r = analyzeEntryZone({ ...base, minRr: D('0.7') });
    expect(['WAITING', 'APPROACHING', 'READY']).toContain(r.status);
    expect(r.reasons).toContain('RR_BELOW_MIN');
    expect(r.entryRangeLow).toBeNull();
    expect(r.recommendedEntry).not.toBeNull();
  });

  it('WAITING -> APPROACHING -> READY as the price walks towards the recommended entry', () => {
    expect(analyzeEntryZone({ ...base, currentPrice: D('99') }).status).toBe('WAITING');
    expect(analyzeEntryZone({ ...base, currentPrice: D('99.9') }).status).toBe('APPROACHING');
    expect(analyzeEntryZone({ ...base, currentPrice: D('100.3') }).status).toBe('READY');
  });

  it('does not chase: price beyond the zone => EXPIRED / PRICE_PASSED_ZONE', () => {
    const r = analyzeEntryZone({ ...base, currentPrice: D('101') });
    expect(r.status).toBe('EXPIRED');
    expect(r.reasons).toContain('PRICE_PASSED_ZONE');
  });

  it('EXPIRED when the signal is too old, the stop was touched or the target was consumed (never INVALID)', () => {
    expect(analyzeEntryZone({ ...base, ageBars: 48 }).reasons).toContain('SIGNAL_EXPIRED');
    expect(analyzeEntryZone({ ...base, stopTouched: true }).status).toBe('EXPIRED');
    expect(analyzeEntryZone({ ...base, targetTouched: true }).status).toBe('EXPIRED');
  });

  it('BUY side mirror: the lower edge of the zone is the best entry', () => {
    // original SELL at 100 (ATR 1): zone 99.7..100, stop 101.5, target 97 -> reverse BUY stop 97, target 101.5
    const r = analyzeEntryZone({
      ...base, side: 'BUY', zoneLow: D('99.7'), zoneHigh: D(100), refEntry: D(100), stop: D(97), target: D('101.5'), currentPrice: D(100),
    });
    expect(toString(r.recommendedEntry!)).toBe('99.7');
    expect(Number(r.rrGross) / 1e18).toBeCloseTo(1.8 / 2.7, 4);
  });

  it('without a stored zone it falls back to the existing reverse entry only (no invented zone)', () => {
    const r = analyzeEntryZone({ ...base, zoneLow: null, zoneHigh: null, minRr: D('0.4') });
    expect(r.reasons).toContain('NO_ZONE_USING_REF');
    expect(r.candidates).toHaveLength(1);
    expect(toString(r.candidates[0].price)).toBe('100');
  });

  it('impossible geometry (entry outside stop/target) gives no entry suggestion, only an informational reason', () => {
    const r = analyzeEntryZone({ ...base, stop: D(99), target: D(98) });
    expect(r.status).toBe('WAITING');
    expect(r.recommendedEntry).toBeNull();
    expect(r.reasons).toContain('GEOMETRY_INVALID');
  });

  it('zoneGrid is exact and includes both ends', () => {
    const g = zoneGrid(D(100), D('100.3'), 4);
    expect(g.map(toString)).toEqual(['100', '100.1', '100.2', '100.3']);
  });
});
