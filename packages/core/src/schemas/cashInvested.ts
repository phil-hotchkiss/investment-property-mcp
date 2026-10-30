import { z } from 'zod';
import { exactlyOne } from './eitherOr.js';
import { money } from './money.js';
import { pct } from './percent.js';

/** Raw shape; spread into calculator inputs and add `cashInvestedChecks` to the object. */
export const cashInvestedShape = {
  closingCosts: money.optional().describe('Closing costs in US dollars, paid once at purchase.'),
  closingCostsPctOfPrice: pct('closingCostsPctOfPrice', { allowSubOne: true })
    .optional()
    .describe('Closing costs as a percent number of the purchase price, 3 means 3%.'),
  rehabCost: money.default(0).describe('Rehab cost in US dollars, paid once. Default 0.'),
  reservesAmount: money.optional().describe('Cash reserves held back, in US dollars.'),
  reservesMonthsOfPitia: z
    .number()
    .nonnegative()
    .optional()
    .describe('Cash reserves as a number of months of PITIA, 6 means six months of PITIA.'),
};

/** Unlike tax and insurance, giving neither of a pair is allowed and means 0; both is an error. */
const atMostOne =
  (a: string, b: string) => (obj: Record<string, unknown>, ctx: z.RefinementCtx) => {
    if (obj[a] !== undefined && obj[b] !== undefined) exactlyOne(a, b)(obj, ctx);
  };

/** Pass each to `.superRefine()`. */
export const cashInvestedChecks = [
  atMostOne('closingCosts', 'closingCostsPctOfPrice'),
  atMostOne('reservesAmount', 'reservesMonthsOfPitia'),
];

export type CashInvestedFields = z.output<z.ZodObject<typeof cashInvestedShape>>;

export type ResolvedCashInvested = {
  downPaymentAmount: number;
  closingCosts: number;
  rehabCost: number;
  reserves: number;
  total: number;
  assumptions: string[];
};

export function resolveCashInvested(
  price: number,
  monthlyPitia: number,
  f: CashInvestedFields,
  downPaymentAmount: number,
): ResolvedCashInvested {
  const assumptions: string[] = [];
  let closingCosts = 0;
  if (f.closingCosts !== undefined) {
    closingCosts = f.closingCosts;
    assumptions.push(`Closing costs are a flat ${closingCosts} dollars.`);
  } else if (f.closingCostsPctOfPrice !== undefined) {
    closingCosts = (price * f.closingCostsPctOfPrice) / 100;
    assumptions.push(
      `Closing costs are ${f.closingCostsPctOfPrice}% of price (${closingCosts} dollars).`,
    );
  } else assumptions.push('Closing costs assumed 0.');

  assumptions.push(f.rehabCost === 0 ? 'No rehab cost.' : `Rehab cost is ${f.rehabCost} dollars.`);

  let reserves = 0;
  if (f.reservesAmount !== undefined) {
    reserves = f.reservesAmount;
    assumptions.push(`Reserves are a flat ${reserves} dollars.`);
  } else if (f.reservesMonthsOfPitia !== undefined) {
    reserves = f.reservesMonthsOfPitia * monthlyPitia;
    assumptions.push(
      `Reserves are ${f.reservesMonthsOfPitia} months of PITIA (${reserves} dollars).`,
    );
  } else assumptions.push('Reserves assumed 0.');

  return {
    downPaymentAmount,
    closingCosts,
    rehabCost: f.rehabCost,
    reserves,
    total: downPaymentAmount + closingCosts + f.rehabCost + reserves,
    assumptions,
  };
}
