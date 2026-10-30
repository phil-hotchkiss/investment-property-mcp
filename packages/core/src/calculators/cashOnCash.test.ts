import { describe, expect, test } from 'vitest';
import { ValidationError } from '../schemas/result.js';
import { cashOnCash } from './cashOnCash.js';

// Workings for every fixture: docs/fixtures/cash-on-cash.md
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

describe('fixture A: base property, 3% closing, 10000 rehab, 6 months PITIA reserves', () => {
  const r = cashOnCash({
    ...property,
    closingCostsPctOfPrice: 3,
    rehabCost: 10000,
    reservesMonthsOfPitia: 6,
  });
  test('values', () => {
    const v = r.values;
    expect(v.annualNoi).toBe(22968);
    expect(v.annualDebtService.toFixed(2)).toBe('24558.35');
    expect(v.annualCashFlow.toFixed(2)).toBe('-1590.35');
    expect(v.monthlyCashFlow.toFixed(2)).toBe('-132.53');
    expect(v.monthlyPitia.toFixed(2)).toBe('2596.53');
    expect(v.downPaymentAmount).toBe(100000);
    expect(v.closingCosts).toBe(12000);
    expect(v.rehabCost).toBe(10000);
    expect(v.reserves.toFixed(2)).toBe('15579.17');
    expect(v.totalCashInvested.toFixed(2)).toBe('137579.17');
    expect(v.cashOnCashPct?.toFixed(4)).toBe('-1.1559');
  });
  test('assumptions and warnings', () => {
    expect(r.assumptions).toEqual(
      expect.arrayContaining([
        'Closing costs are 3% of price (12000 dollars).',
        'Rehab cost is 10000 dollars.',
        expect.stringMatching(/^Reserves are 6 months of PITIA \(15579\.17/),
        'Rent basis: lease rent of 3200 dollars per month (no market rent given).',
        'Amortizing loan: monthly principal and interest pays it off over 30 years.',
      ]),
    );
    expect(r.warnings).toEqual(['Annual cash flow is negative (-1590.35 dollars).']);
  });
});

describe('fixture B: positive cash flow, flat closing and reserves', () => {
  const r = cashOnCash({
    ...property,
    monthlyRent: 4000,
    closingCosts: 9000,
    reservesAmount: 5000,
  });
  test('values', () => {
    expect(r.values.annualNoi).toBe(30360);
    expect(r.values.annualCashFlow.toFixed(2)).toBe('5801.65');
    expect(r.values.totalCashInvested).toBe(114000);
    expect(r.values.cashOnCashPct?.toFixed(4)).toBe('5.0892');
    expect(r.warnings).toEqual([]);
    expect(r.assumptions).toEqual(
      expect.arrayContaining([
        'Closing costs are a flat 9000 dollars.',
        'No rehab cost.',
        'Reserves are a flat 5000 dollars.',
      ]),
    );
  });
});

describe('either-or pairs', () => {
  const messages = (extra: object) => {
    try {
      cashOnCash({ ...property, ...extra });
    } catch (e) {
      if (e instanceof ValidationError) return e.issues.map((i) => i.message);
      throw e;
    }
    throw new Error('expected a ValidationError');
  };
  test('closing costs: both is an error', () => {
    expect(messages({ closingCosts: 1, closingCostsPctOfPrice: 1 })).toEqual([
      'Provide exactly one of closingCosts or closingCostsPctOfPrice; got closingCosts and closingCostsPctOfPrice.',
    ]);
  });
  test('reserves: both is an error', () => {
    expect(messages({ reservesAmount: 1, reservesMonthsOfPitia: 1 })).toEqual([
      'Provide exactly one of reservesAmount or reservesMonthsOfPitia; got reservesAmount and reservesMonthsOfPitia.',
    ]);
  });
  test('neither means 0 and says so', () => {
    const r = cashOnCash(property);
    expect(r.values.closingCosts).toBe(0);
    expect(r.values.reserves).toBe(0);
    expect(r.values.totalCashInvested).toBe(100000);
    expect(r.assumptions).toEqual(
      expect.arrayContaining(['Closing costs assumed 0.', 'Reserves assumed 0.']),
    );
  });
  test('tax and insurance still require exactly one', () => {
    expect(() => cashOnCash({ ...property, annualPropertyTax: undefined })).toThrow(
      ValidationError,
    );
  });
});

test('100% financing: cash invested 0, CoC null with a warning', () => {
  const r = cashOnCash({ ...property, financing: { ltvPct: 100 } });
  expect(r.values.totalCashInvested).toBe(0);
  expect(r.values.cashOnCashPct).toBeNull();
  expect(r.warnings).toEqual(
    expect.arrayContaining([
      'Total cash invested is 0, so cash-on-cash is undefined.',
      'LTV is 100.00%, above 80%.',
    ]),
  );
});
