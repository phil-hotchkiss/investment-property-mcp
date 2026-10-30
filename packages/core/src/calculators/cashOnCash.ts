import { z } from 'zod';
import {
  cashInvestedChecks,
  cashInvestedShape,
  resolveCashInvested,
} from '../schemas/cashInvested.js';
import { computeNoi, noiAssumption, operatingExpensesShape } from '../schemas/expenses.js';
import { financing, resolveFinancing } from '../schemas/financing.js';
import { loan } from '../schemas/loan.js';
import { price } from '../schemas/money.js';
import {
  propertyCostsChecks,
  propertyCostsShape,
  resolvePropertyCosts,
} from '../schemas/property.js';
import { resolveRent, rentShape } from '../schemas/rent.js';
import { type CalcResult, parseInput } from '../schemas/result.js';
import { loanPayment } from './loanPayment.js';

/** Fields shared by cashOnCash and dealAnalysis. */
export const dealShape = {
  price: price.describe('Purchase price in US dollars.'),
  ...rentShape,
  ...propertyCostsShape,
  ...operatingExpensesShape,
  financing,
  loan,
  ...cashInvestedShape,
};

export const dealChecks = [...propertyCostsChecks, ...cashInvestedChecks];

export const cashOnCashInput = z
  .object(dealShape)
  .superRefine((v, ctx) => dealChecks.forEach((check) => check(v, ctx)));

export type CashOnCashInput = z.input<typeof cashOnCashInput>;

export type CashOnCashValues = {
  annualNoi: number;
  annualDebtService: number;
  /** NOI minus debt service, pre-tax. */
  annualCashFlow: number;
  monthlyCashFlow: number;
  monthlyPitia: number;
  monthlyRentUsed: number;
  totalCashInvested: number;
  downPaymentAmount: number;
  closingCosts: number;
  rehabCost: number;
  reserves: number;
  /** Percent number, 6.4 means 6.4%. null when total cash invested is 0. */
  cashOnCashPct: number | null;
  loanAmount: number;
  ltvPct: number;
};

export function cashOnCash(raw: unknown): CalcResult<CashOnCashValues> {
  return computeCashOnCash(parseInput(cashOnCashInput, raw));
}

/** The math behind `cashOnCash`, on already-parsed input. Exported so dealAnalysis reuses it. */
export function computeCashOnCash(
  x: z.output<typeof cashOnCashInput>,
): CalcResult<CashOnCashValues> {
  const fin = resolveFinancing(x.price, x.financing);
  const costs = resolvePropertyCosts(x.price, x);
  const rent = resolveRent(x);
  const pay = loanPayment({ loanAmount: fin.loanAmount, ...x.loan });
  const monthlyDebtService = pay.values.monthlyPayment;
  const monthlyPitia =
    monthlyDebtService + costs.monthlyPropertyTax + costs.monthlyInsurance + costs.monthlyHoa;
  const cash = resolveCashInvested(x.price, monthlyPitia, x, fin.downPaymentAmount);

  const annualNoi = computeNoi({ ...x, ...costs, monthlyGrossRent: rent.monthlyRentUsed });
  const annualDebtService = monthlyDebtService * 12;
  const annualCashFlow = annualNoi - annualDebtService;

  const warnings: string[] = [];
  if (annualCashFlow < 0)
    warnings.push(`Annual cash flow is negative (${annualCashFlow.toFixed(2)} dollars).`);
  if (fin.ltvPct > 80) warnings.push(`LTV is ${fin.ltvPct.toFixed(2)}%, above 80%.`);
  if (cash.total === 0) warnings.push('Total cash invested is 0, so cash-on-cash is undefined.');

  return {
    values: {
      annualNoi,
      annualDebtService,
      annualCashFlow,
      monthlyCashFlow: annualCashFlow / 12,
      monthlyPitia,
      monthlyRentUsed: rent.monthlyRentUsed,
      totalCashInvested: cash.total,
      downPaymentAmount: cash.downPaymentAmount,
      closingCosts: cash.closingCosts,
      rehabCost: cash.rehabCost,
      reserves: cash.reserves,
      cashOnCashPct: cash.total > 0 ? (annualCashFlow / cash.total) * 100 : null,
      loanAmount: fin.loanAmount,
      ltvPct: fin.ltvPct,
    },
    assumptions: [
      rent.assumption,
      ...pay.assumptions,
      ...costs.assumptions,
      noiAssumption,
      'Cash-on-cash = annual pre-tax cash flow divided by total cash invested (down payment + closing costs + rehab + reserves).',
      ...cash.assumptions,
    ],
    warnings,
  };
}
