import { isDeepStrictEqual } from 'node:util';
import type { Case } from './cases.js';
import type { Transcript } from './transcript.js';

export type Verdict = 'pass' | 'fail' | 'na';
export const dimensions = ['toolSelection', 'args', 'answer', 'mentions', 'question'] as const;
export type Dimension = (typeof dimensions)[number];
export type Grade = Record<Dimension, Verdict> & { overall: boolean; details: string[] };

/** What the LLM judge decided about must_mention or the rubric. See judge.ts. */
export type JudgeVerdict = { pass: boolean; missing: string[]; reason: string };

type Tolerance = { tolerance?: number | undefined; tolerance_pct?: number | undefined };

/** Absolute tolerance, or percent of the expected value; either passing is enough. Default 0. */
export function within(actual: number, expected: number, t: Tolerance): boolean {
  // The 1e-9 absorbs float error, so 1.24 is within 0.01 of 1.23.
  const diff = Math.abs(actual - expected) - 1e-9;
  return diff <= (t.tolerance ?? 0) || diff <= (Math.abs(expected) * (t.tolerance_pct ?? 0)) / 100;
}

/**
 * Every number written in the text. Strips `$` and thousands commas, ignores a `%` suffix, and
 * reads a `k`/`K` suffix as thousands, so "$392,859", "393k", "7.25%" and "1.23" all parse.
 * A minus counts only at the start of a word, so "30-year" and "6-8%" do not go negative.
 * ponytail: no "million", "7 and a quarter", or spelled-out numbers; add when a case needs them.
 */
export function extractNumbers(text: string): number[] {
  const re = /(?:(?<!\w)(-))?\$?(\d[\d,]*(?:\.\d+)?)([kK](?![a-zA-Z]))?/g;
  return [...text.matchAll(re)].map(
    ([, minus, digits, k]) => (minus ? -1 : 1) * Number(digits!.replace(/,/g, '')) * (k ? 1000 : 1),
  );
}

const get = (o: unknown, path: string[]) =>
  path.reduce<unknown>(
    (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
    o,
  );

/**
 * Deterministic grade of one transcript. `judge` is the judge's verdict when one ran; without it,
 * mentions only reflects must_not_mention. Pure: no network, no clock.
 */
export function grade(c: Case, t: Transcript, judge?: JudgeVerdict): Grade {
  const e = c.expected;
  const details: string[] = [];
  const called = t.toolCalls.map((tc) => tc.name);
  const firstCalls = [...new Set(called)];
  const canCallTools = t.harness !== 'none';

  // Tool selection
  let toolSelection: Verdict = 'na';
  if (canCallTools) {
    const want: string[] = Array.isArray(e.tools) ? e.tools : e.tools.sequence;
    const extra = firstCalls.filter((n) => !want.includes(n));
    const missing = want.filter((n) => !firstCalls.includes(n));
    if (extra.length) details.push(`tools: unexpected call to ${extra.join(', ')}`);
    if (missing.length) details.push(`tools: never called ${missing.join(', ')}`);
    let ok = !extra.length && !missing.length;
    if (ok && !Array.isArray(e.tools) && !isDeepStrictEqual(firstCalls, want)) {
      details.push(`tools: order ${firstCalls.join(' > ')}, expected ${want.join(' > ')}`);
      ok = false;
    }
    toolSelection = ok ? 'pass' : 'fail';
  }

  // Arguments. na for the none harness, which has no calls to inspect.
  let args: Verdict = 'na';
  if (canCallTools && Object.keys(e.args).length) {
    args = 'pass';
    for (const [key, want] of Object.entries(e.args)) {
      const [tool, ...path] = key.split('.');
      const call = t.toolCalls.find((tc) => tc.name === tool);
      const actual = call && get(call.args, path);
      let problem: string | undefined;
      if (!call) problem = `no call to ${tool}`;
      else if (actual === undefined) problem = 'missing';
      else if (typeof want.value === 'number')
        problem =
          typeof actual === 'number' && within(actual, want.value, want)
            ? undefined
            : `got ${JSON.stringify(actual)}, expected ${want.value}`;
      else if (!isDeepStrictEqual(actual, want.value))
        problem = `got ${JSON.stringify(actual)}, expected ${JSON.stringify(want.value)}`;
      if (problem) {
        details.push(`args: ${key} ${problem}`);
        args = 'fail';
      }
    }
  }

  // Answer
  let answer: Verdict = 'na';
  if (Object.keys(e.answer).length) {
    answer = 'pass';
    const numbers = extractNumbers(t.finalText);
    for (const [key, want] of Object.entries(e.answer)) {
      // resolveCase guarantees value is set; the fallback only satisfies the type.
      const value = want.value ?? NaN;
      if (!numbers.some((n) => within(n, value, want))) {
        details.push(`answer: ${key} expected ${value}, not found in final text`);
        answer = 'fail';
      }
    }
  }
  if (!e.expect_question && t.askedQuestion) {
    details.push('answer: asked instead of answering');
    answer = 'fail';
  }

  // Question
  let question: Verdict = 'na';
  if (e.expect_question) {
    question = t.askedQuestion && called.length === 0 ? 'pass' : 'fail';
    if (question === 'fail')
      details.push(
        called.length
          ? `question: called ${called.join(', ')} instead of asking`
          : 'question: did not ask',
      );
  }

  // Mentions: deterministic must_not_mention, then the judge.
  let mentions: Verdict = e.must_not_mention.length || judge ? 'pass' : 'na';
  const lower = t.finalText.toLowerCase();
  for (const banned of e.must_not_mention)
    if (lower.includes(banned.toLowerCase())) {
      details.push(`mentions: must not mention "${banned}"`);
      mentions = 'fail';
    }
  if (judge && !judge.pass) {
    const missing = judge.missing.length ? ` (missing: ${judge.missing.join(', ')})` : '';
    details.push(`mentions: judge failed${missing}: ${judge.reason}`);
    mentions = 'fail';
  }

  const verdicts = { toolSelection, args, answer, mentions, question };
  return {
    ...verdicts,
    overall: Object.values(verdicts).every((v) => v !== 'fail'),
    details,
  };
}
