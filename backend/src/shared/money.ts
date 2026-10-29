/**
 * Money is held as integer minor units (paise) in `number`. Values stay far below
 * Number.MAX_SAFE_INTEGER (9e15 paise = 9e13 rupees), so integer arithmetic is exact.
 * Rounding rule: half away from zero, applied once per derived amount.
 */
export type Paise = number;

export function assertPaise(v: number, label = 'amount'): Paise {
  if (!Number.isSafeInteger(v)) throw new Error(`${label} must be an integer number of paise`);
  return v;
}

export function rupeesToPaise(rupees: string | number): Paise {
  const s = typeof rupees === 'number' ? rupees.toFixed(2) : rupees.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid monetary amount: ${s}`);
  const [, sign, whole, frac = ''] = m;
  const p = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return sign === '-' ? -p : p;
}

export function paiseToRupees(p: Paise): string {
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Multiply paise by a ratio num/den with half-away-from-zero rounding, using BigInt to avoid overflow. */
export function mulDiv(amount: Paise, num: number, den: number): Paise {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) {
    throw new Error('mulDiv requires integer numerator and non-zero integer denominator');
  }
  const n = BigInt(amount) * BigInt(num);
  const d = BigInt(den);
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return Number(neg ? -q : q);
}

/** Percentage expressed in basis points (1% = 100 bps). */
export const percentOf = (amount: Paise, bps: number): Paise => mulDiv(amount, bps, 10000);

export const sum = (xs: Paise[]): Paise => xs.reduce((a, b) => a + b, 0);
