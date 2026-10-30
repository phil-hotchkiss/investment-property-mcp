import { z } from 'zod';
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

const methods = {
  rentToPitia:
    'DSCR method rentToPitia: gross monthly rent divided by monthly PITIA (principal, interest, taxes, insurance, HOA).',
  noi: 'DSCR method noi: annual net operating income divided by annual debt service (principal and interest).',
};

export const dscrInput = z
  .object({
    price: price.describe('Purchase price in US dollars.'),
    ...rentShape,
    ...propertyCostsShape,
    financing,
    loan,
    method: z
      .enum(['rentToPitia', 'noi'])
      .describe(
        'Required, no default. rentToPitia: gross monthly rent / PITIA, the common DSCR-loan method. noi: annual NOI / annual debt service, the traditional commercial method.',
      ),
    target: z
      .number()
      .positive()
      .default(1.25)
      .describe('Minimum DSCR ratio to pass, e.g. 1.25. A ratio, not a percent. Default 1.25.'),
    ...operatingExpensesShape,
  })
  .superRefine((v, ctx) => propertyCostsChecks.forEach((check) => check(v, ctx)));

export type DscrInput = z.input<typeof dscrInput>;

export type DscrValues = {
  /** null when the denominator (PITIA or annual debt service) is 0. */
  dscr: number | null;
  method: 'rentToPitia' | 'noi';
  passes: boolean;
  target: number;
  monthlyRentUsed: number;
  monthlyPitia: number;
  monthlyDebtService: number;
  /** Only for the noi method. */
  annualNoi?: number;
  loanAmount: number;
  ltvPct: number;
  downPaymentAmount: number;
  downPaymentPct: number;
};

export function dscr(raw: unknown): CalcResult<DscrValues> {
  const x = parseInput(dscrInput, raw);
  const fin = resolveFinancing(x.price, x.financing);
  const costs = resolvePropertyCosts(x.price, x);
  const rent = resolveRent(x);
  const pay = loanPayment({ loanAmount: fin.loanAmount, ...x.loan });

  const monthlyDebtService = pay.values.monthlyPayment;
  const monthlyPitia =
    monthlyDebtService + costs.monthlyPropertyTax + costs.monthlyInsurance + costs.monthlyHoa;
  const assumptions = [
    methods[x.method],
    rent.assumption,
    ...pay.assumptions,
    ...costs.assumptions,
  ];
  const warnings: string[] = [];

  let ratio: number | null;
  let annualNoi: number | undefined;
  if (x.method === 'rentToPitia') {
    const keys = Object.keys(operatingExpensesShape) as (keyof typeof operatingExpensesShape)[];
    const ignored = keys.filter((k) => x[k] !== 0);
    if (ignored.length)
      assumptions.push(`Ignored ${ignored.join(', ')}: the rentToPitia method does not use them.`);
    ratio = monthlyPitia > 0 ? rent.monthlyRentUsed / monthlyPitia : null;
    if (ratio === null) warnings.push('PITIA is 0, so DSCR is undefined.');
  } else {
    annualNoi = computeNoi({ ...x, ...costs, monthlyGrossRent: rent.monthlyRentUsed });
    assumptions.push(noiAssumption);
    ratio = monthlyDebtService > 0 ? annualNoi / (monthlyDebtService * 12) : null;
    if (ratio === null) warnings.push('Annual debt service is 0, so DSCR is undefined.');
  }

  if (ratio !== null && ratio < 1)
    warnings.push(`DSCR is ${ratio.toFixed(2)}, below 1.0: income does not cover the debt.`);
  if (fin.ltvPct > 80) warnings.push(`LTV is ${fin.ltvPct.toFixed(2)}%, above 80%.`);

  return {
    values: {
      dscr: ratio,
      method: x.method,
      passes: ratio !== null && ratio >= x.target,
      target: x.target,
      monthlyRentUsed: rent.monthlyRentUsed,
      monthlyPitia,
      monthlyDebtService,
      ...(annualNoi !== undefined && { annualNoi }),
      ...fin,
    },
    assumptions,
    warnings,
  };
}
