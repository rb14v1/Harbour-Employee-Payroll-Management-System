const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** Display only: amounts are stored and calculated as integer paise on the server. */
export const money = (paise: number | null | undefined) => inr.format((paise ?? 0) / 100);
export const date = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : '-');
export const dateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('en-GB') : '-');
export const rupeesToPaise = (v: string | number): number => Math.round(Number(v) * 100);
export const paiseToRupeesInput = (p: number) => (p / 100).toFixed(2);
export const label = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
