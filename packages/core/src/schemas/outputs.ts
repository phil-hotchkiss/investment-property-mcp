import { z } from 'zod';

/**
 * Output schemas for every calculator. The `*Values` types the calculators return are inferred
 * from these, so this file is the single source; the MCP server reuses them as tool output
 * schemas.
 */

const usd = (what: string) => z.number().describe(`${what}, in US dollars.`);
const pctNum = (what: string) =>
  z.number().describe(`${what}, as a percent number (6.4 means 6.4%).`);
const method = z.enum(['rentToPitia', 'noi']).describe('DSCR method used.');

export const loanPaymentValues = z.object({
  monthlyPrincipalAndInterest: usd('Monthly principal and interest on an amortizing loan'),
  monthlyInterestOnly: usd('Monthly interest-only payment'),
  monthlyPayment: usd('Monthly payment that matches the amortization input'),
  totalInterest: usd('Interest paid over the full term'),
  balanceAtYear: usd('Remaining balance after balanceAtYear years, when requested').optional(),
});

export const dscrValues = z.object({
  dscr: z.number().nullable().describe('DSCR ratio. null when the denominator is 0.'),
  method,
  passes: z.boolean().describe('DSCR meets the target.'),
  target: z.number().describe('Minimum DSCR ratio to pass.'),
  monthlyRentUsed: usd('Rent used per month, after rentBasis'),
  monthlyPitia: usd('Monthly principal, interest, taxes, insurance, and HOA'),
  monthlyDebtService: usd('Monthly principal and interest (or interest only)'),
  annualNoi: usd('Annual net operating income; noi method only').optional(),
  loanAmount: usd('Loan amount'),
  ltvPct: pctNum('Loan-to-value'),
  downPaymentAmount: usd('Down payment'),
  downPaymentPct: pctNum('Down payment as a share of price'),
});

export const cashOnCashValues = z.object({
  annualNoi: usd('Annual net operating income'),
  annualDebtService: usd('Annual debt service'),
  annualCashFlow: usd('Annual pre-tax cash flow, NOI minus debt service'),
  monthlyCashFlow: usd('Monthly pre-tax cash flow'),
  monthlyPitia: usd('Monthly PITIA'),
  monthlyRentUsed: usd('Rent used per month, after rentBasis'),
  totalCashInvested: usd('Total cash invested'),
  downPaymentAmount: usd('Down payment'),
  closingCosts: usd('Closing costs'),
  rehabCost: usd('Rehab cost'),
  reserves: usd('Reserves'),
  cashOnCashPct: pctNum(
    'Annual cash-on-cash return; null when total cash invested is 0',
  ).nullable(),
  loanAmount: usd('Loan amount'),
  ltvPct: pctNum('Loan-to-value'),
});

export const dealAnalysisValues = z.object({
  annualGrossRent: usd('Annual gross scheduled rent used'),
  annualNoi: usd('Annual net operating income'),
  capRatePct: pctNum('Cap rate, annual NOI / price'),
  grm: z
    .number()
    .nullable()
    .describe('Gross rent multiplier, price / annual gross rent. null when rent is 0.'),
  dscr: z.number().nullable().describe('DSCR ratio. null when the denominator is 0.'),
  dscrMethod: method,
  dscrPasses: z.boolean().describe('DSCR meets dscrTarget.'),
  monthlyPitia: usd('Monthly PITIA'),
  monthlyCashFlow: usd('Monthly pre-tax cash flow'),
  annualCashFlow: usd('Annual pre-tax cash flow'),
  cashOnCashPct: pctNum(
    'Annual cash-on-cash return; null when total cash invested is 0',
  ).nullable(),
  totalCashInvested: usd('Total cash invested'),
  loanAmount: usd('Loan amount'),
  ltvPct: pctNum('Loan-to-value'),
});

/** dealAnalysis values; the three DSCR fields are absent when no dscrMethod was given. */
export const maxOfferMetrics = dealAnalysisValues.partial({
  dscr: true,
  dscrMethod: true,
  dscrPasses: true,
});

export const maxOfferValues = z.object({
  maxPrice: usd('Highest whole-dollar price meeting every target; null when infeasible').nullable(),
  bindingConstraint: z
    .string()
    .nullable()
    .describe(
      'Target(s) that fail just above maxPrice, comma separated. null when the upper bound was hit.',
    ),
  metricsAtMaxPrice: maxOfferMetrics.nullable().describe('Deal metrics at maxPrice.'),
  feasible: z.boolean().describe('Some price in the search range meets every target.'),
});

export const stressPoint = z.object({
  value: z.number().describe('Input value tried.'),
  dscr: z.number().nullable(),
  monthlyCashFlow: usd('Monthly pre-tax cash flow'),
  passes: z.boolean().describe('DSCR meets dscrTarget.'),
});

export const sweep = z.object({
  points: z.array(stressPoint),
  breakEven: z
    .object({ dscrAtTarget: z.number().nullable(), cashFlowZero: z.number().nullable() })
    .describe(
      'Input value where each metric crosses its threshold; null when not crossed in the range.',
    ),
});

export const stressTestValues = z.object({
  base: dealAnalysisValues.describe('Deal analysis at the base case.'),
  vacancyPctRange: sweep.optional(),
  interestRatePctRange: sweep.optional(),
  monthlyRentRange: sweep.optional(),
  operatingExpensesChangePctRange: sweep.optional(),
  grid: z
    .object({
      rows: z.array(z.number()).describe('vacancyPct values.'),
      cols: z.array(z.number()).describe('interestRatePct values.'),
      dscr: z.array(z.array(z.number().nullable())).describe('dscr[i][j] is rows[i], cols[j].'),
      monthlyCashFlow: z.array(z.array(z.number())),
    })
    .optional()
    .describe('Present when both vacancyPctRange and interestRatePctRange are given.'),
});

export const portfolioProperty = z.object({
  name: z.string(),
  dscr: z.number().nullable(),
  passes: z.boolean(),
  monthlyRentUsed: usd('Rent used per month'),
  monthlyPitia: usd('Monthly PITIA; rentToPitia only').optional(),
  annualNoi: usd('Annual NOI; noi only').optional(),
  annualDebtService: usd('Annual debt service; noi only').optional(),
});

export const portfolioRollupValues = z.object({
  portfolioDscr: z
    .number()
    .nullable()
    .describe('Total income / total debt service. null when total debt service is 0.'),
  method,
  target: z.number(),
  passes: z.boolean(),
  perProperty: z.array(portfolioProperty),
  weakest: z
    .object({ name: z.string(), dscr: z.number() })
    .nullable()
    .describe('Lowest non-null per-property DSCR.'),
  averageOfRatios: z
    .number()
    .nullable()
    .describe('Mean of the per-property ratios. For comparison only; not the portfolio DSCR.'),
});

/** The `CalcResult` envelope around a values schema. */
export const calcResultSchema = <V extends z.ZodType>(values: V) =>
  z.object({
    values,
    assumptions: z
      .array(z.string())
      .describe('Defaults applied and methods used, in plain language.'),
    warnings: z.array(z.string()).describe('Risks or problems with the result, in plain language.'),
  });

export type LoanPaymentValues = z.output<typeof loanPaymentValues>;
export type DscrValues = z.output<typeof dscrValues>;
export type CashOnCashValues = z.output<typeof cashOnCashValues>;
export type DealAnalysisValues = z.output<typeof dealAnalysisValues>;
export type MaxOfferMetrics = z.output<typeof maxOfferMetrics>;
export type MaxOfferValues = z.output<typeof maxOfferValues>;
export type StressPoint = z.output<typeof stressPoint>;
export type Sweep = z.output<typeof sweep>;
export type StressTestValues = z.output<typeof stressTestValues>;
export type PortfolioProperty = z.output<typeof portfolioProperty>;
export type PortfolioRollupValues = z.output<typeof portfolioRollupValues>;
