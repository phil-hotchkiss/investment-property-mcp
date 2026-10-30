import { describe, expect, test } from 'vitest';
import { ValidationError } from '../schemas/result.js';
import { dealAnalysis } from './dealAnalysis.js';
import { maxOffer } from './maxOffer.js';

// Workings for every fixture: docs/fixtures/max-offer.md
const property = {
  monthlyRent: 3200,
  annualPropertyTax: 4800,
  annualInsurance: 1800,
  financing: { downPaymentPct: 25 },
  loan: { interestRatePct: 7.25, termYears: 30 },
  vacancyPct: 5,
  managementPct: 8,
  maintenancePct: 5,
  capexPct: 5,
  closingCostsPctOfPrice: 3,
  rehabCost: 10000,
  reservesMonthsOfPitia: 6,
};
const noTax = { ...property, annualPropertyTax: undefined };

/** dealAnalysis at a price, for checking the boundary. */
const at = (price: number, extra: object = {}) =>
  dealAnalysis({ ...property, price, dscrMethod: 'rentToPitia', ...extra }).values;

describe('fixture A: minDscr 1.25 rentToPitia', () => {
  const r = maxOffer({ ...property, dscrMethod: 'rentToPitia', targets: { minDscr: 1.25 } });

  test('max price lands just below the 400000 ask', () => {
    expect(r.values.maxPrice).toBe(392859);
    expect(r.values.feasible).toBe(true);
    expect(r.values.bindingConstraint).toBe('minDscr');
  });

  test('metrics at max price', () => {
    const m = r.values.metricsAtMaxPrice;
    expect(m?.dscr?.toFixed(6)).toBe('1.250003');
    expect(m?.dscrPasses).toBe(true);
    expect(m?.loanAmount).toBe(294644.25);
    expect(m?.monthlyPitia.toFixed(2)).toBe('2559.99');
    expect(m?.monthlyCashFlow.toFixed(2)).toBe('-95.99');
  });

  test('boundary: passes at maxPrice, fails at maxPrice + 2', () => {
    expect(at(392859).dscr).toBeGreaterThanOrEqual(1.25);
    expect(at(392861).dscr?.toFixed(6)).toBe('1.249998');
    expect(at(400000).dscr?.toFixed(4)).toBe('1.2324');
  });

  test('assumptions state the default bound and the scaling rules', () => {
    expect(r.assumptions).toEqual(
      expect.arrayContaining([
        'maxPriceBound defaulted to 20 times annual gross scheduled rent: 20 * 38400 = 768000 dollars.',
        'Scales with price (given as a percent of price): financing (downPaymentPct), closing costs.',
        'Held fixed in dollars at every price: property tax, insurance.',
      ]),
    );
    expect(r.assumptions.some((a) => a.startsWith('DSCR method rentToPitia'))).toBe(true);
  });
});

describe('single targets and all three', () => {
  test('minCashOnCashPct 2 alone; no DSCR fields without dscrMethod', () => {
    const r = maxOffer({ ...property, targets: { minCashOnCashPct: 2 } });
    expect(r.values.maxPrice).toBe(335779);
    expect(r.values.bindingConstraint).toBe('minCashOnCashPct');
    expect(r.values.metricsAtMaxPrice?.cashOnCashPct?.toFixed(4)).toBe('2.0000');
    expect(at(335781).cashOnCashPct?.toFixed(4)).toBe('1.9999');
    expect(r.values.metricsAtMaxPrice).not.toHaveProperty('dscr');
    expect(r.assumptions).toContain('DSCR not computed: no dscrMethod was given.');
    expect(r.assumptions.some((a) => a.startsWith('DSCR method'))).toBe(false);
  });

  test('without dscrMethod, DSCR warnings are dropped too', () => {
    // rentToPitia DSCR here would be below 1.0; it must not surface.
    const r = maxOffer({ ...property, monthlyRent: 2000, targets: { minMonthlyCashFlow: -1000 } });
    expect(r.values.feasible).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('DSCR'))).toBe(false);
  });

  test('minMonthlyCashFlow 100 alone', () => {
    const r = maxOffer({ ...property, targets: { minMonthlyCashFlow: 100 } });
    expect(r.values.maxPrice).toBe(354551);
    expect(r.values.bindingConstraint).toBe('minMonthlyCashFlow');
    expect(r.values.metricsAtMaxPrice?.monthlyCashFlow.toFixed(4)).toBe('100.0029');
    expect(at(354553).monthlyCashFlow.toFixed(4)).toBe('99.9927');
  });

  test('all three: the tightest target binds', () => {
    const r = maxOffer({
      ...property,
      dscrMethod: 'rentToPitia',
      targets: { minDscr: 1.25, minCashOnCashPct: 2, minMonthlyCashFlow: 100 },
    });
    expect(r.values.maxPrice).toBe(335779);
    expect(r.values.bindingConstraint).toBe('minCashOnCashPct');
    expect(r.values.metricsAtMaxPrice?.dscr?.toFixed(4)).toBe('1.4110');
  });

  test('two targets failing together are both listed', () => {
    const r = maxOffer({
      ...property,
      dscrMethod: 'rentToPitia',
      targets: { minDscr: 1.25, minMonthlyCashFlow: -96 },
    });
    expect(r.values.bindingConstraint).toBe('minDscr, minMonthlyCashFlow');
  });
});

test('property tax as percent of price scales and gives a different max price than flat tax', () => {
  const r = maxOffer({
    ...noTax,
    propertyTaxPctOfPrice: 1.2,
    dscrMethod: 'rentToPitia',
    targets: { minDscr: 1.25 },
  });
  expect(r.values.maxPrice).toBe(394027);
  const pctTax = { annualPropertyTax: undefined, propertyTaxPctOfPrice: 1.2 };
  expect(at(394027, pctTax).dscr).toBeGreaterThanOrEqual(1.25);
  expect(at(394029, pctTax).dscr).toBeLessThan(1.25);
  expect(r.assumptions).toContain(
    'Scales with price (given as a percent of price): financing (downPaymentPct), property tax, closing costs.',
  );
});

test('infeasible: targets fail even at 1 dollar', () => {
  const r = maxOffer({
    ...property,
    monthlyRent: 500,
    dscrMethod: 'rentToPitia',
    targets: { minDscr: 1.25 },
  });
  expect(r.values).toEqual({
    maxPrice: null,
    bindingConstraint: 'minDscr',
    metricsAtMaxPrice: null,
    feasible: false,
  });
  expect(r.warnings).toEqual([
    'No feasible price: the targets fail even at 1 dollar (failing: minDscr).',
  ]);
});

test('upper bound hit: targets still met, bindingConstraint null', () => {
  const r = maxOffer({
    ...property,
    dscrMethod: 'rentToPitia',
    maxPriceBound: 300000,
    targets: { minDscr: 1 },
  });
  expect(r.values.maxPrice).toBe(300000);
  expect(r.values.bindingConstraint).toBeNull();
  expect(r.values.feasible).toBe(true);
  expect(r.warnings).toContain(
    'Targets are still met at the upper bound of 300000 dollars, so the true max price is higher. Raise maxPriceBound.',
  );
  expect(r.assumptions.some((a) => a.startsWith('maxPriceBound defaulted'))).toBe(false);
});

describe('fixed-dollar financing', () => {
  test('loanAmount: warns, starts at the loan amount, still solves', () => {
    const r = maxOffer({
      ...noTax,
      propertyTaxPctOfPrice: 1.2,
      financing: { loanAmount: 280000 },
      dscrMethod: 'rentToPitia',
      targets: { minDscr: 1.25 },
    });
    expect(r.values.maxPrice).toBe(499905);
    expect(r.values.metricsAtMaxPrice?.loanAmount).toBe(280000);
    expect(r.warnings[0]).toBe(
      'Financing is a fixed loanAmount, so leverage changes with price and DSCR may not move in one direction as price rises. The solver assumes it does; check metricsAtMaxPrice.',
    );
    expect(r.assumptions).toContain(
      'Max price is found by bisection between 280000 and 768000 dollars to within 1 dollar, then rounded down to a whole dollar.',
    );
    expect(r.assumptions).toContain(
      'Held fixed in dollars at every price: financing (loanAmount), insurance.',
    );
  });

  test('loanAmount failing at the lowest price: feasible false with a warning', () => {
    // Flat tax and a fixed loan: PITIA never changes, DSCR is 1.2324 at every price.
    const r = maxOffer({
      ...property,
      financing: { loanAmount: 300000 },
      dscrMethod: 'rentToPitia',
      targets: { minDscr: 1.25 },
    });
    expect(r.values.feasible).toBe(false);
    expect(r.warnings[1]).toMatch(
      /^Targets fail at the lowest price tried \(300000 dollars; failing: minDscr\)/,
    );
  });

  test('downPaymentAmount: lowest price is the down payment plus 1 dollar', () => {
    const r = maxOffer({
      ...property,
      closingCosts: 5000,
      closingCostsPctOfPrice: undefined,
      financing: { downPaymentAmount: 100000 },
      targets: { minMonthlyCashFlow: 0 },
    });
    expect(r.values.feasible).toBe(true);
    expect(r.assumptions).toContain(
      'Max price is found by bisection between 100001 and 768000 dollars to within 1 dollar, then rounded down to a whole dollar.',
    );
    expect(r.assumptions).toContain(
      'Held fixed in dollars at every price: financing (downPaymentAmount), property tax, insurance, closing costs.',
    );
  });
});

describe('validation', () => {
  const err = (raw: object) => {
    try {
      maxOffer(raw);
    } catch (e) {
      if (e instanceof ValidationError) return e.issues;
    }
    throw new Error('expected a ValidationError');
  };
  test('no targets lists the three', () => {
    expect(err({ ...property, targets: {} })).toEqual([
      {
        path: 'targets',
        message:
          'Provide at least one of minDscr, minCashOnCashPct, minMonthlyCashFlow; none was given.',
      },
    ]);
  });
  test('minDscr without dscrMethod', () => {
    expect(err({ ...property, targets: { minDscr: 1.25 } })).toEqual([
      {
        path: 'dscrMethod',
        message:
          'dscrMethod is required when targets.minDscr is set. Use rentToPitia (gross monthly rent / PITIA) or noi (annual NOI / annual debt service).',
      },
    ]);
  });
  test('price is not an input field', () => {
    expect(() => maxOffer({ ...property, price: 1, targets: { minMonthlyCashFlow: 0 } })).toThrow(
      /price/,
    );
  });
  test('upper bound at or below the lower bound', () => {
    expect(
      err({
        ...property,
        financing: { loanAmount: 300000 },
        maxPriceBound: 250000,
        targets: { minMonthlyCashFlow: 0 },
      })[0]?.path,
    ).toBe('maxPriceBound');
    expect(
      err({ ...property, monthlyRent: 0, targets: { minMonthlyCashFlow: 0 } })[0]?.message,
    ).toBe(
      'The upper price bound (0) must be above the lowest price tried (1). Give a larger maxPriceBound.',
    );
  });
});
