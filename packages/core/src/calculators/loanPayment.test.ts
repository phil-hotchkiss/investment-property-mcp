import { expect, test } from 'vitest';
import { ValidationError } from '../schemas/result.js';
import { loanPayment } from './loanPayment.js';

// Workings for every fixture: docs/fixtures/loan-payment.md

test('fixture A: 300000 at 7.25% for 30 years (externally verified)', () => {
  const r = loanPayment({ loanAmount: 300000, interestRatePct: 7.25, termYears: 30 });
  expect(r.values.monthlyPrincipalAndInterest.toFixed(2)).toBe('2046.53');
  expect(r.values.monthlyPayment).toBe(r.values.monthlyPrincipalAndInterest);
  expect(r.values.monthlyInterestOnly).toBe(1812.5);
  expect(r.values.totalInterest.toFixed(2)).toBe('436750.38');
  expect(r.values).not.toHaveProperty('balanceAtYear');
  expect(r.assumptions).toEqual([
    'Amortizing loan: monthly principal and interest pays it off over 30 years.',
  ]);
  expect(r.warnings).toEqual([]);
});

test('fixture B: balance after 5 years', () => {
  const r = loanPayment({
    loanAmount: 300000,
    interestRatePct: 7.25,
    termYears: 30,
    balanceAtYear: 5,
  });
  expect(r.values.balanceAtYear?.toFixed(2)).toBe('283136.33');
});

test('balance at year 0 is the loan and at the end of term is 0', () => {
  const at = (y: number) =>
    loanPayment({ loanAmount: 300000, interestRatePct: 7.25, termYears: 30, balanceAtYear: y })
      .values.balanceAtYear;
  expect(at(0)).toBeCloseTo(300000, 6);
  expect(at(30)).toBeCloseTo(0, 6);
});

test('fixture C: 0% rate is straight-line', () => {
  const r = loanPayment({
    loanAmount: 120000,
    interestRatePct: 0,
    termYears: 10,
    balanceAtYear: 4,
  });
  expect(r.values).toEqual({
    monthlyPrincipalAndInterest: 1000,
    monthlyInterestOnly: 0,
    monthlyPayment: 1000,
    totalInterest: 0,
    balanceAtYear: 72000,
  });
});

test('fixture D: interest-only', () => {
  const r = loanPayment({
    loanAmount: 300000,
    interestRatePct: 7.25,
    termYears: 30,
    amortization: 'interestOnly',
    balanceAtYear: 10,
  });
  expect(r.values.monthlyPayment).toBe(1812.5);
  expect(r.values.totalInterest).toBe(652500);
  expect(r.values.balanceAtYear).toBe(300000);
  expect(r.assumptions[0]).toBe(
    'Interest-only loan for the full 30-year term; the full 300000 dollar balance is due at the end.',
  );
});

test('rejects decimal rate, bad term, and balanceAtYear past term', () => {
  const bad = (raw: unknown) => {
    try {
      loanPayment(raw);
    } catch (e) {
      return (e as ValidationError).issues;
    }
  };
  expect(bad({ loanAmount: 1, interestRatePct: 0.0725, termYears: 30 })).toEqual([
    {
      path: 'interestRatePct',
      message: 'interestRatePct was 0.0725. This field is a percent number; did you mean 7.25?',
    },
  ]);
  expect(bad({ loanAmount: 1, interestRatePct: 7, termYears: 41 })?.[0]?.path).toBe('termYears');
  expect(bad({ loanAmount: 1, interestRatePct: 7, termYears: 30.5 })?.[0]?.path).toBe('termYears');
  expect(bad({ loanAmount: 1, interestRatePct: 7, termYears: 30, balanceAtYear: 31 })).toEqual([
    { path: 'balanceAtYear', message: 'balanceAtYear was 31. It must be at most termYears (30).' },
  ]);
  expect(() => loanPayment(null)).toThrow(ValidationError);
});
