import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { categories, loadCases } from '../src/cases.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const cases = loadCases(here);

// GitHub's heading anchor: lowercase, drop punctuation other than dashes, spaces to dashes.
const anchor = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');

test('28 cases with unique ids', () => {
  expect(cases).toHaveLength(28);
  expect(new Set(cases.map((c) => c.id)).size).toBe(28);
});

test.each(categories)('%s has at least 2 cases', (cat) => {
  expect(cases.filter((c) => c.category === cat).length).toBeGreaterThanOrEqual(2);
});

test.each(cases.filter((c) => c.evidence).map((c) => [c.id, c.evidence!]))(
  '%s evidence exists',
  (_id, evidence) => {
    const [path, hash] = evidence.split('#');
    const file = join(repo, path!);
    expect(existsSync(file), path).toBe(true);
    if (hash) {
      const headings = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('#'))
        .map((l) => anchor(l.replace(/^#+\s*/, '')));
      expect(headings).toContain(hash);
    }
  },
);
