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
    [[], {}, 'ANTHROPIC_API_KEY is not set. See docs/secrets.md.'],
    [[], { ANTHROPIC_API_KEY: 'k', EVAL_MAX_USD: '0.0001' }, 'exceeds EVAL_MAX_USD'],
    [['--harness', 'agent-ts'], { ANTHROPIC_API_KEY: 'k' }, 'agent-ts is not implemented until M4'],
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
      {},
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
});
