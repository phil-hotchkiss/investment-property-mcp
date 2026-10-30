import { describe, expect, test } from 'vitest';
import { ValidationError } from '../schemas/result.js';
import { noiAssumption } from '../schemas/expenses.js';
import { dscr } from './dscr.js';
import { portfolioRollup } from './portfolioRollup.js';

// Workings for every fixture: docs/fixtures/portfolio-rollup.md
const common = {
  financing: { downPaymentPct: 25 },
  loan: { interestRatePct: 7.25, termYears: 30 },
  vacancyPct: 5,
  managementPct: 8,
  maintenancePct: 5,
  capexPct: 5,
};
const base = { price: 400000, monthlyRent: 3200, annualPropertyTax: 4800, annualInsurance: 1800 };
const strong = { price: 250000, monthlyRent: 2900, annualPropertyTax: 3000, annualInsurance: 1200 };
const weak = { price: 500000, monthlyRent: 2800, annualPropertyTax: 6000, annualInsurance: 2400 };
const properties = [
  { name: 'Base', ...base, ...common },
  { name: 'Strong', ...strong, ...common },
  { name: 'Weak', ...weak, ...common },
];

describe('fixture A: rentToPitia, base plus strong plus weak', () => {
  const r = portfolioRollup({ method: 'rentToPitia', properties });
  const v = r.values;

  test('per property', () => {
    expect(v.perProperty.map((p) => p.dscr?.toFixed(4))).toEqual(['1.2324', '1.7801', '0.8594']);
    expect(v.perProperty.map((p) => p.monthlyPitia?.toFixed(2))).toEqual([
      '2596.53',
      '1629.08',
      '3258.16',
    ]);
    expect(v.perProperty.map((p) => p.passes)).toEqual([false, true, false]);
    expect(v.perProperty[0]).not.toHaveProperty('annualNoi');
  });

  test('portfolio DSCR is total over total, and differs from the average', () => {
    expect(v.portfolioDscr?.toFixed(4)).toBe('1.1892');
    expect(v.averageOfRatios?.toFixed(4)).toBe('1.2906');
    // The trap: the average clears 1.25, the portfolio does not.
    expect(v.passes).toBe(false);
    expect(v.averageOfRatios!).toBeGreaterThan(1.25);
    expect(v.weakest).toEqual({ name: 'Weak', dscr: v.perProperty[2]!.dscr });
  });

  test('matches dscr per property', () => {
    expect(v.perProperty[1]!.dscr).toBe(
      dscr({ ...strong, ...common, method: 'rentToPitia' }).values.dscr,
    );
  });

  test('assumptions and warnings', () => {
    expect(r.assumptions).toContain(
      'Portfolio DSCR is total income divided by total debt service. It is not the average of the per-property ratios; that figure is returned as averageOfRatios for comparison only.',
    );
    expect(r.assumptions[0]).toContain('DSCR method rentToPitia');
    expect(r.assumptions).toContain('Strong: Property tax is a flat 3000 dollars per year.');
    expect(r.warnings).toEqual(['Below 1.0 DSCR: Weak (0.86).']);
  });
});

describe('fixture B: noi method', () => {
  const r = portfolioRollup({ method: 'noi', properties });
  const v = r.values;

  test('per property', () => {
    expect(v.perProperty.map((p) => p.annualNoi)).toEqual([22968, 22596, 17472]);
    expect(v.perProperty.map((p) => p.annualDebtService?.toFixed(2))).toEqual([
      '24558.35',
      '15348.97',
      '30697.93',
    ]);
    expect(v.perProperty.map((p) => p.dscr?.toFixed(4))).toEqual(['0.9352', '1.4722', '0.5692']);
    expect(v.perProperty[0]).not.toHaveProperty('monthlyPitia');
  });

  test('portfolio and average', () => {
    expect(v.portfolioDscr?.toFixed(4)).toBe('0.8928');
    expect(v.averageOfRatios?.toFixed(4)).toBe('0.9922');
  });

  test('warnings: portfolio below 1.0 and each property below 1.0 named', () => {
    expect(r.warnings).toEqual([
      'Portfolio DSCR is 0.89, below 1.0: total income does not cover total debt.',
      'Below 1.0 DSCR: Base (0.94), Weak (0.57).',
    ]);
    expect(r.assumptions.filter((a) => a.includes(noiAssumption))).toEqual([noiAssumption]);
  });
});

test('default names and target, and a property with null DSCR', () => {
  const r = portfolioRollup({
    method: 'noi',
    properties: [
      { ...base, ...common },
      { ...strong, ...common, financing: { loanAmount: 0 } },
    ],
  });
  expect(r.values.target).toBe(1.25);
  expect(r.values.perProperty.map((p) => p.name)).toEqual(['Property 1', 'Property 2']);
  expect(r.values.perProperty[1]!.dscr).toBeNull();
  expect(r.values.averageOfRatios).toBe(r.values.perProperty[0]!.dscr);
  expect(r.warnings).toContain('DSCR is undefined (zero debt service) for: Property 2.');
});

test('every DSCR null: portfolio, weakest, and average are null', () => {
  const r = portfolioRollup({
    method: 'noi',
    properties: [{ ...base, ...common, financing: { loanAmount: 0 } }],
  });
  expect(r.values.portfolioDscr).toBeNull();
  expect(r.values.passes).toBe(false);
  expect(r.values.weakest).toBeNull();
  expect(r.values.averageOfRatios).toBeNull();
  expect(r.warnings[0]).toBe('Total debt service is 0, so portfolio DSCR is undefined.');
});

describe('validation', () => {
  const err = (raw: object) => {
    try {
      portfolioRollup(raw);
    } catch (e) {
      if (e instanceof ValidationError) return e.issues;
    }
    throw new Error('expected a ValidationError');
  };
  test('method required', () => {
    expect(err({ properties })[0]?.path).toBe('method');
  });
  test('1 to 50 properties', () => {
    expect(err({ method: 'noi', properties: [] })[0]?.path).toBe('properties');
    expect(err({ method: 'noi', properties: Array(51).fill(properties[0]) })[0]?.path).toBe(
      'properties',
    );
  });
  test('per-property either-or check carries the index', () => {
    expect(
      err({ method: 'noi', properties: [{ ...base, ...common, annualPropertyTax: undefined }] })[0],
    ).toEqual({
      path: 'properties.0',
      message: 'Provide exactly one of annualPropertyTax or propertyTaxPctOfPrice; none was given.',
    });
  });
});
