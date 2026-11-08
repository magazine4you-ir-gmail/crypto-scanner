// Reverse Signal Plus — fixed-point decimal arithmetic (BigInt, 18 decimals).
//
// Every money / price / quantity calculation of the module is done with `Dec` values. A `Dec` is a
// bigint holding value * 10^18, so there is no binary floating point anywhere in the financial path.
// Conversion to `number` is meant ONLY for the presentation layer (`toNumber`).
// Dependency-free so it runs in the browser, in Deno (Edge Functions) and in vitest.

export type Dec = bigint;
export type Rounding = 'floor' | 'ceil' | 'half_up';

export const SCALE_DIGITS = 18;
export const ONE: Dec = 10n ** 18n;
export const ZERO: Dec = 0n;
const HUNDRED: Dec = 100n * ONE;

/** Integer division with explicit rounding (floor = toward -inf, ceil = toward +inf, half_up = away from zero on ties). */
function divRound(n: bigint, d: bigint, mode: Rounding): bigint {
  if (d === 0n) throw new RangeError('division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let q = n / d; // truncates toward zero
  const r = n % d;
  if (r === 0n) return q;
  if (mode === 'floor') {
    if (n < 0n) q -= 1n;
  } else if (mode === 'ceil') {
    if (n > 0n) q += 1n;
  } else {
    const twice = (r < 0n ? -r : r) * 2n;
    if (twice >= d) q += n < 0n ? -1n : 1n;
  }
  return q;
}

/** Expands "1.2e-7" style strings into plain decimal notation. */
function expandExponent(s: string): string {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = '', expRaw] = m;
  const exp = Number(expRaw);
  const digits = int + frac;
  const point = int.length + exp;
  let out: string;
  if (point <= 0) out = '0.' + '0'.repeat(-point) + digits;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = digits.slice(0, point) + '.' + digits.slice(point);
  return sign + out;
}

/** Parses a decimal string. Digits beyond 18 decimals are rounded half-up. */
export function fromString(input: string): Dec {
  const s = expandExponent(input.trim());
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new SyntaxError(`invalid decimal: "${input}"`);
  const [, sign, int, frac = ''] = m;
  const padded = (frac + '0'.repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
  let value = BigInt(int) * ONE + BigInt(padded || '0');
  if (frac.length > SCALE_DIGITS && Number(frac[SCALE_DIGITS]) >= 5) value += 1n;
  return sign === '-' ? -value : value;
}

/** number -> Dec through its shortest round-trip decimal text (so 0.1 is exactly 0.1, not 0.1000000000000000055). */
export function fromNumber(n: number): Dec {
  if (!Number.isFinite(n)) throw new RangeError(`not a finite number: ${n}`);
  return fromString(String(n));
}

export function D(v: number | string | bigint): Dec {
  if (typeof v === 'bigint') return v;
  return typeof v === 'number' ? fromNumber(v) : fromString(v);
}

/** Exact decimal text, trailing zeros trimmed. Use this for database writes. */
export function toString(a: Dec): string {
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const int = abs / ONE;
  const frac = (abs % ONE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + int.toString() + (frac ? '.' + frac : '');
}

/** PRESENTATION ONLY. Never feed the result back into financial calculations. */
export function toNumber(a: Dec): number {
  return Number(toString(a));
}

export const add = (a: Dec, b: Dec): Dec => a + b;
export const sub = (a: Dec, b: Dec): Dec => a - b;
export const neg = (a: Dec): Dec => -a;
export const abs = (a: Dec): Dec => (a < 0n ? -a : a);
export const cmp = (a: Dec, b: Dec): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
export const min = (a: Dec, b: Dec): Dec => (a < b ? a : b);
export const max = (a: Dec, b: Dec): Dec => (a > b ? a : b);
export const isPositive = (a: Dec): boolean => a > 0n;
export const sum = (list: Dec[]): Dec => list.reduce((s, v) => s + v, 0n);

export function mul(a: Dec, b: Dec, mode: Rounding = 'half_up'): Dec {
  return divRound(a * b, ONE, mode);
}

export function div(a: Dec, b: Dec, mode: Rounding = 'half_up'): Dec {
  return divRound(a * ONE, b, mode);
}

/** a * (pct / 100) */
export function pctOf(a: Dec, pct: Dec, mode: Rounding = 'half_up'): Dec {
  return divRound(a * pct, HUNDRED, mode);
}

/** (a / b) * 100, as a Dec percentage. */
export function ratioPct(a: Dec, b: Dec, mode: Rounding = 'half_up'): Dec {
  return mul(div(a, b, mode), HUNDRED, mode);
}

/** pct -> fraction (0.05 % -> 0.0005) */
export const fraction = (pct: Dec): Dec => div(pct, HUNDRED);

export function roundToDecimals(a: Dec, decimals: number, mode: Rounding = 'half_up'): Dec {
  if (decimals >= SCALE_DIGITS) return a;
  const unit = 10n ** BigInt(SCALE_DIGITS - decimals);
  return divRound(a, unit, mode) * unit;
}

/** Largest multiple of `step` that is <= a (a >= 0, step > 0). This is how order quantities are rounded. */
export function floorToStep(a: Dec, step: Dec): Dec {
  if (step <= 0n) throw new RangeError('step must be positive');
  if (a < 0n) throw new RangeError('floorToStep expects a non-negative value');
  return (a / step) * step;
}

export function ceilToStep(a: Dec, step: Dec): Dec {
  if (step <= 0n) throw new RangeError('step must be positive');
  if (a < 0n) throw new RangeError('ceilToStep expects a non-negative value');
  return divRound(a, step, 'ceil') * step;
}

/** bigint-safe JSON: Dec values become exact decimal strings (for jsonb columns). */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? toString(v) : v)));
}
