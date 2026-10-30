import { z } from 'zod';

/**
 * A percent-number field: 7.1 means 7.1%.
 *
 * Values strictly between 0 and 1 are rejected as probable decimals (0.071 meant 7.1), unless
 * `allowSubOne` is set for fields where a sub-1 percent is normal (vacancy, management, property
 * tax as percent of price). Exactly 1 is accepted as 1%.
 */
export function pct(field: string, opts: { max?: number; allowSubOne?: boolean } = {}) {
  const max = opts.max ?? 100;
  return z.number().superRefine((value, ctx) => {
    if (value < 0 || value > max) {
      ctx.addIssue({
        code: 'custom',
        message: `${field} was ${value}. This field is a percent number between 0 and ${max}.`,
      });
    } else if (!opts.allowSubOne && value > 0 && value < 1) {
      // toPrecision trims float noise: 0.071 * 100 is 7.1000000000000005.
      const meant = Number((value * 100).toPrecision(12));
      ctx.addIssue({
        code: 'custom',
        message: `${field} was ${value}. This field is a percent number; did you mean ${meant}?`,
      });
    }
  });
}
