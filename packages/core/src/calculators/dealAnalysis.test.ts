import { describe, expect, test } from 'vitest';
import { ValidationError } from '../schemas/result.js';
import { cashOnCash } from './cashOnCash.js';
import { dealAnalysis } from './dealAnalysis.js';
import { dscr } from './dscr.js';

// Workings for every fixture: docs/fixtures/deal-analysis.md
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

describe('fixture A: both DSCR methods', () => {
  const pitia = dealAnalysis({ ...property, dscrMethod: 'rentToPitia' });
  const noi = dealAnalysis({ ...property, dscrMethod: 'noi' });

  test('rentToPitia', () => {
    expect(pitia.values.annualGrossRent).toBe(38400);
    expect(pitia.values.annualNoi).toBe(22968);
    expect(pitia.values.capRatePct).toBeCloseTo(5.742, 10);
    expect(pitia.values.grm?.toFixed(4)).toBe('10.4167');
    expect(pitia.values.dscr?.toFixed(4)).toBe('1.2324');
    expect(pitia.values.dscrMethod).toBe('rentToPitia');
    expect(pitia.values.dscrPasses).toBe(false);
    expect(pitia.values.monthlyPitia.toFixed(2)).toBe('2596.53');
    expect(pitia.values.monthlyCashFlow.toFixed(2)).toBe('-132.53');
    expect(pitia.values.annualCashFlow.toFixed(2)).toBe('-1590.35');
    expect(pitia.values.cashOnCashPct?.toFixed(4)).toBe('-1.1559');
    expect(pitia.values.totalCashInvested.toFixed(2)).toBe('137579.17');
    expect(pitia.values.loanAmount).toBe(300000);
    expect(pitia.values.ltvPct).toBe(75);
  });

  test('noi', () => {
    expect(noi.values.dscr?.toFixed(4)).toBe('0.9352');
    expect(noi.values.dscrMethod).toBe('noi');
    expect(noi.values.dscrPasses).toBe(false);
  });

  test('passes against a lower target', () => {
    const r = dealAnalysis({ ...property, dscrMethod: 'rentToPitia', dscrTarget: 1.2 });
    expect(r.values.dscrPasses).toBe(true);
    expect(r.assumptions).toContain('DSCR target is 1.2.');
  });

  test('assumptions: no duplicates, no "ignored" line, method stated', () => {
    for (const r of [pitia, noi]) {
      expect(new Set(r.assumptions).size).toBe(r.assumptions.length);
      expect(r.assumptions.some((a) => a.startsWith('Ignored '))).toBe(false);
      expect(r.assumptions[0]).toContain('DSCR method');
    }
  });

  test('warnings are de-duplicated', () => {
    const r = dealAnalysis({ ...property, dscrMethod: 'noi', financing: { ltvPct: 85 } });
    expect(r.warnings.filter((w) => w.startsWith('LTV'))).toEqual(['LTV is 85.00%, above 80%.']);
    expect(r.warnings.filter((w) => w.startsWith('DSCR is'))).toHaveLength(1);
  });
});

describe('consistency with cashOnCash and dscr on identical inputs', () => {
  test.each(['rentToPitia', 'noi'] as const)('%s', (method) => {
    const d = dealAnalysis({ ...property, dscrMethod: method });
    const c = cashOnCash(property);
    const dscrProperty = structuredClone(property) as Partial<typeof property>;
    for (const k of ['closingCostsPctOfPrice', 'rehabCost', 'reservesMonthsOfPitia'] as const)
      delete dscrProperty[k];
    const s = dscr({ ...dscrProperty, method });
    expect(d.values).toMatchObject({
      annualNoi: c.values.annualNoi,
      annualCashFlow: c.values.annualCashFlow,
      monthlyCashFlow: c.values.monthlyCashFlow,
      cashOnCashPct: c.values.cashOnCashPct,
      totalCashInvested: c.values.totalCashInvested,
      monthlyPitia: s.values.monthlyPitia,
      dscr: s.values.dscr,
      dscrPasses: s.values.passes,
      loanAmount: s.values.loanAmount,
      ltvPct: s.values.ltvPct,
    });
  });
});

test('dscrMethod is required', () => {
  expect(() => dealAnalysis(property)).toThrow(ValidationError);
});

test('zero rent and zero debt: GRM, DSCR, and CoC are null with warnings', () => {
  const r = dealAnalysis({
    ...property,
    monthlyRent: 0,
    closingCostsPctOfPrice: 0,
    rehabCost: 0,
    reservesMonthsOfPitia: 0,
    financing: { ltvPct: 100 },
    loan: { interestRatePct: 0, termYears: 30 },
    dscrMethod: 'noi',
  });
  expect(r.values.grm).toBeNull();
  expect(r.values.cashOnCashPct).toBeNull();
  expect(r.warnings).toContain('Gross rent is 0, so GRM is undefined.');
});
