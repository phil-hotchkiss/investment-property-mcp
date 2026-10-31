import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveCase } from './cases.js';
import { estimate, main, paths } from './cli.js';
import { fakeClient, text } from './test/fake.js';

const caseYaml = (id: string) => `
id: ${id}
category: single-tool
prompt: What is the payment on a 300k loan at 7.25% for 30 years?
expected:
  tools: [loan_payment]
`;

function casesDir(ids = ['loan-01', 'loan-02', 'dscr-01']) {
  const d = mkdtempSync(join(tmpdir(), 'evals-cases-'));
  for (const id of ids) writeFileSync(join(d, `${id}.yaml`), caseYaml(id));
  return d;
}

async function cli(argv: string[], env: NodeJS.ProcessEnv = {}, deps = {}) {
  const lines: string[] = [];
  const code = await main(argv, env, { casesDir: casesDir(), log: (l) => lines.push(l), ...deps });
  return { code, out: lines.join('\n') };
}

const answer = (n: number) =>
  Array.from({ length: n }, () => ({
    content: [text('About 2,046 dollars per month.')],
    stop_reason: 'end_turn' as const,
    usage: [1000, 100] as [number, number],
  }));

describe('estimate', () => {
  const c = resolveCase({
    id: 'x',
    category: 'single-tool',
    prompt: 'a'.repeat(400),
    expected: {},
  });
  const sizes = { systemPrompt: 400, tools: 4000 };

  test('none is one call with system plus prompt in, 400 out', () => {
    // (400 + 400) / 4 = 200 input tokens per call; 2 runs.
    expect(estimate([c], ['none'], 2, 'claude-haiku-4-5', sizes)).toEqual({
      calls: 2,
      inputTokens: 400,
      outputTokens: 800,
      costUsd: (400 * 1 + 800 * 5) / 1e6,
    });
  });

  test('tool harnesses are three calls resending tools and prior output', () => {
    // per call: 200 + 4000/4 + 400 = 1600; 3 calls.
    expect(estimate([c], ['direct'], 1, 'claude-sonnet-5-5', sizes)).toEqual({
      calls: 3,
      inputTokens: 4800,
      outputTokens: 1200,
      costUsd: (4800 * 2 + 1200 * 10) / 1e6,
    });
  });
});

describe('main', () => {
  test('dry run prints cases, harnesses, and estimate without a key or network', async () => {
    const { code, out } = await cli(['--dry-run', '--runs', '2'], { EVAL_MAX_USD: '5' });
    expect(code).toBe(0);
    expect(out).toContain('cases: 3 (dscr-01, loan-01, loan-02)');
    expect(out).toContain('harnesses: none, direct; runs: 2; model: claude-haiku-4-5');
    expect(out).toMatch(/estimate: 24 calls, \d+ input \+ 9600 output tokens, \$0\.\d{4}/);
    expect(out).toContain('cap: $5.00');
  });

  test('--all and --cases glob select harnesses and cases', async () => {
    const { code, out } = await cli(['--dry-run', '--all', '--cases', 'loan-*']);
    expect(code).toBe(0);
    expect(out).toContain('cases: 2 (loan-01, loan-02)');
    expect(out).toContain('harnesses: none, direct, agent-ts, agent-py');
  });

  test.each([
    [['--harness', 'langchain'], {}, 'unknown harness langchain'],
    [['--runs', '0'], {}, '--runs must be a positive integer'],
    [['--bogus'], {}, "Unknown option '--bogus'"],
    [['--cases', 'zzz'], {}, 'no cases matched'],
    [[], { EVAL_MODEL: 'gpt-x' }, 'EVAL_MODEL=gpt-x has no price'],
    [[], { EVAL_JUDGE_MODEL: 'gpt-x' }, 'EVAL_JUDGE_MODEL=gpt-x has no price'],
    [[], { EVAL_MAX_USD: 'lots' }, 'EVAL_MAX_USD must be a positive number'],
    [[], {}, 'ANTHROPIC_API_KEY is not set. See docs/guides/secrets.md.'],
    [[], { ANTHROPIC_API_KEY: 'k', EVAL_MAX_USD: '0.0001' }, 'exceeds EVAL_MAX_USD'],
    [['--harness', 'agent-ts'], { ANTHROPIC_API_KEY: 'k' }, 'agent-ts is not implemented until M4'],
    [['--publish', '../x'], {}, '--publish name must be'],
  ])('%j %j fails: %s', async (argv, env, message) => {
    const { code, out } = await cli(argv, env);
    expect(code).toBe(1);
    expect(out).toContain(message);
  });

  test('a bad case file fails naming the file', async () => {
    const d = casesDir();
    writeFileSync(join(d, 'zz.yaml'), 'id: x\ncategory: nope\nprompt: p\nexpected: {}\n');
    const { code, out } = await cli([], {}, { casesDir: d });
    expect(code).toBe(1);
    expect(out).toContain('bad case file: zz.yaml');
  });

  test('writes one transcript per case, harness, and run, plus a summary', async () => {
    const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
    const { client, requests } = fakeClient(answer(4));
    const r = await cli(
      ['--harness', 'none', '--runs', '2', '--cases', 'loan-*', '--out', 'res'],
      { INIT_CWD: out },
      { client },
    );
    expect(r.code).toBe(0);
    expect(requests).toHaveLength(4);
    const dir = join(out, 'res');
    expect(readdirSync(dir).sort()).toEqual([
      'loan-01.none.1.json',
      'loan-01.none.2.json',
      'loan-02.none.1.json',
      'loan-02.none.2.json',
      'report.md',
      'summary.json',
    ]);
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      model: 'claude-haiku-4-5',
      judgeModel: 'claude-sonnet-5-5',
      transcripts: 4,
      expectedTranscripts: 4,
      usage: { inputTokens: 4000, outputTokens: 400 },
      stopped: null,
    });
    expect(summary.usage.costUsd).toBeCloseTo(0.006, 10);
    const t = JSON.parse(readFileSync(join(dir, 'loan-01.none.2.json'), 'utf8'));
    expect(t).toMatchObject({ caseId: 'loan-01', harness: 'none', run: 2 });
  });

  test('default out dir is results/<timestamp> and the system prompt file is sent', async () => {
    const { client, requests } = fakeClient(answer(1));
    const r = await cli(
      ['--harness', 'none', '--runs', '1', '--cases', 'dscr-01'],
      { INIT_CWD: tmpdir() },
      {
        client,
        now: () => new Date('2000-01-01T00:00:00.000Z'),
      },
    );
    expect(r.code).toBe(0);
    const dir = join(paths.results, '2000-01-01T00-00-00-000Z');
    expect(r.out).toContain(dir);
    rmSync(dir, { recursive: true });
    expect(requests[0]?.system).toMatch(/ask which one they want/);
  });

  test('default results dir is under the repo, not INIT_CWD', () => {
    expect(paths.results).toBe(join(paths.cases, '..', 'results'));
    expect(paths.results.endsWith(join('packages', 'evals', 'results'))).toBe(true);
    expect(paths.reports.endsWith(join('packages', 'evals', 'reports'))).toBe(true);
  });

  test('--publish copies only report.md and summary.json to reports/<name>', async () => {
    const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
    const reports = mkdtempSync(join(tmpdir(), 'evals-reports-'));
    const { client } = fakeClient(answer(1));
    const r = await cli(
      ['--harness', 'none', '--runs', '1', '--cases', 'dscr-01', '--out', out, '--publish', 'x-1'],
      { INIT_CWD: '/somewhere/else' },
      { client, reportsDir: reports },
    );
    expect(r.code).toBe(0);
    expect(readdirSync(join(reports, 'x-1')).sort()).toEqual(['report.md', 'summary.json']);
    expect(readdirSync(out)).toContain('dscr-01.none.1.json');
    expect(r.out).toContain(`published report.md and summary.json to ${join(reports, 'x-1')}`);
  });

  test('aborts when actual spend crosses the cap, keeping what it wrote', async () => {
    const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
    // Each call reports 100k input tokens ($0.10), far above the estimate.
    const { client } = fakeClient(
      answer(9).map((t) => ({ ...t, usage: [100_000, 0] as [number, number] })),
    );
    const r = await cli(
      ['--harness', 'none', '--runs', '3', '--out', out],
      { EVAL_MAX_USD: '0.15' },
      { client },
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('stopped early: spend $0.2000 crossed EVAL_MAX_USD $0.15');
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({ transcripts: 2, expectedTranscripts: 9 });
  });

  test('a harness error stops the run and still writes the summary', async () => {
    const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
    const { client } = fakeClient(answer(1));
    const r = await cli(
      ['--harness', 'none', '--runs', '2', '--cases', 'dscr-01', '--out', out],
      {},
      { client },
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('fake client ran out of scripted turns');
    expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).transcripts).toBe(1);
  });

  describe('grading and judge', () => {
    const judged = () => {
      const d = casesDir(['loan-01']);
      writeFileSync(
        join(d, 'loan-01.yaml'),
        caseYaml('loan-01') +
          '  answer:\n    payment: { value: 2046, tolerance: 1 }\n  must_mention: [monthly]\n',
      );
      return d;
    };
    const verdict = (pass: boolean) => ({
      content: [text(JSON.stringify({ pass, missing: pass ? [] : ['monthly'], reason: 'r' }))],
      stop_reason: 'end_turn' as const,
      usage: [500, 50] as [number, number],
    });

    test('dry run estimates judge calls; --harness takes a comma list', async () => {
      const { code, out } = await cli(
        ['--dry-run', '--harness', 'none,direct', '--runs', '2'],
        {},
        { casesDir: judged() },
      );
      expect(code).toBe(0);
      expect(out).toContain('harnesses: none, direct; runs: 2');
      expect(out).toMatch(
        /judge estimate: 4 calls on claude-sonnet-5-5, \d+ input \+ 1600 output tokens/,
      );
    });

    test('grades, judges, and writes the report', async () => {
      const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
      // The none run, then the judge for it.
      const { client, requests } = fakeClient([...answer(1), verdict(true)]);
      const r = await cli(
        ['--harness', 'none', '--runs', '1', '--out', out],
        {},
        { client, casesDir: judged() },
      );
      expect(r.code).toBe(0);
      expect(requests[1]?.model).toBe('claude-sonnet-5-5');
      const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
      expect(summary).toMatchObject({
        passed: 1,
        pricingDate: '2026-10-30',
        judge: { calls: 1, inputTokens: 500 },
      });
      expect(summary.graded[0].grade).toMatchObject({
        toolSelection: 'na',
        answer: 'pass',
        mentions: 'pass',
      });
      expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('| all | 1/1 (100%) |');
      expect(r.out).toContain('1/1 passed');
    });

    test('a failing judge verdict fails mentions', async () => {
      const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
      const { client } = fakeClient([...answer(1), verdict(false)]);
      await cli(
        ['--harness', 'none', '--runs', '1', '--out', out],
        {},
        { client, casesDir: judged() },
      );
      const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
      expect(summary.graded[0].grade).toMatchObject({ mentions: 'fail', overall: false });
    });

    test('--no-judge makes no judge call and leaves mentions na', async () => {
      const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
      const { client, requests } = fakeClient(answer(1));
      const r = await cli(
        ['--harness', 'none', '--runs', '1', '--no-judge', '--out', out],
        {},
        { client, casesDir: judged() },
      );
      expect(r.code).toBe(0);
      expect(r.out).toContain('judge: off (--no-judge)');
      expect(requests).toHaveLength(1);
      const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
      expect(summary.graded[0].grade.mentions).toBe('na');
    });

    test('judge spend crossing the cap stops judging the rest', async () => {
      const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
      const pricey = { ...verdict(true), usage: [200_000, 0] as [number, number] };
      const { client, requests } = fakeClient([...answer(2), pricey]);
      const r = await cli(
        ['--harness', 'none', '--runs', '2', '--out', out],
        { EVAL_MAX_USD: '0.3' },
        { client, casesDir: judged() },
      );
      expect(r.code).toBe(1);
      expect(r.out).toContain('while judging');
      expect(requests).toHaveLength(3);
      const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
      expect(summary.graded[1].grade.details).toContain('mentions: judge skipped');
    });

    test('an out-of-scope case is judged only for its response type', async () => {
      const d = casesDir(['oos-01']);
      writeFileSync(
        join(d, 'oos-01.yaml'),
        'id: oos-01\ncategory: out-of-scope\nprompt: p\nexpected: {}\n',
      );
      const decline = (n: number) =>
        Array.from({ length: n }, () => ({
          content: [text('I only do deal math. Could you ask a CPA?')],
          stop_reason: 'end_turn' as const,
        }));
      const declined = {
        content: [
          text(JSON.stringify({ pass: true, missing: [], reason: 'r', responseType: 'declined' })),
        ],
        stop_reason: 'end_turn' as const,
      };
      const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
      const { client, requests } = fakeClient([...decline(1), declined]);
      await cli(['--harness', 'none', '--runs', '1', '--out', out], {}, { client, casesDir: d });
      expect(requests[1]!.messages[0]!.content).toMatch(/No rubric/);
      const g = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).graded[0].grade;
      expect(g).toMatchObject({ overall: true, mentions: 'na' });
      expect(g.details).toEqual(['response: declined (judge)']);

      // --no-judge falls back to the heuristic, which reads the decline as a question.
      const out2 = mkdtempSync(join(tmpdir(), 'evals-out-'));
      const r = fakeClient(decline(1));
      await cli(
        ['--harness', 'none', '--runs', '1', '--no-judge', '--out', out2],
        {},
        {
          client: r.client,
          casesDir: d,
        },
      );
      const g2 = JSON.parse(readFileSync(join(out2, 'summary.json'), 'utf8')).graded[0].grade;
      expect(g2.overall).toBe(false);
      expect(g2.details).toContain('response: asked_for_info (heuristic)');
    });

    test('a judge error stops judging and is reported', async () => {
      const out = mkdtempSync(join(tmpdir(), 'evals-out-'));
      const { client } = fakeClient(answer(1));
      const r = await cli(
        ['--harness', 'none', '--runs', '1', '--out', out],
        {},
        { client, casesDir: judged() },
      );
      expect(r.out).toContain('stopped early: judge: fake client ran out of scripted turns');
    });
  });

  describe('report --merge', () => {
    const results = (model: string) => {
      const d = mkdtempSync(join(tmpdir(), 'evals-res-'));
      const s = {
        model,
        judgeModel: 'claude-sonnet-5-5',
        harnesses: ['direct'],
        runs: 1,
        pricingDate: '2026-10-30',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        judge: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        startedAt: '2026-10-30T00:00:00.000Z',
        stopped: null,
        graded: [],
      };
      writeFileSync(join(d, 'summary.json'), JSON.stringify(s));
      return d;
    };

    test('prints one table with model columns', async () => {
      const { code, out } = await cli(['report', '--merge', results('a'), results('b')]);
      expect(code).toBe(0);
      expect(out).toContain('| Category | direct / a | direct / b |');
    });

    test.each([
      [['report', results('a')], 'usage: evals report --merge'],
      [['report', '--merge', results('a')], 'usage: evals report --merge'],
      [['report', '--bogus'], "Unknown option '--bogus'"],
      [
        ['report', '--merge', results('a'), '/nonexistent'],
        'cannot read /nonexistent/summary.json',
      ],
    ])('%j fails: %s', async (argv, message) => {
      const { code, out } = await cli(argv);
      expect(code).toBe(1);
      expect(out).toContain(message);
    });
  });
});
