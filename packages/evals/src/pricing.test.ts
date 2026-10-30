import { expect, test } from 'vitest';
import { costUsd } from './pricing.js';

test('costUsd uses per-million prices and rejects unknown models', () => {
  expect(costUsd('claude-haiku-4-5', 1_000_000, 200_000)).toBeCloseTo(2, 10);
  expect(costUsd('claude-sonnet-5-5', 500_000, 100_000)).toBeCloseTo(2, 10);
  expect(() => costUsd('gpt-x', 1, 1)).toThrow(/No price for model gpt-x/);
});
