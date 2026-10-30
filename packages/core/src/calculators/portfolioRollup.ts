import { z } from 'zod';
import type { PortfolioProperty, PortfolioRollupValues } from '../schemas/outputs.js';
import { noiAssumption } from '../schemas/expenses.js';
import { propertyCostsChecks } from '../schemas/property.js';
import { type CalcResult, parseInput } from '../schemas/result.js';
import { computeDscr, dscrMethod, dscrPropertyShape, dscrTarget } from './dscr.js';

export const portfolioRollupInput = z.object({
  method: dscrMethod.describe(
    'Required, no default, applies to every property. rentToPitia: total gross monthly rent / total PITIA, the common DSCR-loan method. noi: total annual NOI / total annual debt service, the traditional commercial method.',
  ),
  target: dscrTarget.describe(
    'Minimum DSCR ratio to pass, for the portfolio and each property, e.g. 1.25. A ratio, not a percent. Default 1.25.',
  ),
  properties: z
    .array(
      z
        .object({
          name: z
            .string()
            .optional()
            .describe('Label for this property. Default "Property N", N counting from 1.'),
          ...dscrPropertyShape,
        })
        .superRefine((v, ctx) => propertyCostsChecks.forEach((check) => check(v, ctx))),
    )
    .min(1)
    .max(50)
    .describe(
      'Each property, 1 to 50, with the same fields as the dscr tool minus method and target.',
    ),
});

export type PortfolioRollupInput = z.input<typeof portfolioRollupInput>;

export function portfolioRollup(raw: unknown): CalcResult<PortfolioRollupValues> {
  const x = parseInput(portfolioRollupInput, raw);
  const assumptions: string[] = [];
  let income = 0;
  let debt = 0;

  const perProperty = x.properties.map((p, i): PortfolioProperty => {
    const name = p.name ?? `Property ${i + 1}`;
    const d = computeDscr({ ...p, method: x.method, target: x.target });
    // The first assumption is the method line, stated once for the portfolio below.
    assumptions.push(
      ...d.assumptions
        .slice(1)
        .filter((a) => a !== noiAssumption)
        .map((a) => `${name}: ${a}`),
    );
    const v = d.values;
    const base = { name, dscr: v.dscr, passes: v.passes, monthlyRentUsed: v.monthlyRentUsed };
    if (x.method === 'rentToPitia') {
      income += v.monthlyRentUsed;
      debt += v.monthlyPitia;
      return { ...base, monthlyPitia: v.monthlyPitia };
    }
    const annualNoi = v.annualNoi ?? 0;
    const annualDebtService = v.monthlyDebtService * 12;
    income += annualNoi;
    debt += annualDebtService;
    return { ...base, annualNoi, annualDebtService };
  });

  const portfolioDscr = debt > 0 ? income / debt : null;
  const rated = perProperty.filter(
    (p): p is PortfolioProperty & { dscr: number } => p.dscr !== null,
  );
  const weakest = rated.length ? rated.reduce((a, b) => (b.dscr < a.dscr ? b : a)) : null;

  const warnings: string[] = [];
  if (portfolioDscr === null)
    warnings.push('Total debt service is 0, so portfolio DSCR is undefined.');
  else if (portfolioDscr < 1)
    warnings.push(
      `Portfolio DSCR is ${portfolioDscr.toFixed(2)}, below 1.0: total income does not cover total debt.`,
    );
  const below = rated.filter((p) => p.dscr < 1);
  if (below.length)
    warnings.push(
      `Below 1.0 DSCR: ${below.map((p) => `${p.name} (${p.dscr.toFixed(2)})`).join(', ')}.`,
    );
  const nulls = perProperty.filter((p) => p.dscr === null);
  if (nulls.length)
    warnings.push(
      `DSCR is undefined (zero debt service) for: ${nulls.map((p) => p.name).join(', ')}.`,
    );

  return {
    values: {
      portfolioDscr,
      method: x.method,
      target: x.target,
      passes: portfolioDscr !== null && portfolioDscr >= x.target,
      perProperty,
      weakest: weakest && { name: weakest.name, dscr: weakest.dscr },
      averageOfRatios: rated.length ? rated.reduce((s, p) => s + p.dscr, 0) / rated.length : null,
    },
    assumptions: [
      x.method === 'rentToPitia'
        ? 'DSCR method rentToPitia: total gross monthly rent used divided by total monthly PITIA, across all properties.'
        : 'DSCR method noi: total annual NOI divided by total annual debt service, across all properties.',
      `DSCR target is ${x.target}, for the portfolio and each property.`,
      'Portfolio DSCR is total income divided by total debt service. It is not the average of the per-property ratios; that figure is returned as averageOfRatios for comparison only.',
      ...(x.method === 'noi' ? [noiAssumption] : []),
      ...assumptions,
    ],
    warnings,
  };
}
