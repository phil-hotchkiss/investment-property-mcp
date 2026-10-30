import type { z } from 'zod';

/**
 * Object refinement requiring exactly one of `keys` to be present (not undefined).
 * Used for either-or pairs (tax, insurance, closing costs, reserves) and for financing's four
 * options. Pass to `.superRefine()`.
 */
export function exactlyOne(...keys: string[]) {
  return (obj: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const given = keys.filter((k) => obj[k] !== undefined);
    if (given.length === 1) return;
    const options = keys.length === 2 ? `${keys[0]} or ${keys[1]}` : keys.join(', ');
    const got = given.length === 0 ? 'none was given' : `got ${given.join(' and ')}`;
    ctx.addIssue({ code: 'custom', message: `Provide exactly one of ${options}; ${got}.` });
  };
}
