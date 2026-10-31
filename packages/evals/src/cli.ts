import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '@rental-deal-math/mcp-server/server';
import { type Case, loadCases } from './cases.js';
import { grade } from './grade.js';
import type { Harness, MessagesClient } from './harness/common.js';
import { direct } from './harness/direct.js';
import { none } from './harness/none.js';
import {
  callsJudge,
  JUDGE_SYSTEM,
  judge,
  type JudgeResult,
  needsJudge,
  rubricFor,
} from './judge.js';
import { costUsd, DEFAULT_JUDGE_MODEL, DEFAULT_MODEL, PRICING_DATE, pricing } from './pricing.js';
import { type GradedRun, renderReport, type Summary, writeResults } from './report.js';
import { type HarnessName, harnessNames, type Transcript } from './transcript.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
export const paths = {
  cases: resolve(repoRoot, 'packages/evals/cases'),
  /** Transcripts, summary, and report per run. Gitignored. */
  results: resolve(repoRoot, 'packages/evals/results'),
  /** Committed reports, copied here by --publish. */
  reports: resolve(repoRoot, 'packages/evals/reports'),
  systemPrompt: resolve(repoRoot, 'docs/agent/system-prompt.md'),
};

const pending: Partial<Record<HarnessName, string>> = { 'agent-ts': 'M4', 'agent-py': 'M5' };
const notImplemented =
  (name: HarnessName): Harness =>
  () => {
    throw new Error(`harness ${name} is not implemented until ${pending[name]}`);
  };
export const harnesses: Record<HarnessName, Harness> = {
  none,
  direct,
  'agent-ts': notImplemented('agent-ts'),
  'agent-py': notImplemented('agent-py'),
};

/** Characters per token for estimates. ponytail: rough English average, not a tokenizer. */
const CHARS_PER_TOKEN = 4;
/** Assumed model calls and output tokens per call when estimating. Tool loops average ~3 calls. */
const TOOL_TURNS = 3;
const OUTPUT_PER_CALL = 400;

export type Estimate = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

/**
 * Upper-ish estimate. Every call resends system prompt and user prompt; tool-using harnesses also
 * resend the tool definitions and prior output each of TOOL_TURNS calls.
 */
export function estimate(
  cases: Case[],
  selected: HarnessName[],
  runs: number,
  model: string,
  sizes: { systemPrompt: number; tools: number },
): Estimate {
  let calls = 0;
  let inputTokens = 0;
  for (const c of cases)
    for (const h of selected) {
      const base = (sizes.systemPrompt + c.prompt.length) / CHARS_PER_TOKEN;
      const n = h === 'none' ? 1 : TOOL_TURNS;
      const perCall = h === 'none' ? base : base + sizes.tools / CHARS_PER_TOKEN + OUTPUT_PER_CALL;
      calls += n * runs;
      inputTokens += Math.ceil(perCall) * n * runs;
    }
  const outputTokens = calls * OUTPUT_PER_CALL;
  return { calls, inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) };
}

/**
 * Judge calls: one per transcript whose case needs the judge for a rubric or to classify the
 * response. Input is the rubric, prompt, and an
 * answer of OUTPUT_PER_CALL tokens; output is OUTPUT_PER_CALL.
 */
export function estimateJudge(
  cases: Case[],
  selected: HarnessName[],
  runs: number,
  model: string,
): Estimate {
  const judged = cases.filter(callsJudge);
  const calls = judged.length * selected.length * runs;
  const inputTokens = judged.reduce(
    (n, c) =>
      n +
      (Math.ceil((JUDGE_SYSTEM.length + rubricFor(c).length + c.prompt.length) / CHARS_PER_TOKEN) +
        OUTPUT_PER_CALL) *
        selected.length *
        runs,
    0,
  );
  const outputTokens = calls * OUTPUT_PER_CALL;
  return { calls, inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) };
}

/** Length of the tool definitions the direct harness sends, read from the server in memory. */
async function toolsChars(): Promise<number> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'estimate', version: '0.0.0' });
  await createServer().connect(serverSide);
  await mcp.connect(clientSide);
  const { tools } = await mcp.listTools();
  await mcp.close();
  return JSON.stringify(
    tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
  ).length;
}

type Deps = {
  client?: MessagesClient;
  log?: (line: string) => void;
  casesDir?: string;
  reportsDir?: string;
  now?: () => Date;
};

/** Parses argv and env, runs the evals, returns the process exit code. */
export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: Deps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const fail = (msg: string) => {
    log(`error: ${msg}`);
    return 1;
  };

  if (argv[0] === 'report') return report(argv.slice(1), env, log);

  let opts;
  try {
    opts = parseArgs({
      args: argv,
      options: {
        harness: { type: 'string', multiple: true },
        all: { type: 'boolean', default: false },
        runs: { type: 'string', default: '3' },
        cases: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        out: { type: 'string' },
        'no-judge': { type: 'boolean', default: false },
        publish: { type: 'string' },
      },
    }).values;
  } catch (e) {
    return fail((e as Error).message);
  }

  const selected: HarnessName[] = opts.all
    ? [...harnessNames]
    : ((opts.harness ?? ['none,direct']).flatMap((h) => h.split(',')) as HarnessName[]);
  const unknown = selected.filter((h) => !harnessNames.includes(h));
  if (unknown.length) return fail(`unknown harness ${unknown.join(', ')}`);
  if (opts.publish !== undefined && !/^[\w-][\w.-]*$/.test(opts.publish))
    return fail(`--publish name must be letters, digits, dots, dashes, or underscores`);
  const runs = Number(opts.runs);
  if (!Number.isInteger(runs) || runs < 1) return fail(`--runs must be a positive integer`);

  const model = env.EVAL_MODEL || DEFAULT_MODEL;
  const judgeModel = env.EVAL_JUDGE_MODEL || DEFAULT_JUDGE_MODEL;
  for (const [name, m] of [
    ['EVAL_MODEL', model],
    ['EVAL_JUDGE_MODEL', judgeModel],
  ] as const)
    if (!pricing[m])
      return fail(`${name}=${m} has no price in pricing.ts (${Object.keys(pricing).join(', ')})`);
  const maxUsd = env.EVAL_MAX_USD ? Number(env.EVAL_MAX_USD) : undefined;
  if (maxUsd !== undefined && !(maxUsd > 0)) return fail(`EVAL_MAX_USD must be a positive number`);

  let cases: Case[];
  try {
    cases = loadCases(deps.casesDir ?? paths.cases);
  } catch (e) {
    return fail(`bad case file: ${(e as Error).message}`);
  }
  if (opts.cases) {
    const pattern = new RegExp(
      `^${opts.cases.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    cases = cases.filter((c) => pattern.test(c.id));
  }
  if (cases.length === 0) return fail('no cases matched');

  const systemPrompt = readFileSync(paths.systemPrompt, 'utf8');
  const est = estimate(cases, selected, runs, model, {
    systemPrompt: systemPrompt.length,
    tools: await toolsChars(),
  });
  log(`cases: ${cases.length} (${cases.map((c) => c.id).join(', ')})`);
  log(`harnesses: ${selected.join(', ')}; runs: ${runs}; model: ${model}`);
  log(
    `estimate: ${est.calls} calls, ${est.inputTokens} input + ${est.outputTokens} output tokens, $${est.costUsd.toFixed(4)}`,
  );
  const useJudge = !opts['no-judge'];
  const judgeEst = useJudge
    ? estimateJudge(cases, selected, runs, judgeModel)
    : { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  log(
    useJudge
      ? `judge estimate: ${judgeEst.calls} calls on ${judgeModel}, ${judgeEst.inputTokens} input + ${judgeEst.outputTokens} output tokens, $${judgeEst.costUsd.toFixed(4)}`
      : 'judge: off (--no-judge), mentions graded na unless must_not_mention is set',
  );
  if (maxUsd !== undefined) log(`cap: $${maxUsd.toFixed(2)} (EVAL_MAX_USD)`);
  if (opts['dry-run']) return 0;

  const notReady = selected.filter((h) => pending[h]);
  if (notReady.length)
    return fail(notReady.map((h) => `${h} is not implemented until ${pending[h]}`).join('; '));
  const estTotal = est.costUsd + judgeEst.costUsd;
  if (maxUsd !== undefined && estTotal > maxUsd)
    return fail(`estimate $${estTotal.toFixed(4)} exceeds EVAL_MAX_USD $${maxUsd.toFixed(2)}`);
  if (!deps.client && !env.ANTHROPIC_API_KEY)
    return fail('ANTHROPIC_API_KEY is not set. See docs/secrets.md.');
  const client = deps.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const now = (deps.now ?? (() => new Date()))();
  const outDir = opts.out
    ? resolve(env.INIT_CWD ?? process.cwd(), opts.out)
    : resolve(paths.results, now.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });

  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const transcripts: [Case, Transcript][] = [];
  let stopped: string | undefined;
  const start = performance.now();
  try {
    outer: for (const c of cases)
      for (const h of selected)
        for (let run = 1; run <= runs; run++) {
          const t: Transcript = await harnesses[h]({ case: c, run, model, systemPrompt, client });
          writeFileSync(resolve(outDir, `${c.id}.${h}.${run}.json`), JSON.stringify(t, null, 2));
          transcripts.push([c, t]);
          totals.inputTokens += t.usage.inputTokens;
          totals.outputTokens += t.usage.outputTokens;
          totals.costUsd += t.usage.costUsd;
          log(
            `${c.id} ${h} #${run}: ${t.toolCalls.length} tool calls, $${t.usage.costUsd.toFixed(4)}`,
          );
          // ponytail: checked between transcripts, so one call can overshoot the cap.
          if (maxUsd !== undefined && totals.costUsd > maxUsd) {
            stopped = `spend $${totals.costUsd.toFixed(4)} crossed EVAL_MAX_USD $${maxUsd.toFixed(2)}`;
            break outer;
          }
        }
  } catch (e) {
    stopped = (e as Error).message;
  }
  // Judge, then grade. Judge spend counts toward the cap; once it is crossed, or a judge call
  // throws, the remaining runs are graded without the judge.
  const judgeTotals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const graded: GradedRun[] = [];
  for (const [c, t] of transcripts) {
    let verdict: JudgeResult | undefined;
    if (useJudge && callsJudge(c) && !stopped)
      try {
        verdict = await judge({ case: c, transcript: t, model: judgeModel, client });
        judgeTotals.calls++;
        judgeTotals.inputTokens += verdict.usage.inputTokens;
        judgeTotals.outputTokens += verdict.usage.outputTokens;
        judgeTotals.costUsd += verdict.usage.costUsd;
        if (maxUsd !== undefined && totals.costUsd + judgeTotals.costUsd > maxUsd)
          stopped = `spend $${(totals.costUsd + judgeTotals.costUsd).toFixed(4)} crossed EVAL_MAX_USD $${maxUsd.toFixed(2)} while judging`;
      } catch (e) {
        stopped = `judge: ${(e as Error).message}`;
      }
    const g = grade(c, t, verdict);
    if (useJudge && needsJudge(c) && !verdict) g.details.push('mentions: judge skipped');
    graded.push({
      caseId: c.id,
      category: c.category,
      ...(c.evidence ? { evidence: c.evidence } : {}),
      harness: t.harness,
      model: t.model,
      run: t.run,
      grade: g,
      finalText: t.finalText,
    });
  }

  const summary = {
    model,
    judgeModel,
    harnesses: selected,
    runs,
    cases: cases.map((c) => c.id),
    transcripts: transcripts.length,
    expectedTranscripts: cases.length * selected.length * runs,
    passed: graded.filter((g) => g.grade.overall).length,
    usage: totals,
    judge: judgeTotals,
    estimate: est,
    judgeEstimate: judgeEst,
    pricingDate: PRICING_DATE,
    stopped: stopped ?? null,
    startedAt: now.toISOString(),
    durationMs: performance.now() - start,
    graded,
  };
  writeResults(outDir, summary);
  log(
    `wrote ${transcripts.length} transcripts, summary.json, and report.md to ${outDir}; ${summary.passed}/${graded.length} passed; spent $${(totals.costUsd + judgeTotals.costUsd).toFixed(4)}`,
  );
  if (opts.publish) {
    // Transcripts stay in the gitignored results dir; only the report and summary are committed.
    const dest = resolve(deps.reportsDir ?? paths.reports, opts.publish);
    mkdirSync(dest, { recursive: true });
    for (const f of ['report.md', 'summary.json']) cpSync(resolve(outDir, f), resolve(dest, f));
    log(`published report.md and summary.json to ${dest}`);
  }
  return stopped ? fail(`stopped early: ${stopped}`) : 0;
}

/** `report --merge <dir> <dir>...`: one report over several results dirs, printed to stdout. */
function report(argv: string[], env: NodeJS.ProcessEnv, log: (line: string) => void): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { merge: { type: 'boolean', default: false } },
      allowPositionals: true,
    });
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return 1;
  }
  if (!parsed.values.merge || parsed.positionals.length < 2) {
    log('error: usage: evals report --merge <results dir> <results dir> [...]');
    return 1;
  }
  const summaries: Summary[] = [];
  for (const dir of parsed.positionals) {
    const file = resolve(env.INIT_CWD ?? process.cwd(), dir, 'summary.json');
    try {
      summaries.push(JSON.parse(readFileSync(file, 'utf8')) as Summary);
    } catch (e) {
      log(`error: cannot read ${file}: ${(e as Error).message}`);
      return 1;
    }
  }
  log(renderReport(summaries));
  return 0;
}
