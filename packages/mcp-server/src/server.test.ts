import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as core from '@rental-deal-math/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { descriptions, type ToolName } from './descriptions.js';
import { teachingError } from './errors.js';
import { createServer } from './server.js';
import { pct, ratio, usd } from './summaries.js';

let client: Client;

beforeAll(async () => {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await createServer().connect(serverSide);
  await client.connect(clientSide);
});

type Text = { type: 'text'; text: string };
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { ...r, text: (r.content as Text[])[0]?.text ?? '' };
};

/** The example call embedded in each description. */
const example = (name: ToolName) => JSON.parse(descriptions[name].split('Example call: ')[1] ?? '');

// Each tool: its core function and the headline number its summary must contain.
const tools: Record<ToolName, { fn: (raw: unknown) => { values: unknown }; headline: string }> =
  (() => {
    const run = <T>(
      name: ToolName,
      fn: (raw: unknown) => core.CalcResult<T>,
      h: (v: T) => string,
    ) => ({ fn, headline: h(fn(example(name)).values) }) as const;
    return {
      loan_payment: run('loan_payment', core.loanPayment, (v) => usd(v.monthlyPayment)),
      dscr: run('dscr', core.dscr, (v) => ratio(v.dscr)),
      cash_on_cash: run('cash_on_cash', core.cashOnCash, (v) => pct(v.cashOnCashPct)),
      deal_analysis: run('deal_analysis', core.dealAnalysis, (v) => usd(v.annualNoi)),
      max_offer: run('max_offer', core.maxOffer, (v) => usd(v.maxPrice ?? NaN)),
      stress_test: run('stress_test', core.stressTest, (v) => ratio(v.base.dscr)),
      portfolio_rollup: run('portfolio_rollup', core.portfolioRollup, (v) =>
        ratio(v.portfolioDscr),
      ),
    };
  })();

type JsonSchema = {
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};
/** Paths of every property, at any depth, that lacks a description. */
function undescribed(s: JsonSchema, path = ''): string[] {
  const own = Object.entries(s.properties ?? {}).flatMap(([k, p]) => [
    ...(p.description?.trim() ? [] : [`${path}${k}`]),
    ...undescribed(p, `${path}${k}.`),
  ]);
  return s.items ? [...own, ...undescribed(s.items, `${path}[].`)] : own;
}

describe('listTools', () => {
  test('returns exactly the seven tools, each described, annotated, and fully documented', async () => {
    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(Object.keys(tools).sort());
    for (const t of listed) {
      expect(t.description).toBe(descriptions[t.name as ToolName]);
      expect(t.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(Object.keys(t.inputSchema.properties ?? {}).length).toBeGreaterThan(2);
      expect(undescribed(t.inputSchema as JsonSchema), t.name).toEqual([]);
      expect(t.outputSchema?.required).toEqual(['values', 'assumptions', 'warnings']);
    }
  });

  test('input schemas keep required fields from core', async () => {
    const { tools: listed } = await client.listTools();
    const dscrTool = listed.find((t) => t.name === 'dscr');
    expect(dscrTool?.inputSchema.required).toContain('method');
  });
});

describe('each tool', () => {
  test.each(Object.keys(tools) as ToolName[])(
    '%s returns the core result and a summary with the headline number',
    async (name) => {
      const r = await call(name, example(name));
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual(tools[name].fn(example(name)));
      expect(r.text).toContain(tools[name].headline);
      const lines = r.text.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(4);
    },
  );
});

describe('input errors', () => {
  const dscrArgs = example('dscr');

  test('a decimal rate is a tool error that says what was meant and where', async () => {
    const r = await call('dscr', { ...dscrArgs, loan: { interestRatePct: 0.0725, termYears: 30 } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('interestRatePct was 0.0725.');
    expect(r.text).toContain('did you mean 7.25');
    expect(r.text).toContain('at loan.interestRatePct');
  });

  test('a missing DSCR method is a tool error naming method', async () => {
    const noMethod = { ...dscrArgs };
    delete noMethod.method;
    const r = await call('dscr', noMethod);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('at method');
  });

  test('giving both tax forms is a tool error naming both fields', async () => {
    const r = await call('dscr', { ...dscrArgs, propertyTaxPctOfPrice: 1.2 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('annualPropertyTax');
    expect(r.text).toContain('propertyTaxPctOfPrice');
  });

  test('giving no financing form is a tool error naming financing', async () => {
    const r = await call('dscr', { ...dscrArgs, financing: {} });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('financing');
  });

  test('errors core raises after parsing are formatted with a fix line', async () => {
    const r = await call('dscr', { ...dscrArgs, financing: { loanAmount: 500000 } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('financing.loanAmount: loanAmount was 500000.');
    expect(r.text.split('\n').at(-1)).toBe('Fix the input and call the tool again.');
  });

  test('unknown errors rethrow', () => {
    expect(() => teachingError(new Error('boom'))).toThrow('boom');
  });
});

describe('summaries', () => {
  test('portfolio_rollup says the portfolio DSCR is not the average of ratios', async () => {
    const r = await call('portfolio_rollup', example('portfolio_rollup'));
    expect(r.text).toContain('not the average');
  });

  test('warnings appear on their own line', async () => {
    const r = await call('portfolio_rollup', example('portfolio_rollup'));
    expect(r.text.split('\n').at(-1)).toMatch(/^Warnings: Below 1.0 DSCR: Condo/);
  });

  test('max_offer reports an infeasible target', async () => {
    const args = { ...example('max_offer'), targets: { minMonthlyCashFlow: 100000 } };
    const r = await call('max_offer', args);
    expect(r.text).toMatch(/^No feasible price/);
  });

  test('negative dollars read as -$', () => {
    expect(usd(-1590.354)).toBe('-$1,590.35');
    expect(ratio(null)).toBe('undefined');
    expect(pct(null)).toBe('undefined');
  });
});
