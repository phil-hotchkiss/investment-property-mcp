import type {
  CalcResult,
  CashOnCashValues,
  DealAnalysisValues,
  DscrValues,
  LoanPaymentValues,
  MaxOfferValues,
  PortfolioRollupValues,
  StressTestValues,
  Sweep,
} from '@rental-deal-math/core';

/**
 * Text summaries, 2 to 4 lines: headline numbers with units, then the method or key assumption,
 * then warnings if any. structuredContent carries every number; this is what a model reads first.
 */

export const usd = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ratio = (n: number | null) => (n === null ? 'undefined' : n.toFixed(2));
export const pct = (n: number | null) => (n === null ? 'undefined' : `${n.toFixed(2)}%`);
const crossed = (n: number | null) => (n === null ? 'not crossed' : n.toFixed(2));
const pass = (ok: boolean) => (ok ? 'passes' : 'fails');

function lines<T>(r: CalcResult<T>, headline: string, assumption: string | undefined): string {
  const out = [headline];
  if (assumption) out.push(assumption);
  if (r.warnings.length) out.push(`Warnings: ${r.warnings.join(' ')}`);
  return out.join('\n');
}

export function loanPaymentSummary(r: CalcResult<LoanPaymentValues>): string {
  const v = r.values;
  const balance =
    v.balanceAtYear === undefined ? '' : `, balance at the requested year ${usd(v.balanceAtYear)}`;
  return lines(
    r,
    `Monthly payment: ${usd(v.monthlyPayment)} (principal and interest ${usd(v.monthlyPrincipalAndInterest)}, interest only ${usd(v.monthlyInterestOnly)}). Total interest over the term: ${usd(v.totalInterest)}${balance}.`,
    r.assumptions[0],
  );
}

export function dscrSummary(r: CalcResult<DscrValues>): string {
  const v = r.values;
  return lines(
    r,
    `DSCR: ${ratio(v.dscr)} by the ${v.method} method, ${pass(v.passes)} the ${v.target} target. Rent used ${usd(v.monthlyRentUsed)}/month, PITIA ${usd(v.monthlyPitia)}/month.`,
    r.assumptions[0],
  );
}

export function cashOnCashSummary(r: CalcResult<CashOnCashValues>): string {
  const v = r.values;
  return lines(
    r,
    `Cash-on-cash: ${pct(v.cashOnCashPct)} per year. Cash flow ${usd(v.annualCashFlow)}/year (${usd(v.monthlyCashFlow)}/month) on ${usd(v.totalCashInvested)} total cash invested.`,
    r.assumptions.find((a) => a.startsWith('Cash-on-cash =')),
  );
}

export function dealAnalysisSummary(r: CalcResult<DealAnalysisValues>): string {
  const v = r.values;
  return lines(
    r,
    `NOI ${usd(v.annualNoi)}/year, cap rate ${pct(v.capRatePct)}, DSCR ${ratio(v.dscr)} (${v.dscrMethod}, ${pass(v.dscrPasses)} target), cash-on-cash ${pct(v.cashOnCashPct)}, cash flow ${usd(v.monthlyCashFlow)}/month.`,
    r.assumptions[0],
  );
}

export function maxOfferSummary(r: CalcResult<MaxOfferValues>): string {
  const v = r.values;
  const headline =
    v.maxPrice === null
      ? `No feasible price: the targets fail at every price tried (failing: ${v.bindingConstraint}).`
      : `Max offer: ${usd(v.maxPrice)}. Binding constraint: ${v.bindingConstraint ?? 'none, the search upper bound was reached'}.`;
  return lines(
    r,
    headline,
    r.assumptions.find((a) => a.startsWith('Max price is found by bisection')),
  );
}

const sweepKeys = [
  'vacancyPctRange',
  'interestRatePctRange',
  'monthlyRentRange',
  'operatingExpensesChangePctRange',
] as const;

export function stressTestSummary(r: CalcResult<StressTestValues>): string {
  const v = r.values;
  const breakEven = (k: string, s: Sweep) =>
    `${k.replace(/Range$/, '')} DSCR at target ${crossed(s.breakEven.dscrAtTarget)}, cash flow zero ${crossed(s.breakEven.cashFlowZero)}`;
  const sweeps = sweepKeys.flatMap((k) => (v[k] ? [breakEven(k, v[k])] : []));
  return lines(
    r,
    `Base case: DSCR ${ratio(v.base.dscr)} (${v.base.dscrMethod}), cash flow ${usd(v.base.monthlyCashFlow)}/month. Break-even: ${sweeps.join('; ')}.${v.grid ? ' Vacancy by rate grid included.' : ''}`,
    'Each sweep varies one input and holds the rest at the base case.',
  );
}

export function portfolioRollupSummary(r: CalcResult<PortfolioRollupValues>): string {
  const v = r.values;
  const weakest = v.weakest ? ` Weakest: ${v.weakest.name} at ${ratio(v.weakest.dscr)}.` : '';
  return lines(
    r,
    `Portfolio DSCR: ${ratio(v.portfolioDscr)} by the ${v.method} method, ${pass(v.passes)} the ${v.target} target, across ${v.perProperty.length} properties.${weakest}`,
    `Portfolio DSCR is total income divided by total debt service, not the average of the per-property ratios (that average is ${ratio(v.averageOfRatios)}, for comparison only).`,
  );
}
