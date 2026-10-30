import { z } from 'zod';
import type { MaxOfferMetrics, MaxOfferValues } from '../schemas/outputs.js';
import { pct } from '../schemas/percent.js';
import { resolveRent } from '../schemas/rent.js';
import { type CalcResult, parseInput, ValidationError } from '../schemas/result.js';
import { bisect } from '../solve/bisection.js';
import { dealChecks, dealShape } from './cashOnCash.js';
import { computeDealAnalysis } from './dealAnalysis.js';

const TOLERANCE = 1;
const targetNames = ['minDscr', 'minCashOnCashPct', 'minMonthlyCashFlow'] as const;
type TargetName = (typeof targetNames)[number];

export const maxOfferInput = z
  .object(dealShape)
  .omit({ price: true })
  .extend({
    targets: z
      .object({
        minDscr: z
          .number()
          .positive()
          .optional()
          .describe('Minimum DSCR ratio, e.g. 1.25. A ratio, not a percent. Needs dscrMethod.'),
        minCashOnCashPct: pct('minCashOnCashPct')
          .optional()
          .describe('Minimum cash-on-cash return as a percent number per year, 8 means 8%.'),
        minMonthlyCashFlow: z
          .number()
          .optional()
          .describe('Minimum pre-tax cash flow in US dollars per month. May be negative.'),
      })
      .describe('What the deal must hit. Provide at least one of the three.'),
    dscrMethod: z
      .enum(['rentToPitia', 'noi'])
      .optional()
      .describe(
        'Required when targets.minDscr is set, no default. rentToPitia: gross monthly rent / PITIA, the common DSCR-loan method. noi: annual NOI / annual debt service, the traditional commercial method.',
      ),
    maxPriceBound: z
      .number()
      .positive()
      .optional()
      .describe(
        'Highest purchase price in US dollars the solver will try. Default 20 times annual gross scheduled rent.',
      ),
  })
  .superRefine((v, ctx) => {
    dealChecks.forEach((check) => check(v, ctx));
    if (targetNames.every((k) => v.targets[k] === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['targets'],
        message: `Provide at least one of ${targetNames.join(', ')}; none was given.`,
      });
    if (v.targets.minDscr !== undefined && v.dscrMethod === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['dscrMethod'],
        message:
          'dscrMethod is required when targets.minDscr is set. Use rentToPitia (gross monthly rent / PITIA) or noi (annual NOI / annual debt service).',
      });
  });

export type MaxOfferInput = z.input<typeof maxOfferInput>;

export function maxOffer(raw: unknown): CalcResult<MaxOfferValues> {
  const x = parseInput(maxOfferInput, raw);
  const t = x.targets;
  const fin = x.financing;
  const fixedFinancing =
    fin.loanAmount !== undefined
      ? 'loanAmount'
      : fin.downPaymentAmount !== undefined
        ? 'downPaymentAmount'
        : null;

  // dealAnalysis needs a method; without one the DSCR fields are computed and then dropped.
  const deal = (price: number) =>
    computeDealAnalysis({
      ...x,
      price,
      dscrMethod: x.dscrMethod ?? 'rentToPitia',
      dscrTarget: t.minDscr ?? 1.25,
    });
  const failing = (price: number): TargetName[] => {
    // Never throws: the lowest price tried keeps any fixed loan at or below price.
    const v = deal(price).values;
    const fails: TargetName[] = [];
    if (t.minDscr !== undefined && !(v.dscr !== null && v.dscr >= t.minDscr)) fails.push('minDscr');
    if (
      t.minCashOnCashPct !== undefined &&
      !(v.cashOnCashPct !== null && v.cashOnCashPct >= t.minCashOnCashPct)
    )
      fails.push('minCashOnCashPct');
    if (t.minMonthlyCashFlow !== undefined && v.monthlyCashFlow < t.minMonthlyCashFlow)
      fails.push('minMonthlyCashFlow');
    return fails;
  };

  const assumptions: string[] = [];
  const warnings: string[] = [];

  // Price below a fixed loan is invalid; price equal to a fixed down payment means no loan at all.
  const low =
    fin.loanAmount !== undefined
      ? Math.max(1, fin.loanAmount)
      : fin.downPaymentAmount !== undefined
        ? fin.downPaymentAmount + 1
        : 1;
  let high = x.maxPriceBound;
  if (high === undefined) {
    const annualRent = resolveRent(x).monthlyRentUsed * 12;
    high = annualRent * 20;
    assumptions.push(
      `maxPriceBound defaulted to 20 times annual gross scheduled rent: 20 * ${annualRent} = ${high} dollars.`,
    );
  }
  if (high <= low)
    throw new ValidationError([
      {
        path: 'maxPriceBound',
        message: `The upper price bound (${high}) must be above the lowest price tried (${low}). Give a larger maxPriceBound.`,
      },
    ]);
  assumptions.push(
    `Max price is found by bisection between ${low} and ${high} dollars to within ${TOLERANCE} dollar, then rounded down to a whole dollar.`,
    ...scalingAssumptions(x),
  );
  if (fixedFinancing)
    warnings.push(
      `Financing is a fixed ${fixedFinancing}, so leverage changes with price and DSCR may not move in one direction as price rises. The solver assumes it does; check metricsAtMaxPrice.`,
    );

  const r = bisect((p) => failing(p).length === 0, low, high, { toleranceAbs: TOLERANCE });

  if (r.hitLowerBound) {
    const fails = failing(low);
    warnings.push(
      fixedFinancing
        ? `Targets fail at the lowest price tried (${low} dollars; failing: ${fails.join(', ')}). With a fixed ${fixedFinancing} a higher price might still pass, but the solver cannot search a range where results do not move in one direction. Try downPaymentPct or ltvPct.`
        : `No feasible price: the targets fail even at ${low} dollar (failing: ${fails.join(', ')}).`,
    );
    return {
      values: {
        maxPrice: null,
        bindingConstraint: fails.join(', '),
        metricsAtMaxPrice: null,
        feasible: false,
      },
      assumptions,
      warnings,
    };
  }

  const maxPrice = r.hitUpperBound ? high : Math.floor(r.x);
  let bindingConstraint: string | null = null;
  if (r.hitUpperBound)
    warnings.push(
      `Targets are still met at the upper bound of ${high} dollars, so the true max price is higher. Raise maxPriceBound.`,
    );
  else bindingConstraint = failing(maxPrice + TOLERANCE * 2).join(', ') || null;

  const atMax = deal(maxPrice);
  const metrics: MaxOfferMetrics = { ...atMax.values };
  let dealAssumptions = atMax.assumptions;
  if (x.dscrMethod === undefined) {
    delete metrics.dscr;
    delete metrics.dscrMethod;
    delete metrics.dscrPasses;
    dealAssumptions = dealAssumptions.filter((a) => !a.startsWith('DSCR '));
    assumptions.push('DSCR not computed: no dscrMethod was given.');
  }

  return {
    values: {
      maxPrice,
      bindingConstraint,
      metricsAtMaxPrice: metrics,
      feasible: true,
    },
    assumptions: [...assumptions, ...dealAssumptions],
    warnings: [
      ...warnings,
      ...(x.dscrMethod === undefined
        ? atMax.warnings.filter((w) => !w.startsWith('DSCR '))
        : atMax.warnings),
    ],
  };
}

function scalingAssumptions(x: z.output<typeof maxOfferInput>): string[] {
  const scales: string[] = [];
  const fixed: string[] = [];
  const f = x.financing;
  if (f.downPaymentPct !== undefined) scales.push('financing (downPaymentPct)');
  else if (f.ltvPct !== undefined) scales.push('financing (ltvPct)');
  else fixed.push(`financing (${f.loanAmount !== undefined ? 'loanAmount' : 'downPaymentAmount'})`);
  (x.propertyTaxPctOfPrice !== undefined ? scales : fixed).push('property tax');
  (x.insurancePctOfPrice !== undefined ? scales : fixed).push('insurance');
  if (x.closingCostsPctOfPrice !== undefined) scales.push('closing costs');
  else if (x.closingCosts !== undefined) fixed.push('closing costs');
  const out = [];
  if (scales.length)
    out.push(`Scales with price (given as a percent of price): ${scales.join(', ')}.`);
  if (fixed.length) out.push(`Held fixed in dollars at every price: ${fixed.join(', ')}.`);
  out.push(
    'Rent, HOA, rehab, and the expense percents of rent do not depend on price. Reserves given in months of PITIA follow PITIA.',
  );
  return out;
}
