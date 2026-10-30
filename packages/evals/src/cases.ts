import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@rental-deal-math/core';
import { parse } from 'yaml';
import { z } from 'zod';

export const categories = [
  'single-tool',
  'chaining',
  'unit-traps',
  'method-ambiguity',
  'portfolio-trap',
  'missing-info',
  'out-of-scope',
  'error-recovery',
] as const;

/** Core function behind each MCP tool name. The loader uses it to fill expected answers. */
export const coreTools = {
  loan_payment: core.loanPayment,
  dscr: core.dscr,
  cash_on_cash: core.cashOnCash,
  deal_analysis: core.dealAnalysis,
  max_offer: core.maxOffer,
  stress_test: core.stressTest,
  portfolio_rollup: core.portfolioRollup,
} as const satisfies Record<string, (raw: unknown) => { values: unknown }>;
const toolNames = Object.keys(coreTools) as [keyof typeof coreTools, ...(keyof typeof coreTools)[]];
const toolName = z.enum(toolNames);

const tolerances = {
  tolerance: z.number().nonnegative().optional(),
  tolerance_pct: z.number().nonnegative().optional(),
};

const input = z.record(z.string(), z.unknown());
const computeBlock = z.strictObject({ tool: toolName, input });
const computeList = z
  .array(z.strictObject({ key: z.string().regex(/^\w+$/), tool: toolName, input }))
  .min(1);
/**
 * One block fills every answer key; a list of keyed blocks fills answers named `<key>.<path>`.
 * Picks the schema by shape rather than z.union, whose error hides which field was wrong.
 */
const compute = z
  .unknown()
  .transform((v, ctx): z.infer<typeof computeBlock | typeof computeList> => {
    const r = (Array.isArray(v) ? computeList : computeBlock).safeParse(v);
    if (!r.success) {
      for (const issue of r.error.issues)
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path, input: v });
      return z.NEVER;
    }
    return r.data;
  });

export const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and dashes'),
  category: z.enum(categories),
  prompt: z.string().min(1),
  evidence: z.string().optional(),
  compute: compute.optional(),
  expected: z.strictObject({
    tools: z
      // A list is a set, except a name listed n > 1 times must be called exactly n times.
      .union([z.array(toolName), z.strictObject({ sequence: z.array(toolName) })])
      .default([]),
    args: z
      .record(
        z.string().regex(/^[a-z_]+\..+$/, 'tool.field'),
        z.strictObject({ value: z.unknown(), ...tolerances }),
      )
      .default({}),
    // value omitted means "fill from compute": the key is a dotted path into the result's values.
    answer: z
      .record(z.string(), z.strictObject({ value: z.number().optional(), ...tolerances }))
      .default({}),
    must_mention: z.array(z.string()).default([]),
    must_not_mention: z.array(z.string()).default([]),
    expect_question: z.literal(true).optional(),
    // Asking without calling tools is also a pass, for prompts where a stated assumption or a
    // question are both acceptable.
    accept_question: z.boolean().optional(),
    rubric: z.string().optional(),
  }),
});

export type Case = z.infer<typeof caseSchema>;

/** Validates one parsed YAML document and fills omitted answer values by running core. */
export function resolveCase(raw: unknown): Case {
  const c = caseSchema.parse(raw);
  const missing = Object.entries(c.expected.answer).filter(([, a]) => a.value === undefined);
  if (missing.length === 0) return c;
  if (!c.compute)
    throw new Error(
      `answer ${missing.map(([k]) => k).join(', ')} has no value and the case has no compute block`,
    );
  const blocks = Array.isArray(c.compute) ? c.compute : [{ ...c.compute, key: undefined }];
  const results = new Map(blocks.map((b) => [b.key, coreTools[b.tool](b.input).values]));
  for (const [key, a] of missing) {
    const dot = key.indexOf('.');
    const [blockKey, path] = !Array.isArray(c.compute)
      ? [undefined, key]
      : dot < 0
        ? [key, '']
        : [key.slice(0, dot), key.slice(dot + 1)];
    const block = blocks.find((b) => b.key === blockKey);
    if (!block || path === '')
      throw new Error(`answer ${key}: must be <key>.<path> naming a compute block`);
    const v = path
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], results.get(blockKey));
    if (typeof v !== 'number')
      throw new Error(`answer ${key}: ${block.tool} returned ${JSON.stringify(v)}, not a number`);
    a.value = v;
  }
  return c;
}

/** Loads every cases/*.yaml in dir, sorted by file name. Throws naming the bad file. */
export function loadCases(dir: string): Case[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  const cases = files.map((f) => {
    try {
      return resolveCase(parse(readFileSync(join(dir, f), 'utf8')));
    } catch (e) {
      const msg = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
      throw new Error(`${f}: ${msg}`, { cause: e });
    }
  });
  const ids = cases.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate case id ${dup}`);
  return cases;
}
