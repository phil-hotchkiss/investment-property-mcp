import { z } from 'zod';
import { money } from './money.js';
import { ValidationError } from './result.js';

export const rentShape = {
  monthlyRent: money.describe(
    'Lease or expected rent in US dollars per month, all units combined.',
  ),
  monthlyMarketRent: money
    .optional()
    .describe('Market rent in US dollars per month, all units combined, e.g. from an appraisal.'),
  rentBasis: z
    .enum(['lease', 'market', 'lesser'])
    .optional()
    .describe(
      'Which rent to use: lease (monthlyRent), market (monthlyMarketRent), or lesser of the two. Default: lesser when monthlyMarketRent is given, otherwise lease.',
    ),
};

export const rent = z.object(rentShape);
export type Rent = z.output<typeof rent>;

export function resolveRent(r: Rent): { monthlyRentUsed: number; assumption: string } {
  const market = r.monthlyMarketRent;
  if (market === undefined) {
    if (r.rentBasis === 'market') {
      throw new ValidationError([
        {
          path: 'monthlyMarketRent',
          message: 'rentBasis is market but monthlyMarketRent was not given.',
        },
      ]);
    }
    return {
      monthlyRentUsed: r.monthlyRent,
      assumption: `Rent basis: lease rent of ${r.monthlyRent} dollars per month (no market rent given).`,
    };
  }
  const basis = r.rentBasis ?? 'lesser';
  const why = r.rentBasis ? '' : ' (default because market rent was given and rentBasis was not)';
  if (basis === 'lease')
    return {
      monthlyRentUsed: r.monthlyRent,
      assumption: `Rent basis: lease rent of ${r.monthlyRent} dollars per month.`,
    };
  if (basis === 'market')
    return {
      monthlyRentUsed: market,
      assumption: `Rent basis: market rent of ${market} dollars per month.`,
    };
  const used = Math.min(r.monthlyRent, market);
  return {
    monthlyRentUsed: used,
    assumption: `Rent basis: lesser of lease (${r.monthlyRent}) and market (${market}) rent, ${used} dollars per month${why}.`,
  };
}
