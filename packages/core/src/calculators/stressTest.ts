import { z } from 'zod';
import type { DealAnalysisValues, StressTestValues } from '../schemas/outputs.js';
import { money } from '../schemas/money.js';
import { pct } from '../schemas/percent.js';
import { type CalcResult, parseInput } from '../schemas/result.js';
import { bisect } from '../solve/bisection.js';
import { dealChecks } from './cashOnCash.js';
import { computeDealAnalysis, dealAnalysisShape } from './dealAnalysis.js';

function range(field: string, value: (name: string) => z.ZodType<number>, unit: string) {
  return z
    .object({
      min: value(`${field}.min`).describe(`Lowest value to try, ${unit}.`),
      max: value(`${field}.max`).describe(`Highest value to try, ${unit}.`),
      steps: z
        .number()
        .int()
        .min(2)
        .max(25)
        .default(5)
        .describe('How many evenly spaced values from min to max, inclusive. 2 to 25, default 5.'),
    })
    .superRefine((r, ctx) => {
      if (r.min >= r.max)
        ctx.addIssue({
          code: 'custom',
          message: `${field}.min (${r.min}) must be less than ${field}.max (${r.max}).`,
        });
    })
    .optional();
}

const opexChangeNote =
  'A percent change applied to every operating expense except vacancy and debt service: property tax, insurance, HOA, management, maintenance, capex, and owner-paid utilities. -20 means 20% lower, 10 means 10% higher.';

const rangeShape = {
  vacancyPctRange: range(
    'vacancyPctRange',
    (n) => pct(n, { allowSubOne: true }),
    'vacancy as a percent number of gross rent, 5 means 5%',
  ).describe('Optional sweep of vacancyPct.'),
  interestRatePctRange: range(
    'interestRatePctRange',
    (n) => pct(n),
    'annual interest rate as a percent number, 7.25 means 7.25%',
  ).describe('Optional sweep of the loan interestRatePct.'),
  monthlyRentRange: range('monthlyRentRange', () => money, 'rent in US dollars per month').describe(
    'Optional sweep of the rent used, in US dollars per month.',
  ),
  operatingExpensesChangePctRange: range(
    'operatingExpensesChangePctRange',
    () => z.number().min(-100),
    'percent change, -20 means 20% lower',
  ).describe(`Optional sweep. ${opexChangeNote}`),
};

type RangeKey = keyof typeof rangeShape;
const rangeKeys = Object.keys(rangeShape) as RangeKey[];

export const stressTestInput = z
  .object({ ...dealAnalysisShape, ...rangeShape })
  .superRefine((v, ctx) => {
    dealChecks.forEach((check) => check(v, ctx));
    if (rangeKeys.every((k) => v[k] === undefined))
      ctx.addIssue({
        code: 'custom',
        message: `Provide at least one of ${rangeKeys.join(', ')}; none was given.`,
      });
  });

export type StressTestInput = z.input<typeof stressTestInput>;
type Parsed = z.output<typeof stressTestInput>;

const apply: Record<RangeKey, (x: Parsed, v: number) => Parsed> = {
  vacancyPctRange: (x, v) => ({ ...x, vacancyPct: v }),
  interestRatePctRange: (x, v) => ({ ...x, loan: { ...x.loan, interestRatePct: v } }),
  monthlyRentRange: (x, v) => ({
    ...x,
    monthlyRent: v,
    monthlyMarketRent: undefined,
    rentBasis: undefined,
  }),
  operatingExpensesChangePctRange: (x, v) => {
    const m = 1 + v / 100;
    const mul = (n: number | undefined) => (n === undefined ? undefined : n * m);
    return {
      ...x,
      annualPropertyTax: mul(x.annualPropertyTax),
      propertyTaxPctOfPrice: mul(x.propertyTaxPctOfPrice),
      annualInsurance: mul(x.annualInsurance),
      insurancePctOfPrice: mul(x.insurancePctOfPrice),
      monthlyHoa: x.monthlyHoa * m,
      managementPct: x.managementPct * m,
      maintenancePct: x.maintenancePct * m,
      capexPct: x.capexPct * m,
      monthlyOwnerPaidUtilities: x.monthlyOwnerPaidUtilities * m,
    };
  },
};

const label = (k: RangeKey) => k.replace(/Range$/, '');
const steps = (r: { min: number; max: number; steps: number }) =>
  Array.from({ length: r.steps }, (_, i) => r.min + ((r.max - r.min) * i) / (r.steps - 1));

export function stressTest(raw: unknown): CalcResult<StressTestValues> {
  const x = parseInput(stressTestInput, raw);
  const base = computeDealAnalysis(x);
  const deal = (input: Parsed) => computeDealAnalysis(input).values;
  const values: StressTestValues = { base: base.values };
  const assumptions = [
    ...base.assumptions,
    'Each sweep changes one input and holds the rest at the base case. Each range is sampled at steps evenly spaced values from min to max, inclusive.',
    'Break-even values are found by bisection inside each range to within one millionth of its width. dscrAtTarget is where DSCR crosses the target; cashFlowZero is where monthly cash flow crosses 0.',
  ];
  const warnings = [...base.warnings];

  for (const k of rangeKeys) {
    const r = x[k];
    if (!r) continue;
    const at = (v: number) => deal(apply[k](x, v));
    // Last value on the same side of the threshold as min; null when max is still on that side.
    const crossing = (meets: (d: DealAnalysisValues) => boolean) => {
      const start = meets(at(r.min));
      const b = bisect((v) => meets(at(v)) === start, r.min, r.max, {
        toleranceAbs: (r.max - r.min) * 1e-6,
      });
      return b.hitUpperBound ? null : b.x;
    };
    const dscrAtTarget = crossing((d) => d.dscrPasses);
    const cashFlowZero = crossing((d) => d.monthlyCashFlow >= 0);
    const span = `${label(k)} between ${r.min} and ${r.max}`;
    if (dscrAtTarget === null)
      warnings.push(
        `DSCR does not cross the target ${x.dscrTarget} for ${span}.` +
          (k === 'vacancyPctRange' && x.dscrMethod === 'rentToPitia'
            ? ' The rentToPitia method uses gross rent, so vacancy does not change it.'
            : ''),
      );
    if (cashFlowZero === null) warnings.push(`Monthly cash flow does not cross 0 for ${span}.`);

    values[k] = {
      points: steps(r).map((value) => {
        const d = at(value);
        return { value, dscr: d.dscr, monthlyCashFlow: d.monthlyCashFlow, passes: d.dscrPasses };
      }),
      breakEven: { dscrAtTarget, cashFlowZero },
    };
  }

  if (x.monthlyRentRange)
    assumptions.push(
      'The rent sweep sets the rent used directly; monthlyMarketRent and rentBasis are ignored during it.',
    );
  if (x.operatingExpensesChangePctRange)
    assumptions.push(
      `The operating expense sweep multiplies each expense by (1 + change / 100). ${opexChangeNote}`,
    );

  if (x.vacancyPctRange && x.interestRatePctRange) {
    const rows = steps(x.vacancyPctRange);
    const cols = steps(x.interestRatePctRange);
    const cells = rows.map((v) =>
      cols.map((rate) => deal(apply.interestRatePctRange(apply.vacancyPctRange(x, v), rate))),
    );
    values.grid = {
      rows,
      cols,
      dscr: cells.map((row) => row.map((d) => d.dscr)),
      monthlyCashFlow: cells.map((row) => row.map((d) => d.monthlyCashFlow)),
    };
    assumptions.push('grid rows are vacancyPct values and columns are interestRatePct values.');
  }

  return { values, assumptions, warnings };
}
