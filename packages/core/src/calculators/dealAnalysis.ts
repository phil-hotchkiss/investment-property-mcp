import { z } from 'zod';
import { type CalcResult, parseInput } from '../schemas/result.js';
import { computeCashOnCash, dealChecks, dealShape } from './cashOnCash.js';
import { computeDscr } from './dscr.js';

export const dealAnalysisInput = z
  .object({
    ...dealShape,
    dscrMethod: z
      .enum(['rentToPitia', 'noi'])
      .describe(
        'Required, no default. rentToPitia: gross monthly rent / PITIA, the common DSCR-loan method. noi: annual NOI / annual debt service, the traditional commercial method.',
      ),
    dscrTarget: z
      .number()
      .positive()
      .default(1.25)
      .describe('Minimum DSCR ratio to pass, e.g. 1.25. A ratio, not a percent. Default 1.25.'),
  })
  .superRefine((v, ctx) => dealChecks.forEach((check) => check(v, ctx)));

export type DealAnalysisInput = z.input<typeof dealAnalysisInput>;

export type DealAnalysisValues = {
  annualGrossRent: number;
  annualNoi: number;
  /** Percent number, NOI / price. */
  capRatePct: number;
  /** Price / annual gross scheduled rent. null when rent is 0. */
  grm: number | null;
  /** null when the denominator is 0. */
  dscr: number | null;
  dscrMethod: 'rentToPitia' | 'noi';
  dscrPasses: boolean;
  monthlyPitia: number;
  monthlyCashFlow: number;
  annualCashFlow: number;
  cashOnCashPct: number | null;
  totalCashInvested: number;
  loanAmount: number;
  ltvPct: number;
};

export function dealAnalysis(raw: unknown): CalcResult<DealAnalysisValues> {
  return computeDealAnalysis(parseInput(dealAnalysisInput, raw));
}

/** The math behind `dealAnalysis`, on already-parsed input. Exported for maxOffer and stressTest. */
export function computeDealAnalysis(
  x: z.output<typeof dealAnalysisInput>,
): CalcResult<DealAnalysisValues> {
  const coc = computeCashOnCash(x);
  const d = computeDscr({ ...x, method: x.dscrMethod, target: x.dscrTarget });
  const annualGrossRent = coc.values.monthlyRentUsed * 12;
  const warnings = [...new Set([...coc.warnings, ...d.warnings])];
  if (annualGrossRent === 0) warnings.push('Gross rent is 0, so GRM is undefined.');
  return {
    values: {
      annualGrossRent,
      annualNoi: coc.values.annualNoi,
      capRatePct: (coc.values.annualNoi / x.price) * 100,
      grm: annualGrossRent > 0 ? x.price / annualGrossRent : null,
      dscr: d.values.dscr,
      dscrMethod: d.values.method,
      dscrPasses: d.values.passes,
      monthlyPitia: coc.values.monthlyPitia,
      monthlyCashFlow: coc.values.monthlyCashFlow,
      annualCashFlow: coc.values.annualCashFlow,
      cashOnCashPct: coc.values.cashOnCashPct,
      totalCashInvested: coc.values.totalCashInvested,
      loanAmount: coc.values.loanAmount,
      ltvPct: coc.values.ltvPct,
    },
    assumptions: [
      ...new Set([
        ...d.assumptions.slice(0, 1),
        `DSCR target is ${x.dscrTarget}.`,
        'Cap rate = annual NOI divided by price. GRM = price divided by annual gross scheduled rent.',
        // dscr says rentToPitia ignores the expense fields; here NOI and cash-on-cash use them.
        ...[...d.assumptions.slice(1), ...coc.assumptions].filter((a) => !a.startsWith('Ignored ')),
      ]),
    ],
    warnings,
  };
}
