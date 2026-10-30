import { describe, expect, test } from 'vitest';
import { bisect } from './bisection.js';

describe('bisect', () => {
  test('finds the boundary of a monotone predicate to within tolerance', () => {
    const r = bisect((x) => x * x <= 2, 0, 10, { toleranceAbs: 1e-9 });
    expect(r.x).toBeLessThanOrEqual(Math.SQRT2);
    expect(Math.SQRT2 - r.x).toBeLessThan(1e-9);
    expect(r.hitLowerBound).toBe(false);
    expect(r.hitUpperBound).toBe(false);
  });

  test('result always satisfies f and x + tolerance does not (tolerance 1)', () => {
    const r = bisect((x) => x <= 123456.7, 1, 1e6, { toleranceAbs: 1 });
    expect(r.x).toBeLessThanOrEqual(123456.7);
    expect(r.x + 1).toBeGreaterThan(123456.7);
    // 1e6 halved below 1 takes 20 steps.
    expect(r.iterations).toBe(20);
  });

  test('f false at lo: lower bound hit', () => {
    expect(bisect(() => false, 1, 10, { toleranceAbs: 1 })).toEqual({
      x: 1,
      hitUpperBound: false,
      hitLowerBound: true,
      iterations: 0,
    });
  });

  test('f true at hi: upper bound hit', () => {
    expect(bisect(() => true, 1, 10, { toleranceAbs: 1 })).toEqual({
      x: 10,
      hitUpperBound: true,
      hitLowerBound: false,
      iterations: 0,
    });
  });

  test('maxIterations caps the loop', () => {
    const r = bisect((x) => x <= 0.5, 0, 1, { toleranceAbs: 0, maxIterations: 3 });
    expect(r.iterations).toBe(3);
    expect(r.x).toBe(0.5);
  });
});
