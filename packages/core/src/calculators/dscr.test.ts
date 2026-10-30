import { describe, expect, test } from 'vitest';
import { ValidationError } from '../schemas/result.js';
import { dscr } from './dscr.js';

// Workings for every fixture: docs/fixtures/dscr.md
const property = {
  price: 400000,
  monthlyRent: 3200,
  annualPropertyTax: 4800,
  annualInsurance: 1800,
  financing: { downPaymentPct: 25 },
  loan: { interestRatePct: 7.25, termYears: 30 },
  vacancyPct: 5,
  managementPct: 8,
  maintenancePct: 5,
  capexPct: 5,
};

describe('fixture A: same property, both methods', () => {
  const pitia = dscr({ ...property, method: 'rentToPitia' });
  const noi = dscr({ ...property, method: 'noi' });

  test('rentToPitia', () => {
    expect(pitia.values.monthlyPitia.toFixed(2)).toBe('2596.53');
    expect(pitia.values.dscr?.toFixed(4)).toBe('1.2324');
    expect(pitia.values.passes).toBe(false);
    expect(pitia.values).not.toHaveProperty('annualNoi');
    expect(pitia.values).toMatchObject({
      method: 'rentToPitia',
      target: 1.25,
      loanAmount: 300000,
      ltvPct: 75,
      downPaymentAmount: 100000,
      downPaymentPct: 25,
    });
    expect(pitia.assumptions).toEqual([
      'DSCR method rentToPitia: gross monthly rent divided by monthly PITIA (principal, interest, taxes, insurance, HOA).',
      'Rent basis: lease rent of 3200 dollars per month (no market rent given).',
      'Amortizing loan: monthly principal and interest pays it off over 30 years.',
      'Property tax is a flat 4800 dollars per year.',
      'Insurance is a flat 1800 dollars per year.',
      'No HOA.',
      'Ignored vacancyPct, managementPct, maintenancePct, capexPct: the rentToPitia method does not use them.',
    ]);
    expect(pitia.warnings).toEqual([]);
  });

  test('noi', () => {
    expect(noi.values.annualNoi).toBe(22968);
    expect(noi.values.monthlyDebtService.toFixed(2)).toBe('2046.53');
    expect(noi.values.dscr?.toFixed(4)).toBe('0.9352');
    expect(noi.assumptions[0]).toContain('DSCR method noi');
    expect(noi.assumptions.at(-1)).toContain('apply to gross scheduled rent');
    expect(noi.warnings).toEqual(['DSCR is 0.94, below 1.0: income does not cover the debt.']);
  });

  test('the two methods differ', () => {
    expect(pitia.values.dscr).not.toBeCloseTo(noi.values.dscr ?? 0, 2);
  });
});

test('fixture B: lesser rent basis, percent-of-price costs, HOA, passes', () => {
  const r = dscr({
    price: 400000,
    monthlyRent: 3600,
    monthlyMarketRent: 3500,
    propertyTaxPctOfPrice: 1.2,
    insurancePctOfPrice: 0.45,
    monthlyHoa: 100,
    financing: { ltvPct: 75 },
    loan: { interestRatePct: 7.25, termYears: 30 },
    method: 'rentToPitia',
  });
  expect(r.values.monthlyRentUsed).toBe(3500);
  expect(r.values.monthlyPitia.toFixed(2)).toBe('2696.53');
  expect(r.values.dscr?.toFixed(4)).toBe('1.2980');
  expect(r.values.passes).toBe(true);
  expect(r.assumptions).toContain(
    'Rent basis: lesser of lease (3600) and market (3500) rent, 3500 dollars per month (default because market rent was given and rentBasis was not).',
  );
  expect(r.assumptions).toContain('HOA is 100 dollars per month.');
  expect(r.assumptions).toContain('Property tax is 1.2% of price per year (4800 dollars).');
});

test('fixture C: interest-only, other income and utilities under noi', () => {
  const r = dscr({
    ...property,
    loan: { interestRatePct: 7.25, termYears: 30, amortization: 'interestOnly' },
    monthlyOtherIncome: 100,
    monthlyOwnerPaidUtilities: 150,
    method: 'noi',
    target: 1.0,
  });
  expect(r.values.monthlyDebtService).toBe(1812.5);
  expect(r.values.annualNoi).toBe(22368);
  expect(r.values.dscr?.toFixed(4)).toBe('1.0284');
  expect(r.values.passes).toBe(true);
  expect(r.assumptions).toContain(
    'Interest-only loan for the full 30-year term; the full 300000 dollar balance is due at the end.',
  );
});

test('LTV above 80 warns', () => {
  const r = dscr({ ...property, financing: { ltvPct: 85 }, method: 'rentToPitia' });
  expect(r.warnings).toContain('LTV is 85.00%, above 80%.');
});

test('PITIA 0 and debt service 0 give a null DSCR and a warning', () => {
  const free = {
    price: 100000,
    monthlyRent: 1000,
    annualPropertyTax: 0,
    annualInsurance: 0,
    financing: { loanAmount: 0 },
    loan: { interestRatePct: 7, termYears: 30 },
  };
  const a = dscr({ ...free, method: 'rentToPitia' });
  expect(a.values.dscr).toBeNull();
  expect(a.values.passes).toBe(false);
  expect(a.warnings).toEqual(['PITIA is 0, so DSCR is undefined.']);
  const b = dscr({ ...free, method: 'noi' });
  expect(b.values.dscr).toBeNull();
  expect(b.warnings).toEqual(['Annual debt service is 0, so DSCR is undefined.']);
});

test('validation: method is required, tax either-or, sub-1 vacancy allowed', () => {
  const issues = (raw: unknown) => {
    try {
      dscr(raw);
    } catch (e) {
      if (e instanceof ValidationError) return e.issues;
    }
    return [];
  };
  expect(issues({ ...property }).map((i) => i.path)).toEqual(['method']);
  expect(issues({ ...property, annualPropertyTax: undefined, method: 'noi' })).toEqual([
    {
      path: '',
      message: 'Provide exactly one of annualPropertyTax or propertyTaxPctOfPrice; none was given.',
    },
  ]);
  expect(dscr({ ...property, vacancyPct: 0.5, method: 'noi' }).values.annualNoi).toBeGreaterThan(0);
  expect(() => dscr({ ...property, monthlyRent: 1, rentBasis: 'market', method: 'noi' })).toThrow(
    ValidationError,
  );
});
