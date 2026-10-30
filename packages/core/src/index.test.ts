import { expect, test } from 'vitest';
import { VERSION } from './index.js';

test('exports VERSION', () => {
  expect(VERSION).toBe('0.0.0');
});
