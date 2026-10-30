import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '@rental-deal-math/mcp-server/server';
import { type Case, loadCases } from './cases.js';
import type { Harness, MessagesClient } from './harness/common.js';
import { direct } from './harness/direct.js';
import { none } from './harness/none.js';
import { costUsd, DEFAULT_JUDGE_MODEL, DEFAULT_MODEL, pricing } from './pricing.js';
import { type HarnessName, harnessNames, type Transcript } from './transcript.js';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
export const paths = {
  cases: resolve(pkgDir, 'cases'),
  results: resolve(pkgDir, 'results'),
  systemPrompt: resolve(pkgDir, '../../docs/agent/system-prompt.md'),
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
      },
    }).values;
  } catch (e) {
    return fail((e as Error).message);
  }

  const selected: HarnessName[] = opts.all
    ? [...harnessNames]
    : ((opts.harness ?? ['none', 'direct']) as HarnessName[]);
  const unknown = selected.filter((h) => !harnessNames.includes(h));
  if (unknown.length) return fail(`unknown harness ${unknown.join(', ')}`);
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
  if (maxUsd !== undefined) log(`cap: $${maxUsd.toFixed(2)} (EVAL_MAX_USD)`);
  if (opts['dry-run']) return 0;

  const notReady = selected.filter((h) => pending[h]);
  if (notReady.length)
    return fail(notReady.map((h) => `${h} is not implemented until ${pending[h]}`).join('; '));
  if (maxUsd !== undefined && est.costUsd > maxUsd)
    return fail(`estimate $${est.costUsd.toFixed(4)} exceeds EVAL_MAX_USD $${maxUsd.toFixed(2)}`);
  if (!deps.client && !env.ANTHROPIC_API_KEY)
    return fail('ANTHROPIC_API_KEY is not set. See docs/secrets.md.');
  const client = deps.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const now = (deps.now ?? (() => new Date()))();
  const outDir = opts.out
    ? resolve(env.INIT_CWD ?? process.cwd(), opts.out)
    : resolve(paths.results, now.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });

  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let written = 0;
  let stopped: string | undefined;
  const start = performance.now();
  try {
    outer: for (const c of cases)
      for (const h of selected)
        for (let run = 1; run <= runs; run++) {
          const t: Transcript = await harnesses[h]({ case: c, run, model, systemPrompt, client });
          writeFileSync(resolve(outDir, `${c.id}.${h}.${run}.json`), JSON.stringify(t, null, 2));
          written++;
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
  const summary = {
    model,
    judgeModel,
    harnesses: selected,
    runs,
    cases: cases.map((c) => c.id),
    transcripts: written,
    expectedTranscripts: cases.length * selected.length * runs,
    usage: totals,
    estimate: est,
    stopped: stopped ?? null,
    startedAt: now.toISOString(),
    durationMs: performance.now() - start,
  };
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  log(
    `wrote ${written} transcripts and summary.json to ${outDir}; spent $${totals.costUsd.toFixed(4)}`,
  );
  return stopped ? fail(`stopped early: ${stopped}`) : 0;
}
