import { describe, expect, test } from 'vitest';
import { ValidationError } from '../schemas/result.js';
import { dealAnalysis } from './dealAnalysis.js';
import { loanPayment } from './loanPayment.js';
import { stressTest } from './stressTest.js';

// Workings for every fixture: docs/fixtures/stress-test.md
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
  closingCostsPctOfPrice: 3,
  rehabCost: 10000,
  reservesMonthsOfPitia: 6,
};
const fixed = (xs: (number | null)[], d = 4) => xs.map((x) => x?.toFixed(d));

describe('fixture A: vacancy sweep, noi method', () => {
  const r = stressTest({ ...property, dscrMethod: 'noi', vacancyPctRange: { min: 0, max: 20 } });
  const s = r.values.vacancyPctRange;

  test('points', () => {
    expect(s?.points.map((p) => p.value)).toEqual([0, 5, 10, 15, 20]);
    expect(fixed(s!.points.map((p) => p.dscr))).toEqual([
      '1.0134',
      '0.9352',
      '0.8571',
      '0.7789',
      '0.7007',
    ]);
    expect(
      fixed(
        s!.points.map((p) => p.monthlyCashFlow),
        2,
      ),
    ).toEqual(['27.47', '-132.53', '-292.53', '-452.53', '-612.53']);
    expect(s?.points.every((p) => !p.passes)).toBe(true);
  });

  test('break-even: cash flow found, DSCR target not crossed', () => {
    expect(s?.breakEven.cashFlowZero?.toFixed(3)).toBe('0.858');
    expect(s?.breakEven.dscrAtTarget).toBeNull();
    expect(r.warnings).toContain(
      'DSCR does not cross the target 1.25 for vacancyPct between 0 and 20.',
    );
  });

  test('base case is dealAnalysis at the inputs', () => {
    expect(r.values.base).toEqual(dealAnalysis({ ...property, dscrMethod: 'noi' }).values);
    expect(r.values.grid).toBeUndefined();
  });
});

describe('fixture B: rate, rent, and expense sweeps, rentToPitia, target 1.25', () => {
  const r = stressTest({
    ...property,
    dscrMethod: 'rentToPitia',
    interestRatePctRange: { min: 6, max: 8 },
    monthlyRentRange: { min: 3000, max: 4000 },
    operatingExpensesChangePctRange: { min: -20, max: 20 },
  });
  const v = r.values;

  test('interest rate', () => {
    const s = v.interestRatePctRange!;
    expect(s.points.map((p) => p.value)).toEqual([6, 6.5, 7, 7.5, 8]);
    expect(fixed(s.points.map((p) => p.dscr))).toEqual([
      '1.3625',
      '1.3081',
      '1.2569',
      '1.2086',
      '1.1631',
    ]);
    expect(s.points.map((p) => p.passes)).toEqual([true, true, true, false, false]);
    expect(s.breakEven.dscrAtTarget?.toFixed(4)).toBe('7.0698');
    expect(s.breakEven.cashFlowZero?.toFixed(4)).toBe('6.5900');
    // At the break-even rates P&I is 2010 (DSCR 1.25) and 1914 (cash flow 0).
    const pi = (rate: number) =>
      loanPayment({ loanAmount: 300000, interestRatePct: rate, termYears: 30 }).values
        .monthlyPayment;
    expect(pi(s.breakEven.dscrAtTarget!)).toBeCloseTo(2010, 1);
    expect(pi(s.breakEven.cashFlowZero!)).toBeCloseTo(1914, 1);
  });

  test('rent', () => {
    const s = v.monthlyRentRange!;
    expect(s.points.map((p) => p.value)).toEqual([3000, 3250, 3500, 3750, 4000]);
    expect(fixed(s.points.map((p) => p.dscr))).toEqual([
      '1.1554',
      '1.2517',
      '1.3480',
      '1.4442',
      '1.5405',
    ]);
    expect(
      fixed(
        s.points.map((p) => p.monthlyCashFlow),
        2,
      ),
    ).toEqual(['-286.53', '-94.03', '98.47', '290.97', '483.47']);
    expect(s.breakEven.dscrAtTarget?.toFixed(2)).toBe('3245.66');
    expect(s.breakEven.cashFlowZero?.toFixed(2)).toBe('3372.12');
  });

  test('operating expenses change', () => {
    const s = v.operatingExpensesChangePctRange!;
    expect(s.points.map((p) => p.value)).toEqual([-20, -10, 0, 10, 20]);
    expect(fixed(s.points.map((p) => p.dscr))).toEqual([
      '1.2869',
      '1.2591',
      '1.2324',
      '1.2069',
      '1.1823',
    ]);
    expect(
      fixed(
        s.points.map((p) => p.monthlyCashFlow),
        2,
      ),
    ).toEqual(['92.67', '-19.93', '-132.53', '-245.13', '-357.73']);
    expect(s.breakEven.dscrAtTarget?.toFixed(3)).toBe('-6.642');
    expect(s.breakEven.cashFlowZero?.toFixed(3)).toBe('-11.770');
  });

  test('assumptions name the rent and expense sweep rules', () => {
    expect(r.assumptions).toContain(
      'The rent sweep sets the rent used directly; monthlyMarketRent and rentBasis are ignored during it.',
    );
    expect(r.assumptions.some((a) => a.startsWith('The operating expense sweep'))).toBe(true);
    expect(r.warnings).toEqual(['Annual cash flow is negative (-1590.35 dollars).']);
  });
});

test('fixture C: grid of vacancy by rate, noi method', () => {
  const r = stressTest({
    ...property,
    dscrMethod: 'noi',
    vacancyPctRange: { min: 0, max: 10, steps: 3 },
    interestRatePctRange: { min: 6, max: 8, steps: 3 },
  });
  const g = r.values.grid!;
  expect(g.rows).toEqual([0, 5, 10]);
  expect(g.cols).toEqual([6, 7, 8]);
  expect(g.dscr.map((row) => fixed(row))).toEqual([
    ['1.1531', '1.0391', '0.9422'],
    ['1.0641', '0.9590', '0.8695'],
    ['0.9752', '0.8788', '0.7968'],
  ]);
  expect(g.monthlyCashFlow.map((row) => fixed(row, 2))).toEqual([
    ['275.35', '78.09', '-127.29'],
    ['115.35', '-81.91', '-287.29'],
    ['-44.65', '-241.91', '-447.29'],
  ]);
  // Row 5% vacancy matches the single rate sweep at the base vacancy.
  expect(g.dscr[1]).toEqual(r.values.interestRatePctRange?.points.map((p) => p.dscr));
});

test('rentToPitia vacancy sweep explains why DSCR never moves', () => {
  const r = stressTest({
    ...property,
    dscrMethod: 'rentToPitia',
    vacancyPctRange: { min: 0, max: 20 },
  });
  expect(new Set(r.values.vacancyPctRange?.points.map((p) => p.dscr)).size).toBe(1);
  expect(r.warnings).toContain(
    'DSCR does not cross the target 1.25 for vacancyPct between 0 and 20. The rentToPitia method uses gross rent, so vacancy does not change it.',
  );
});

test('cash flow never crosses 0: null with a warning', () => {
  const r = stressTest({
    ...property,
    dscrMethod: 'rentToPitia',
    monthlyRentRange: { min: 2000, max: 3000, steps: 2 },
  });
  expect(r.values.monthlyRentRange?.breakEven).toEqual({ dscrAtTarget: null, cashFlowZero: null });
  expect(r.warnings).toContain(
    'Monthly cash flow does not cross 0 for monthlyRent between 2000 and 3000.',
  );
});

test('expense change scales percent-of-price tax and insurance, and HOA and utilities', () => {
  const pctInputs = {
    ...property,
    annualPropertyTax: undefined,
    annualInsurance: undefined,
    propertyTaxPctOfPrice: 1.2,
    insurancePctOfPrice: 0.45,
    monthlyHoa: 100,
    monthlyOwnerPaidUtilities: 50,
    dscrMethod: 'noi' as const,
  };
  const r = stressTest({
    ...pctInputs,
    operatingExpensesChangePctRange: { min: -100, max: 0, steps: 2 },
  });
  // -100% removes every operating expense: NOI is rent less vacancy.
  const noOpex = r.values.operatingExpensesChangePctRange!.points[0]!;
  expect(noOpex.monthlyCashFlow.toFixed(2)).toBe((3200 - 160 - 2046.53).toFixed(2));
});

describe('validation', () => {
  const err = (raw: object) => {
    try {
      stressTest(raw);
    } catch (e) {
      if (e instanceof ValidationError) return e.issues;
    }
    throw new Error('expected a ValidationError');
  };
  const base = { ...property, dscrMethod: 'noi' };
  test('no range', () => {
    expect(err(base)[0]?.message).toBe(
      'Provide at least one of vacancyPctRange, interestRatePctRange, monthlyRentRange, operatingExpensesChangePctRange; none was given.',
    );
  });
  test('min not below max', () => {
    expect(err({ ...base, monthlyRentRange: { min: 3000, max: 3000 } })[0]).toEqual({
      path: 'monthlyRentRange',
      message: 'monthlyRentRange.min (3000) must be less than monthlyRentRange.max (3000).',
    });
  });
  test('steps outside 2..25', () => {
    expect(err({ ...base, vacancyPctRange: { min: 0, max: 10, steps: 26 } })[0]?.path).toBe(
      'vacancyPctRange.steps',
    );
  });
  test('rate range uses the percent trap', () => {
    expect(err({ ...base, interestRatePctRange: { min: 0.06, max: 8 } })[0]?.message).toBe(
      'interestRatePctRange.min was 0.06. This field is a percent number; did you mean 6?',
    );
  });
  test('dscrMethod is required', () => {
    expect(err({ ...property, vacancyPctRange: { min: 0, max: 10 } })[0]?.path).toBe('dscrMethod');
  });
});
