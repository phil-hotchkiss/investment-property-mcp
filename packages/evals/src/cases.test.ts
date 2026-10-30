import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@rental-deal-math/core';
import { describe, expect, test } from 'vitest';
import { loadCases, resolveCase } from './cases.js';

const dscrInput = {
  price: 400000,
  monthlyRent: 3200,
  annualPropertyTax: 4800,
  annualInsurance: 1800,
  financing: { downPaymentPct: 25 },
  loan: { interestRatePct: 7.25, termYears: 30 },
  method: 'noi',
};

const valid = `
id: dscr-noi-01
category: method-ambiguity
prompt: DSCR on a 400k place, 3200 rent, NOI method.
evidence: "2026-10-30: Model derived the NOI method"
compute:
  tool: dscr
  input: ${JSON.stringify(dscrInput)}
expected:
  tools: { sequence: [dscr] }
  args:
    dscr.method: { value: noi }
    dscr.loan.interestRatePct: { value: 7.25, tolerance: 0 }
  answer:
    dscr: { tolerance: 0.005 }
    monthlyRentUsed: { value: 3200 }
  must_mention: [NOI]
`;

function dir(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'cases-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

describe('loadCases', () => {
  test('loads a valid file and fills the answer from core', () => {
    const [c, ...rest] = loadCases(dir({ 'a.yaml': valid, 'notes.txt': 'ignored' }));
    expect(rest).toEqual([]);
    expect(c?.expected.answer.dscr?.value).toBe(core.dscr(dscrInput).values.dscr);
    expect(c?.expected.answer.dscr?.value).toBeCloseTo(1.295, 3);
    expect(c?.expected.answer.monthlyRentUsed?.value).toBe(3200);
    expect(c?.expected.tools).toEqual({ sequence: ['dscr'] });
    expect(c?.expected.must_not_mention).toEqual([]);
  });

  test('rejects a bad category, naming the file', () => {
    const bad = valid.replace('method-ambiguity', 'vibes');
    expect(() => loadCases(dir({ 'bad.yaml': bad }))).toThrow(/^bad\.yaml: .*category/s);
  });

  test('rejects compute with an unknown tool', () => {
    const bad = valid.replace('tool: dscr', 'tool: cap_rate');
    expect(() => loadCases(dir({ 'bad.yaml': bad }))).toThrow(/bad\.yaml: .*compute\.tool/s);
  });

  test('rejects duplicate ids', () => {
    expect(() => loadCases(dir({ 'a.yaml': valid, 'b.yaml': valid }))).toThrow(/duplicate/);
  });
});

describe('resolveCase', () => {
  const base = { id: 'x', category: 'missing-info', prompt: 'p' };

  test('a case with no answers needs no compute', () => {
    const c = resolveCase({ ...base, expected: { expect_question: true } });
    expect(c.expected.tools).toEqual([]);
  });

  test('an answer without value needs compute', () => {
    expect(() => resolveCase({ ...base, expected: { answer: { dscr: {} } } })).toThrow(
      /dscr has no value and the case has no compute block/,
    );
  });

  test('an answer path that is not a number in the result is an error', () => {
    const compute = { tool: 'dscr', input: dscrInput };
    expect(() =>
      resolveCase({ ...base, compute, expected: { answer: { 'nope.deeper': {} } } }),
    ).toThrow(/nope\.deeper: dscr returned undefined/);
  });

  test('a list of keyed compute blocks fills answers by key prefix', () => {
    const rtp = { ...dscrInput, method: 'rentToPitia' };
    const c = resolveCase({
      ...base,
      compute: [
        { key: 'rentToPitia', tool: 'dscr', input: rtp },
        { key: 'noi', tool: 'dscr', input: dscrInput },
      ],
      expected: { answer: { 'rentToPitia.dscr': {}, 'noi.dscr': {}, 'noi.annualNoi': {} } },
    });
    expect(c.expected.answer['rentToPitia.dscr']?.value).toBe(core.dscr(rtp).values.dscr);
    expect(c.expected.answer['noi.dscr']?.value).toBe(core.dscr(dscrInput).values.dscr);
    expect(c.expected.answer['noi.dscr']?.value).not.toBe(
      c.expected.answer['rentToPitia.dscr']?.value,
    );
  });

  test('with a compute list, an answer key must name a block', () => {
    const compute = [{ key: 'noi', tool: 'dscr', input: dscrInput }];
    for (const key of ['dscr', 'other.dscr'])
      expect(() => resolveCase({ ...base, compute, expected: { answer: { [key]: {} } } })).toThrow(
        `answer ${key}: must be <key>.<path> naming a compute block`,
      );
  });

  test('compute input that core rejects is an error', () => {
    const compute = { tool: 'dscr', input: { price: 1 } };
    expect(() => resolveCase({ ...base, compute, expected: { answer: { dscr: {} } } })).toThrow();
  });
});
