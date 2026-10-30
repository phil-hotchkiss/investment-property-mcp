import { z } from 'zod';
import { money } from './money.js';
import { pct } from './percent.js';

const ofGross = 'Convention: applied to gross scheduled rent, before vacancy.';

export const operatingExpensesShape = {
  vacancyPct: pct('vacancyPct', { allowSubOne: true })
    .default(0)
    .describe('Vacancy and credit loss as a percent number of gross scheduled rent, 5 means 5%.'),
  managementPct: pct('managementPct', { allowSubOne: true })
    .default(0)
    .describe(`Property management as a percent number, 8 means 8%. ${ofGross}`),
  maintenancePct: pct('maintenancePct', { allowSubOne: true })
    .default(0)
    .describe(`Maintenance and repairs as a percent number, 5 means 5%. ${ofGross}`),
  capexPct: pct('capexPct', { allowSubOne: true })
    .default(0)
    .describe(`Capital expenditure reserves as a percent number, 5 means 5%. ${ofGross}`),
  monthlyOtherIncome: money
    .default(0)
    .describe(
      'Other income (laundry, parking, fees) in US dollars per month. Not reduced by vacancy.',
    ),
  monthlyOwnerPaidUtilities: money
    .default(0)
    .describe('Utilities paid by the owner in US dollars per month.'),
};

export const operatingExpenses = z.object(operatingExpensesShape);
export type OperatingExpenses = z.output<typeof operatingExpenses>;

export const noiAssumption =
  'NOI = gross rent minus vacancy, plus other income, minus taxes, insurance, HOA, management, maintenance, capex reserves, and owner-paid utilities. Vacancy, management, maintenance, and capex percents apply to gross scheduled rent. NOI excludes debt service.';

/** Annual net operating income. Inputs are monthly; excludes debt service. */
export function computeNoi(
  x: OperatingExpenses & {
    monthlyGrossRent: number;
    monthlyPropertyTax: number;
    monthlyInsurance: number;
    monthlyHoa: number;
  },
): number {
  const rent = x.monthlyGrossRent;
  const pctOfRent = (rent * (x.managementPct + x.maintenancePct + x.capexPct)) / 100;
  const opex =
    x.monthlyPropertyTax +
    x.monthlyInsurance +
    x.monthlyHoa +
    pctOfRent +
    x.monthlyOwnerPaidUtilities;
  return (rent - (rent * x.vacancyPct) / 100 + x.monthlyOtherIncome - opex) * 12;
}
