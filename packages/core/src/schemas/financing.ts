import { z } from 'zod';
import { exactlyOne } from './eitherOr.js';
import { money } from './money.js';
import { pct } from './percent.js';
import { ValidationError } from './result.js';

export const financing = z
  .object({
    downPaymentPct: pct('downPaymentPct')
      .optional()
      .describe('Down payment as a percent number of the purchase price, 25 means 25%.'),
    ltvPct: pct('ltvPct')
      .optional()
      .describe('Loan-to-value as a percent number of the purchase price, 75 means 75%.'),
    downPaymentAmount: money
      .optional()
      .describe('Down payment in US dollars, paid once at purchase.'),
    loanAmount: money.optional().describe('Loan amount in US dollars at origination.'),
  })
  .superRefine(exactlyOne('downPaymentPct', 'ltvPct', 'downPaymentAmount', 'loanAmount'))
  .describe('How the purchase is financed. Provide exactly one of the four fields.');

export type Financing = z.output<typeof financing>;

export type ResolvedFinancing = {
  downPaymentPct: number;
  ltvPct: number;
  downPaymentAmount: number;
  loanAmount: number;
};

/** Derive all four financing values from the one the caller gave. */
export function resolveFinancing(price: number, f: Financing): ResolvedFinancing {
  let loanAmount: number;
  if (f.downPaymentPct !== undefined) loanAmount = price * (1 - f.downPaymentPct / 100);
  else if (f.ltvPct !== undefined) loanAmount = (price * f.ltvPct) / 100;
  else if (f.downPaymentAmount !== undefined) loanAmount = price - f.downPaymentAmount;
  else loanAmount = f.loanAmount ?? 0;

  if (loanAmount < 0 || loanAmount > price) {
    const field = f.downPaymentAmount !== undefined ? 'downPaymentAmount' : 'loanAmount';
    throw new ValidationError([
      {
        path: `financing.${field}`,
        message: `${field} was ${f[field]}. It must be between 0 and the price (${price}).`,
      },
    ]);
  }
  const downPaymentAmount = price - loanAmount;
  return {
    downPaymentPct: (downPaymentAmount / price) * 100,
    ltvPct: (loanAmount / price) * 100,
    downPaymentAmount,
    loanAmount,
  };
}
