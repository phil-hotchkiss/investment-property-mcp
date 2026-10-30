import { z } from 'zod';
import { exactlyOne } from './eitherOr.js';
import { money } from './money.js';
import { pct } from './percent.js';

/** Raw shape; spread into calculator inputs and add `propertyCostsChecks` to the object. */
export const propertyCostsShape = {
  annualPropertyTax: money.optional().describe('Property tax in US dollars per year.'),
  propertyTaxPctOfPrice: pct('propertyTaxPctOfPrice', { allowSubOne: true })
    .optional()
    .describe('Property tax per year as a percent number of the price, 1.2 means 1.2%.'),
  annualInsurance: money.optional().describe('Property insurance in US dollars per year.'),
  insurancePctOfPrice: pct('insurancePctOfPrice', { allowSubOne: true })
    .optional()
    .describe('Property insurance per year as a percent number of the price, 0.5 means 0.5%.'),
  monthlyHoa: money.default(0).describe('HOA dues in US dollars per month. Default 0.'),
};

export const propertyCosts = z.object(propertyCostsShape);
export type PropertyCosts = z.output<typeof propertyCosts>;

/** Either-or checks for tax and insurance; pass each to `.superRefine()`. */
export const propertyCostsChecks = [
  exactlyOne('annualPropertyTax', 'propertyTaxPctOfPrice'),
  exactlyOne('annualInsurance', 'insurancePctOfPrice'),
];

export function resolvePropertyCosts(price: number, c: PropertyCosts) {
  const assumptions: string[] = [];
  let annualTax: number;
  if (c.annualPropertyTax !== undefined) {
    annualTax = c.annualPropertyTax;
    assumptions.push(`Property tax is a flat ${annualTax} dollars per year.`);
  } else {
    annualTax = (price * (c.propertyTaxPctOfPrice ?? 0)) / 100;
    assumptions.push(
      `Property tax is ${c.propertyTaxPctOfPrice}% of price per year (${annualTax} dollars).`,
    );
  }
  let annualIns: number;
  if (c.annualInsurance !== undefined) {
    annualIns = c.annualInsurance;
    assumptions.push(`Insurance is a flat ${annualIns} dollars per year.`);
  } else {
    annualIns = (price * (c.insurancePctOfPrice ?? 0)) / 100;
    assumptions.push(
      `Insurance is ${c.insurancePctOfPrice}% of price per year (${annualIns} dollars).`,
    );
  }
  assumptions.push(c.monthlyHoa === 0 ? 'No HOA.' : `HOA is ${c.monthlyHoa} dollars per month.`);
  return {
    monthlyPropertyTax: annualTax / 12,
    monthlyInsurance: annualIns / 12,
    monthlyHoa: c.monthlyHoa,
    assumptions,
  };
}
