import { z } from 'zod';
import { pct } from './percent.js';

export const loan = z
  .strictObject({
    interestRatePct: pct('interestRatePct').describe(
      'Annual interest rate as a percent number, 7.25 means 7.25%.',
    ),
    termYears: z
      .number()
      .int()
      .positive()
      .max(40)
      .describe('Loan term in years, a whole number from 1 to 40.'),
    amortization: z
      .enum(['amortizing', 'interestOnly'])
      .default('amortizing')
      .describe(
        'amortizing: monthly principal and interest pays the loan off over the term (default). interestOnly: monthly interest only for the whole term, full balance due at the end.',
      ),
  })
  .describe('The loan: annual interest rate, term in years, and amortization.');

export type Loan = z.output<typeof loan>;
