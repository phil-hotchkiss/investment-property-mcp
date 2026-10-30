import { z } from 'zod';
import { loan } from '../schemas/loan.js';
import { money } from '../schemas/money.js';
import { type CalcResult, parseInput } from '../schemas/result.js';

export const loanPaymentInput = loan
  .extend({
    loanAmount: money.describe('Loan amount in US dollars at origination.'),
    balanceAtYear: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Optional: report the remaining loan balance after this many years, 0 to termYears.',
      ),
  })
  .superRefine((v, ctx) => {
    if (v.balanceAtYear !== undefined && v.balanceAtYear > v.termYears) {
      ctx.addIssue({
        code: 'custom',
        path: ['balanceAtYear'],
        message: `balanceAtYear was ${v.balanceAtYear}. It must be at most termYears (${v.termYears}).`,
      });
    }
  });

export type LoanPaymentInput = z.input<typeof loanPaymentInput>;

export type LoanPaymentValues = {
  monthlyPrincipalAndInterest: number;
  monthlyInterestOnly: number;
  /** The payment that matches `amortization`. */
  monthlyPayment: number;
  /** Interest paid over the full term. */
  totalInterest: number;
  /** Remaining balance in dollars after `balanceAtYear` years, when requested. */
  balanceAtYear?: number;
};

export function loanPayment(raw: unknown): CalcResult<LoanPaymentValues> {
  const x = parseInput(loanPaymentInput, raw);
  const r = x.interestRatePct / 1200;
  const n = x.termYears * 12;
  const L = x.loanAmount;
  // 0% rate: the annuity formula divides by zero, so principal is paid straight-line.
  const pi = r === 0 ? L / n : (L * r) / (1 - (1 + r) ** -n);
  const io = L * r;
  const amortizing = x.amortization === 'amortizing';

  const balance = (years: number) => {
    if (!amortizing) return L;
    const m = years * 12;
    return r === 0 ? L - pi * m : L * (1 + r) ** m - (pi * ((1 + r) ** m - 1)) / r;
  };

  return {
    values: {
      monthlyPrincipalAndInterest: pi,
      monthlyInterestOnly: io,
      monthlyPayment: amortizing ? pi : io,
      totalInterest: amortizing ? pi * n - L : io * n,
      ...(x.balanceAtYear !== undefined && { balanceAtYear: balance(x.balanceAtYear) }),
    },
    assumptions: [
      amortizing
        ? `Amortizing loan: monthly principal and interest pays it off over ${x.termYears} years.`
        : `Interest-only loan for the full ${x.termYears}-year term; the full ${L} dollar balance is due at the end.`,
    ],
    warnings: [],
  };
}
