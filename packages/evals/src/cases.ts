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

export const caseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and dashes'),
  category: z.enum(categories),
  prompt: z.string().min(1),
  evidence: z.string().optional(),
  compute: z.strictObject({ tool: toolName, input: z.record(z.string(), z.unknown()) }).optional(),
  expected: z.strictObject({
    tools: z
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
  const { values } = coreTools[c.compute.tool](c.compute.input);
  for (const [key, a] of missing) {
    const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], values);
    if (typeof v !== 'number')
      throw new Error(
        `answer ${key}: ${c.compute.tool} returned ${JSON.stringify(v)}, not a number`,
      );
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
