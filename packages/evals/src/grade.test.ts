import { describe, expect, test } from 'vitest';
import { resolveCase } from './cases.js';
import { answerFound, extractNumbers, grade, within } from './grade.js';
import { dscrArgs } from './test/fake.js';
import type { Transcript } from './transcript.js';

const mk = (expected: Record<string, unknown>) =>
  resolveCase({ id: 'c', category: 'single-tool', prompt: 'p', expected });

const call = (name: string, args: unknown = {}) => ({
  name,
  args,
  result: { isError: false, text: '' },
});

const tr = (over: Partial<Transcript> = {}): Transcript => ({
  caseId: 'c',
  harness: 'direct',
  model: 'claude-haiku-4-5',
  run: 1,
  messages: [],
  toolCalls: [],
  finalText: '',
  askedQuestion: false,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  durationMs: 0,
  ...over,
});

describe('extractNumbers', () => {
  test.each([
    ['The max offer is $392,859.', [392859]],
    ['about 393k', [393000]],
    ['7.25% for 30-year', [7.25, 30]],
    ['DSCR 1.23', [1.23]],
    ['cash flow -$212 a month', [-212]],
    ['vacancy 6-8%', [6, 8]],
    ['5km and 3 kids', [5, 3]],
    ['no numbers', []],
    ['cash flow \u2212$473 a month', [-473]],
    ['cash flow \u2013473', [-473]],
    ['cash flow \u2014$1,234.50', [-1234.5]],
    ['cash flow (1,234) a year', [-1234]],
    ['cash flow ($473) a month', [-473]],
    ['(30 years)', [30]],
    ['(5%)', [5]],
  ])('%s', (text, numbers) => expect(extractNumbers(text)).toEqual(numbers));
});

describe('answerFound', () => {
  test.each([
    'You would lose $473 a month.',
    'a monthly loss of $473',
    'cash flow is negative: $473 per month',
    'a $473 shortfall every month',
    'You come up $473 short each month',
    'a deficit of 473 a month',
  ])('unsigned figure near a loss word matches a negative: %s', (text) =>
    expect(answerFound(text, -473.49, { tolerance: 5 })).toBe(true),
  );

  test('unsigned figure with no loss word nearby does not match a negative', () => {
    expect(answerFound('Cash flow is $473 a month.', -473.49, { tolerance: 5 })).toBe(false);
    const far = 'You lose money overall.' + ' '.repeat(50) + 'Cash flow $473.';
    expect(answerFound(far, -473.49, { tolerance: 5 })).toBe(false);
  });

  test('a loss word does not make a positive expectation accept a negative', () => {
    expect(answerFound('loss of $473', 473, { tolerance: 5 })).toBe(true);
    expect(answerFound('-$473 loss', 473, { tolerance: 5 })).toBe(false);
  });
});

describe('within', () => {
  test('absolute, percent, and default exact', () => {
    expect(within(393000, 392859, { tolerance_pct: 1 })).toBe(true);
    expect(within(400000, 392859, { tolerance_pct: 1 })).toBe(false);
    expect(within(1.24, 1.23, { tolerance: 0.01 })).toBe(true);
    expect(within(1.24, 1.23, {})).toBe(false);
  });
});

describe('tool selection', () => {
  const set = mk({ tools: ['max_offer', 'stress_test'] });
  const seq = mk({ tools: { sequence: ['max_offer', 'stress_test'] } });
  const calls = (...names: string[]) => tr({ toolCalls: names.map((n) => call(n)) });

  test('set passes in any order, repeats allowed', () => {
    expect(grade(set, calls('stress_test', 'max_offer', 'max_offer')).toolSelection).toBe('pass');
  });

  test('a name listed twice must be called exactly twice', () => {
    const twice = mk({ tools: ['dscr', 'dscr'] });
    expect(grade(twice, calls('dscr', 'dscr')).toolSelection).toBe('pass');
    for (const n of [1, 3]) {
      const g = grade(twice, calls(...Array<string>(n).fill('dscr')));
      expect(g.toolSelection).toBe('fail');
      expect(g.details).toEqual([`tools: dscr called ${n} times, expected 2`]);
    }
    // Names listed once keep set semantics alongside a counted one.
    const mixed = mk({ tools: ['dscr', 'dscr', 'loan_payment'] });
    expect(grade(mixed, calls('loan_payment', 'dscr', 'loan_payment', 'dscr')).toolSelection).toBe(
      'pass',
    );
  });

  test('extra call fails and names the tool', () => {
    const g = grade(set, calls('max_offer', 'stress_test', 'dscr'));
    expect(g.toolSelection).toBe('fail');
    expect(g.details).toContain('tools: unexpected call to dscr');
    expect(g.overall).toBe(false);
  });

  test('missing call fails', () => {
    expect(grade(set, calls('max_offer')).details).toContain('tools: never called stress_test');
  });

  test('sequence checks order of first calls', () => {
    expect(grade(seq, calls('max_offer', 'stress_test', 'max_offer')).toolSelection).toBe('pass');
    const g = grade(seq, calls('stress_test', 'max_offer'));
    expect(g.toolSelection).toBe('fail');
    expect(g.details[0]).toMatch(/order stress_test > max_offer/);
  });

  test('empty expected tools passes only with no calls', () => {
    const none = mk({});
    expect(grade(none, tr()).toolSelection).toBe('pass');
    expect(grade(none, calls('dscr')).toolSelection).toBe('fail');
  });

  test('na for the none harness, as are args', () => {
    const c = mk({ tools: ['dscr'], args: { 'dscr.price': { value: 400000 } } });
    const g = grade(c, tr({ harness: 'none' }));
    expect(g).toMatchObject({ toolSelection: 'na', args: 'na', overall: true });
  });
});

describe('args', () => {
  const c = mk({
    tools: ['dscr'],
    args: {
      'dscr.loan.interestRatePct': { value: 7.25 },
      'dscr.monthlyRent': { value: 3150, tolerance_pct: 2 },
      'dscr.method': { value: 'rentToPitia' },
    },
  });

  test('nested path, tolerance_pct, and exact enum pass', () => {
    expect(grade(c, tr({ toolCalls: [call('dscr', dscrArgs)] })).args).toBe('pass');
  });

  test('wrong number, wrong enum, and missing field fail with messages', () => {
    const bad = { ...dscrArgs, method: 'noi', loan: { termYears: 30 }, monthlyRent: 2000 };
    const g = grade(c, tr({ toolCalls: [call('dscr', bad)] }));
    expect(g.args).toBe('fail');
    expect(g.details).toEqual([
      'args: dscr.loan.interestRatePct missing',
      'args: dscr.monthlyRent got 2000, expected 3150',
      'args: dscr.method got "noi", expected "rentToPitia"',
    ]);
  });

  test('uses the first call to the tool; no call fails', () => {
    const first = { ...dscrArgs, method: 'noi' };
    expect(grade(c, tr({ toolCalls: [call('dscr', first), call('dscr', dscrArgs)] })).args).toBe(
      'fail',
    );
    expect(grade(c, tr()).details).toContain('args: dscr.method no call to dscr');
  });

  test('na when no args expected', () => {
    expect(grade(mk({}), tr()).args).toBe('na');
  });
});

describe('answer', () => {
  const c = mk({ answer: { maxPrice: { value: 392859, tolerance_pct: 1 } } });

  test('any number in the text within tolerance passes', () => {
    expect(grade(c, tr({ finalText: 'Offer up to 393k.' })).answer).toBe('pass');
    expect(grade(c, tr({ finalText: 'Offer up to $392,859.' })).answer).toBe('pass');
  });

  test('fails when no number matches', () => {
    const g = grade(c, tr({ finalText: 'Offer up to $350,000.' }));
    expect(g.answer).toBe('fail');
    expect(g.details).toEqual(['answer: maxPrice expected 392859, not found in final text']);
  });

  test('asking instead of answering fails answer, even with no answer expected', () => {
    const g = grade(mk({}), tr({ askedQuestion: true, finalText: 'Which method?' }));
    expect(g).toMatchObject({ answer: 'fail', question: 'na', overall: false });
    expect(g.details).toContain('answer: asked instead of answering');
  });

  test('na when no answer expected and none asked', () => {
    expect(grade(mk({}), tr()).answer).toBe('na');
  });
});

describe('question', () => {
  const c = mk({ expect_question: true });

  test('passes when it asked and called nothing', () => {
    const g = grade(c, tr({ askedQuestion: true }));
    expect(g).toMatchObject({ question: 'pass', answer: 'na', overall: true });
  });

  test('fails when it did not ask', () => {
    expect(grade(c, tr()).details).toContain('question: did not ask');
  });

  test('fails when it called a tool', () => {
    const g = grade(c, tr({ askedQuestion: true, toolCalls: [call('dscr')] }));
    expect(g.question).toBe('fail');
    expect(g.details).toContain('question: called dscr instead of asking');
  });
});

describe('accept_question', () => {
  const c = mk({ tools: ['dscr'], answer: { dscr: { value: 1.3 } }, accept_question: true });

  test('asking without tools passes, other dimensions na, marked asked', () => {
    const g = grade(c, tr({ askedQuestion: true }), { pass: false, missing: [], reason: 'x' });
    expect(g).toEqual({
      toolSelection: 'na',
      args: 'na',
      answer: 'na',
      mentions: 'na',
      question: 'pass',
      overall: true,
      details: ['question: asked, which accept_question allows'],
      asked: true,
    });
  });

  test('answering is still graded normally', () => {
    const g = grade(c, tr({ toolCalls: [call('dscr')], finalText: 'DSCR 1.30' }));
    expect(g).toMatchObject({
      toolSelection: 'pass',
      answer: 'pass',
      question: 'na',
      overall: true,
    });
    expect(g.asked).toBeUndefined();
  });

  test('without it, asking still fails as before', () => {
    const strict = mk({ tools: ['dscr'], answer: { dscr: { value: 1.3 } } });
    const g = grade(strict, tr({ askedQuestion: true }));
    expect(g).toMatchObject({ toolSelection: 'fail', answer: 'fail', overall: false });
    expect(g.details).toContain('answer: asked instead of answering');
  });
});

describe('mentions', () => {
  const c = mk({ must_not_mention: ['Average DSCR'], must_mention: ['DSCR method'] });

  test('must_not_mention is a case-insensitive substring check', () => {
    const g = grade(c, tr({ finalText: 'The average dscr is 1.3' }));
    expect(g.mentions).toBe('fail');
    expect(g.details).toContain('mentions: must not mention "Average DSCR"');
  });

  test('passes without the judge when nothing banned appears', () => {
    expect(grade(c, tr({ finalText: 'Portfolio DSCR 1.3' })).mentions).toBe('pass');
  });

  test('judge verdict folds in', () => {
    const ok = { pass: true, missing: [], reason: 'fine' };
    const bad = { pass: false, missing: ['DSCR method'], reason: 'no method stated' };
    expect(grade(c, tr(), ok).mentions).toBe('pass');
    const g = grade(c, tr(), bad);
    expect(g.mentions).toBe('fail');
    expect(g.details).toContain('mentions: judge failed (missing: DSCR method): no method stated');
    expect(grade(mk({}), tr(), { ...bad, missing: [] }).details).toContain(
      'mentions: judge failed: no method stated',
    );
  });

  test('na with no must_not_mention and no judge', () => {
    expect(grade(mk({}), tr()).mentions).toBe('na');
  });
});
