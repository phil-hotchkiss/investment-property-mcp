import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Grade } from './grade.js';
import { type GradedRun, renderReport, type Summary, writeResults } from './report.js';

const pass: Grade = {
  toolSelection: 'pass',
  args: 'pass',
  answer: 'pass',
  mentions: 'na',
  question: 'na',
  overall: true,
  details: [],
};
const failAnswer: Grade = {
  ...pass,
  answer: 'fail',
  overall: false,
  details: ['answer: maxPrice expected 392859, not found in final text'],
};
const naTools: Grade = { ...pass, toolSelection: 'na', args: 'na' };

const r = (
  caseId: string,
  category: GradedRun['category'],
  harness: GradedRun['harness'],
  run: number,
  grade: Grade,
  model = 'claude-haiku-4-5',
): GradedRun => ({
  caseId,
  category,
  harness,
  model,
  run,
  grade,
  finalText: `${caseId} answer ${'x'.repeat(400)}`,
});

const summary = (model: string, graded: GradedRun[]): Summary => ({
  model,
  judgeModel: 'claude-sonnet-5-5',
  harnesses: ['none', 'direct'],
  runs: 2,
  pricingDate: '2026-10-30',
  usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.002 },
  judge: { calls: 1, inputTokens: 300, outputTokens: 50, costUsd: 0.0011 },
  startedAt: '2026-10-30T12:00:00.000Z',
  stopped: null,
  graded,
});

const haiku = summary('claude-haiku-4-5', [
  r('loan-01', 'single-tool', 'none', 1, naTools),
  r('loan-01', 'single-tool', 'none', 2, failAnswer),
  r('loan-01', 'single-tool', 'direct', 1, pass),
  r('loan-01', 'single-tool', 'direct', 2, pass),
  { ...r('offer-01', 'chaining', 'none', 1, failAnswer), evidence: 'observed-failures #3' },
  r('offer-01', 'chaining', 'none', 2, failAnswer),
  r('offer-01', 'chaining', 'direct', 1, pass),
  r('offer-01', 'chaining', 'direct', 2, failAnswer),
]);

describe('renderReport', () => {
  const md = renderReport([haiku]);

  test('header', () => {
    expect(md).toContain('- Agent model: claude-haiku-4-5');
    expect(md).toContain('- Judge model: claude-sonnet-5-5 (1 calls, $0.0011)');
    expect(md).toContain('- Total cost: $0.0031 (agent plus judge)');
    expect(md).toContain('- Total tokens: 1550');
    expect(md).toContain('- Pricing date: 2026-10-30');
  });

  test('headline table: categories in order plus all, one column per harness', () => {
    expect(md).toContain(
      [
        '| Category | none | direct |',
        '| --- | --- | --- |',
        '| single-tool | 1/2 (50%) | 2/2 (100%) |',
        '| chaining | 0/2 (0%) | 1/2 (50%) |',
        '| all | 1/4 (25%) | 3/4 (75%) |',
      ].join('\n'),
    );
  });

  test('per-case table lists evidence and failing dimensions', () => {
    expect(md).toContain(
      '| offer-01 | chaining | observed-failures #3 | 0/2 (answer) | 1/2 (answer) |',
    );
    expect(md).toContain('| loan-01 | single-tool |  | 1/2 (answer) | 2/2 |');
  });

  test('failure appendix entry with details and the first 300 characters', () => {
    expect(md).toContain('### offer-01 / direct / run 2');
    expect(md).toContain('- answer: maxPrice expected 392859, not found in final text');
    expect(md).toContain(`> offer-01 answer ${'x'.repeat(300 - 'offer-01 answer '.length)}\n`);
  });

  test('runs that asked under accept_question are marked asked', () => {
    const asked: Grade = { ...pass, toolSelection: 'na', args: 'na', answer: 'na', asked: true };
    const md2 = renderReport([
      summary('m', [
        r('a', 'method-ambiguity', 'direct', 1, asked),
        r('a', 'method-ambiguity', 'direct', 2, pass),
      ]),
    ]);
    expect(md2).toContain('| a | method-ambiguity |  | - | 2/2 (asked 1) |');
  });

  test('stopped runs and an all-pass report', () => {
    const md2 = renderReport([
      { ...summary('m', [r('a', 'single-tool', 'direct', 1, pass)]), stopped: 'cap' },
    ]);
    expect(md2).toContain('- Stopped early (m): cap');
    expect(md2).toContain('## Failures\n\nNone.');
    expect(md2).toContain('| a | single-tool |  | - | 1/1 |');
  });
});

test('merge of two models gives harness and model columns', () => {
  const sonnet = summary('claude-sonnet-5-5', [
    r('loan-01', 'single-tool', 'direct', 1, pass, 'claude-sonnet-5-5'),
  ]);
  const md = renderReport([haiku, sonnet]);
  expect(md).toContain('- Agent model: claude-haiku-4-5, claude-sonnet-5-5');
  expect(md).toContain(
    '| Category | none / claude-haiku-4-5 | direct / claude-haiku-4-5 | none / claude-sonnet-5-5 | direct / claude-sonnet-5-5 |',
  );
  expect(md).toContain('| all | 1/4 (25%) | 3/4 (75%) | - | 1/1 (100%) |');
  expect(md).toContain('### offer-01 / direct / claude-haiku-4-5 / run 2');
});

test('writeResults writes summary.json and report.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evals-report-'));
  writeResults(dir, haiku);
  expect(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).graded).toHaveLength(8);
  expect(readFileSync(join(dir, 'report.md'), 'utf8')).toBe(renderReport([haiku]));
});
