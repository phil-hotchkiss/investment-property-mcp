import { isDeepStrictEqual } from 'node:util';
import type { Case } from './cases.js';
import { needsClassify, needsJudge, type ResponseType } from './judge.js';
import type { Transcript } from './transcript.js';

export type Verdict = 'pass' | 'fail' | 'na';
export const dimensions = ['toolSelection', 'args', 'answer', 'mentions', 'question'] as const;
export type Dimension = (typeof dimensions)[number];
/** `asked` marks a pass through accept_question: the model asked instead of answering. */
export type Grade = Record<Dimension, Verdict> & {
  overall: boolean;
  details: string[];
  asked?: true;
};

/**
 * What the LLM judge decided about must_mention or the rubric, and how the model responded. See
 * judge.ts. responseType is absent when the judge reply did not parse.
 */
export type JudgeVerdict = {
  pass: boolean;
  missing: string[];
  reason: string;
  responseType?: ResponseType | undefined;
};

type Tolerance = { tolerance?: number | undefined; tolerance_pct?: number | undefined };

/** Absolute tolerance, or percent of the expected value; either passing is enough. Default 0. */
export function within(actual: number, expected: number, t: Tolerance): boolean {
  // The 1e-9 absorbs float error, so 1.24 is within 0.01 of 1.23.
  const diff = Math.abs(actual - expected) - 1e-9;
  return diff <= (t.tolerance ?? 0) || diff <= (Math.abs(expected) * (t.tolerance_pct ?? 0)) / 100;
}

/**
 * Every number written in the text, with where it sits. Strips `$` and thousands commas, ignores a
 * `%` suffix, and reads a `k`/`K` suffix as thousands, so "$392,859", "393k", "7.25%" and "1.23" all
 * parse. Unicode minus, en dash, and em dash read as a hyphen. A minus counts only at the start of
 * a word, so "30-year" and "6-8%" do not go negative. Accounting parentheses, "(1,234)" or
 * "($473)", read as negative.
 * ponytail: no "million", "7 and a quarter", or spelled-out numbers; add when a case needs them.
 * A bare "(2)" list marker reads as -2, which only matters if a case expects -2.
 */
export function scanNumbers(text: string): { value: number; start: number; end: number }[] {
  // One char for one char, so indices still point into the original text.
  const normalized = text.replace(/[\u2212\u2013\u2014]/g, '-');
  const re = /(?:(?<!\w)(-)|(\())?\$?(\d[\d,]*(?:\.\d+)?)([kK](?![a-zA-Z]))?(\))?/g;
  return [...normalized.matchAll(re)].map((m) => {
    const [all, minus, open, digits, k, close] = m;
    const negative = !!minus || (!!open && !!close);
    return {
      value: (negative ? -1 : 1) * Number(digits!.replace(/,/g, '')) * (k ? 1000 : 1),
      start: m.index,
      end: m.index + all.length,
    };
  });
}

export const extractNumbers = (text: string): number[] => scanNumbers(text).map((n) => n.value);

/** Words that say a figure is negative when the model writes it unsigned: "lose $473 a month". */
const lossWords = /negative|loss|lose|short|deficit/i;
const CONTEXT_CHARS = 40;

/**
 * True when some number in the text matches. For a negative expected value, the unsigned figure
 * also matches when a loss word sits within CONTEXT_CHARS characters of it.
 */
export function answerFound(text: string, expected: number, t: Tolerance): boolean {
  return scanNumbers(text).some(
    ({ value, start, end }) =>
      within(value, expected, t) ||
      (expected < 0 &&
        value > 0 &&
        within(-value, expected, t) &&
        lossWords.test(text.slice(Math.max(0, start - CONTEXT_CHARS), end + CONTEXT_CHARS))),
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
  // The judge's responseType when it ran; the transcript's heuristic otherwise (--no-judge).
  const asked = judge?.responseType ? judge.responseType === 'asked_for_info' : t.askedQuestion;
  const source = judge?.responseType
    ? `response: ${judge.responseType} (judge)`
    : `response: ${t.askedQuestion ? 'asked_for_info' : 'answered'} (heuristic)`;

  if (e.accept_question && asked && called.length === 0)
    return {
      toolSelection: 'na',
      args: 'na',
      answer: 'na',
      mentions: 'na',
      question: 'pass',
      overall: true,
      details: ['question: asked, which accept_question allows', source],
      asked: true,
    };

  // Tool selection
  let toolSelection: Verdict = 'na';
  if (canCallTools) {
    const want: string[] = Array.isArray(e.tools) ? e.tools : e.tools.sequence;
    const extra = firstCalls.filter((n) => !want.includes(n));
    const missing = [...new Set(want)].filter((n) => !firstCalls.includes(n));
    if (extra.length) details.push(`tools: unexpected call to ${extra.join(', ')}`);
    if (missing.length) details.push(`tools: never called ${missing.join(', ')}`);
    let ok = !extra.length && !missing.length;
    // Multiset: a name listed n > 1 times must be called exactly n times. Once means one or more.
    if (ok && Array.isArray(e.tools))
      for (const n of new Set(want)) {
        const count = (xs: string[]) => xs.filter((x) => x === n).length;
        if (count(want) > 1 && count(called) !== count(want)) {
          details.push(`tools: ${n} called ${count(called)} times, expected ${count(want)}`);
          ok = false;
        }
      }
    if (ok && !Array.isArray(e.tools) && !isDeepStrictEqual(firstCalls, want)) {
      details.push(`tools: order ${firstCalls.join(' > ')}, expected ${want.join(' > ')}`);
      ok = false;
    }
    toolSelection = ok ? 'pass' : 'fail';
  }

  // Arguments. na for the none harness, which has no calls to inspect. Per tool, the run passes
  // when any one call to it satisfies every expected field, so a corrected retry after a tool
  // error counts. When none does, the details describe the first call.
  let args: Verdict = 'na';
  if (canCallTools && Object.keys(e.args).length) {
    args = 'pass';
    const byTool = new Map<string, [string, string[], (typeof e.args)[string]][]>();
    for (const [key, want] of Object.entries(e.args)) {
      const [tool, ...path] = key.split('.');
      byTool.set(tool!, [...(byTool.get(tool!) ?? []), [key, path, want]]);
    }
    for (const [tool, wants] of byTool) {
      const calls = t.toolCalls.filter((tc) => tc.name === tool);
      const problemsOf = (callArgs: unknown) =>
        wants.flatMap(([key, path, want]) => {
          const actual = get(callArgs, path);
          let problem: string | undefined;
          if (actual === undefined) problem = 'missing';
          else if (typeof want.value === 'number')
            problem =
              typeof actual === 'number' && within(actual, want.value, want)
                ? undefined
                : `got ${JSON.stringify(actual)}, expected ${want.value}`;
          else if (!isDeepStrictEqual(actual, want.value))
            problem = `got ${JSON.stringify(actual)}, expected ${JSON.stringify(want.value)}`;
          return problem ? [`args: ${key} ${problem}`] : [];
        });
      const matched = calls.findIndex((tc) => problemsOf(tc.args).length === 0);
      if (matched > -1) {
        if (calls.length > 1)
          details.push(`args: ${tool} matched call ${matched + 1} of ${calls.length}`);
        continue;
      }
      args = 'fail';
      details.push(
        ...(calls.length
          ? problemsOf(calls[0]!.args)
          : wants.map(([key]) => `args: ${key} no call to ${tool}`)),
      );
    }
  }

  // Answer
  let answer: Verdict = 'na';
  if (Object.keys(e.answer).length) {
    answer = 'pass';
    for (const [key, want] of Object.entries(e.answer)) {
      // resolveCase guarantees value is set; the fallback only satisfies the type.
      const value = want.value ?? NaN;
      if (!answerFound(t.finalText, value, want)) {
        details.push(`answer: ${key} expected ${value}, not found in final text`);
        answer = 'fail';
      }
    }
  }
  if (needsClassify(c) || asked) details.push(source);
  if (!e.expect_question && asked) {
    details.push('answer: asked instead of answering');
    answer = 'fail';
  }

  // Question
  let question: Verdict = 'na';
  if (e.expect_question) {
    question = asked && called.length === 0 ? 'pass' : 'fail';
    if (question === 'fail')
      details.push(
        called.length
          ? `question: called ${called.join(', ')} instead of asking`
          : 'question: did not ask',
      );
  }

  // Mentions: deterministic must_not_mention, then the judge.
  // A judge call made only to classify the response says nothing about mentions.
  const rubricVerdict = judge && needsJudge(c) ? judge : undefined;
  let mentions: Verdict = e.must_not_mention.length || rubricVerdict ? 'pass' : 'na';
  const lower = t.finalText.toLowerCase();
  for (const banned of e.must_not_mention)
    if (lower.includes(banned.toLowerCase())) {
      details.push(`mentions: must not mention "${banned}"`);
      mentions = 'fail';
    }
  if (rubricVerdict && !rubricVerdict.pass) {
    const { missing: m, reason } = rubricVerdict;
    const missing = m.length ? ` (missing: ${m.join(', ')})` : '';
    details.push(`mentions: judge failed${missing}: ${reason}`);
    mentions = 'fail';
  }

  const verdicts = { toolSelection, args, answer, mentions, question };
  return {
    ...verdicts,
    overall: Object.values(verdicts).every((v) => v !== 'fail'),
    details,
  };
}
