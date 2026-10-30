import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { exactlyOne } from './eitherOr.js';
import { financing, resolveFinancing } from './financing.js';
import { money, price } from './money.js';
import { pct } from './percent.js';
import { propertyCosts, propertyCostsChecks, resolvePropertyCosts } from './property.js';
import { resolveRent } from './rent.js';
import { parseInput, ValidationError } from './result.js';

/** Parse and return the issues the ValidationError carries. */
function issues(schema: z.ZodType, raw: unknown) {
  try {
    parseInput(schema, raw);
  } catch (e) {
    if (e instanceof ValidationError) return e.issues;
    throw e;
  }
  throw new Error('expected a ValidationError');
}

describe('money and price', () => {
  test('money accepts 0, rejects negative and Infinity', () => {
    expect(money.safeParse(0).success).toBe(true);
    expect(money.safeParse(-1).success).toBe(false);
    expect(money.safeParse(Infinity).success).toBe(false);
  });
  test('price must be positive', () => {
    expect(price.safeParse(0).success).toBe(false);
    expect(price.safeParse(1).success).toBe(true);
  });
});

describe('pct', () => {
  const rate = pct('interestRatePct');
  test('percent trap message is exact', () => {
    expect(issues(rate, 0.071)).toEqual([
      {
        path: '',
        message: 'interestRatePct was 0.071. This field is a percent number; did you mean 7.1?',
      },
    ]);
  });
  test('0, exactly 1, and 100 are valid', () => {
    for (const v of [0, 1, 7.25, 100]) expect(rate.parse(v)).toBe(v);
  });
  test('above max or negative is rejected', () => {
    expect(issues(rate, 101)[0]?.message).toBe(
      'interestRatePct was 101. This field is a percent number between 0 and 100.',
    );
    expect(issues(pct('x', { max: 30 }), 31)[0]?.message).toBe(
      'x was 31. This field is a percent number between 0 and 30.',
    );
    expect(issues(rate, -2)[0]?.message).toContain('between 0 and 100');
  });
  test('allowSubOne accepts values in (0, 1)', () => {
    expect(pct('vacancyPct', { allowSubOne: true }).parse(0.5)).toBe(0.5);
  });
});

describe('exactlyOne', () => {
  const pair = z
    .object({ a: z.number().optional(), b: z.number().optional() })
    .superRefine(exactlyOne('a', 'b'));
  test('neither', () => {
    expect(issues(pair, {})).toEqual([
      { path: '', message: 'Provide exactly one of a or b; none was given.' },
    ]);
  });
  test('both', () => {
    expect(issues(pair, { a: 1, b: 2 })[0]?.message).toBe(
      'Provide exactly one of a or b; got a and b.',
    );
  });
  test('one', () => {
    expect(pair.parse({ b: 2 })).toEqual({ b: 2 });
  });
});

describe('financing', () => {
  const all = 'downPaymentPct, ltvPct, downPaymentAmount, loanAmount';
  test('none lists all four options', () => {
    expect(issues(financing, {})[0]?.message).toBe(
      `Provide exactly one of ${all}; none was given.`,
    );
  });
  test('two lists all four options and the two given', () => {
    expect(issues(financing, { ltvPct: 75, loanAmount: 1 })[0]?.message).toBe(
      `Provide exactly one of ${all}; got ltvPct and loanAmount.`,
    );
  });
  test('downPaymentPct uses the percent trap', () => {
    expect(issues(financing, { downPaymentPct: 0.25 })[0]).toEqual({
      path: 'downPaymentPct',
      message: 'downPaymentPct was 0.25. This field is a percent number; did you mean 25?',
    });
  });
  test.each([
    [{ downPaymentPct: 25 }],
    [{ ltvPct: 75 }],
    [{ downPaymentAmount: 100000 }],
    [{ loanAmount: 300000 }],
  ])('every form resolves to the same four values: %o', (f) => {
    expect(resolveFinancing(400000, financing.parse(f))).toEqual({
      downPaymentPct: 25,
      ltvPct: 75,
      downPaymentAmount: 100000,
      loanAmount: 300000,
    });
  });
  test('loanAmount or downPaymentAmount above price is rejected', () => {
    expect(() => resolveFinancing(100, { loanAmount: 101 })).toThrow(
      'financing.loanAmount: loanAmount was 101. It must be between 0 and the price (100).',
    );
    expect(() => resolveFinancing(100, { downPaymentAmount: 101 })).toThrow(
      'financing.downPaymentAmount: downPaymentAmount was 101',
    );
  });
});

describe('property costs', () => {
  const schema = propertyCosts.superRefine((v, ctx) =>
    propertyCostsChecks.forEach((c) => c(v, ctx)),
  );
  test('tax and insurance either-or: neither and both', () => {
    expect(issues(schema, {}).map((i) => i.message)).toEqual([
      'Provide exactly one of annualPropertyTax or propertyTaxPctOfPrice; none was given.',
      'Provide exactly one of annualInsurance or insurancePctOfPrice; none was given.',
    ]);
    expect(
      issues(schema, {
        annualPropertyTax: 1,
        propertyTaxPctOfPrice: 1,
        annualInsurance: 1,
        insurancePctOfPrice: 1,
      }).map((i) => i.message),
    ).toEqual([
      'Provide exactly one of annualPropertyTax or propertyTaxPctOfPrice; got annualPropertyTax and propertyTaxPctOfPrice.',
      'Provide exactly one of annualInsurance or insurancePctOfPrice; got annualInsurance and insurancePctOfPrice.',
    ]);
  });
  test('flat amounts, no HOA', () => {
    const r = resolvePropertyCosts(
      400000,
      schema.parse({ annualPropertyTax: 4800, annualInsurance: 1800 }),
    );
    expect(r).toEqual({
      monthlyPropertyTax: 400,
      monthlyInsurance: 150,
      monthlyHoa: 0,
      assumptions: [
        'Property tax is a flat 4800 dollars per year.',
        'Insurance is a flat 1800 dollars per year.',
        'No HOA.',
      ],
    });
  });
  test('percent of price (sub-1 allowed) and HOA', () => {
    const r = resolvePropertyCosts(
      400000,
      schema.parse({ propertyTaxPctOfPrice: 1.2, insurancePctOfPrice: 0.45, monthlyHoa: 50 }),
    );
    expect(r.monthlyPropertyTax).toBeCloseTo(400, 10);
    expect(r.monthlyInsurance).toBeCloseTo(150, 10);
    expect(r.assumptions).toEqual([
      'Property tax is 1.2% of price per year (4800 dollars).',
      'Insurance is 0.45% of price per year (1800 dollars).',
      'HOA is 50 dollars per month.',
    ]);
  });
});

describe('resolveRent', () => {
  test('only lease rent given: lease', () => {
    expect(resolveRent({ monthlyRent: 2000 }).monthlyRentUsed).toBe(2000);
  });
  test('market given, basis omitted: lesser, and says it was the default', () => {
    const r = resolveRent({ monthlyRent: 2000, monthlyMarketRent: 1900 });
    expect(r.monthlyRentUsed).toBe(1900);
    expect(r.assumption).toBe(
      'Rent basis: lesser of lease (2000) and market (1900) rent, 1900 dollars per month (default because market rent was given and rentBasis was not).',
    );
  });
  test('explicit lease, market, and lesser', () => {
    const base = { monthlyRent: 2000, monthlyMarketRent: 2100 };
    expect(resolveRent({ ...base, rentBasis: 'lease' }).monthlyRentUsed).toBe(2000);
    expect(resolveRent({ ...base, rentBasis: 'market' }).monthlyRentUsed).toBe(2100);
    const lesser = resolveRent({ ...base, rentBasis: 'lesser' });
    expect(lesser.monthlyRentUsed).toBe(2000);
    expect(lesser.assumption).not.toContain('default');
  });
  test('market basis without market rent is an error', () => {
    expect(() => resolveRent({ monthlyRent: 2000, rentBasis: 'market' })).toThrow(
      'monthlyMarketRent: rentBasis is market but monthlyMarketRent was not given.',
    );
  });
});

test('ValidationError message joins issues with their paths', () => {
  const e = new ValidationError([
    { path: 'a.b', message: 'bad' },
    { path: '', message: 'also bad' },
  ]);
  expect(e.message).toBe('a.b: bad\nalso bad');
  expect(e.name).toBe('ValidationError');
});
