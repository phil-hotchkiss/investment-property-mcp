import { describe, expect, test } from 'vitest';
import { dscrArgs, fakeClient, serverTransport, testCase, text, toolUse } from '../test/fake.js';
import { transcriptSchema } from '../transcript.js';
import { direct, MAX_TURNS } from './direct.js';
import { none } from './none.js';

const base = { case: testCase, run: 2, model: 'claude-haiku-4-5', systemPrompt: 'SYSTEM' };

describe('none', () => {
  test('one call, no tools, records usage and the question heuristic', async () => {
    const { client, requests } = fakeClient([
      {
        content: [text('Which DSCR method do you want?')],
        stop_reason: 'end_turn',
        usage: [1000, 200],
      },
    ]);
    const t = transcriptSchema.parse(await none({ ...base, client }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: 'claude-haiku-4-5', system: 'SYSTEM' });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]?.messages).toEqual([{ role: 'user', content: testCase.prompt }]);
    expect(t).toMatchObject({
      caseId: 'dscr-01',
      harness: 'none',
      run: 2,
      toolCalls: [],
      finalText: 'Which DSCR method do you want?',
      askedQuestion: true,
      usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.002 },
    });
  });
});

describe('direct', () => {
  test('runs the tool loop against the real server, round-tripping is_error', async () => {
    const { client, requests } = fakeClient([
      {
        content: [text('Let me compute.'), toolUse('t1', 'dscr', { ...dscrArgs, rent: 1 })],
        stop_reason: 'tool_use',
        usage: [500, 50],
      },
      {
        content: [toolUse('t2', 'dscr', dscrArgs), toolUse('t3', 'nope', {})],
        stop_reason: 'tool_use',
        usage: [700, 60],
      },
      {
        content: [text('DSCR is 1.23 on rent over PITIA.')],
        stop_reason: 'end_turn',
        usage: [900, 70],
      },
    ]);
    const t = transcriptSchema.parse(
      await direct({ ...base, client, transport: await serverTransport() }),
    );

    // Tools came from the server, converted to Anthropic definitions.
    const tools = requests[0]?.tools as { name: string; input_schema: { type: string } }[];
    expect(tools.map((x) => x.name).sort()).toEqual([
      'cash_on_cash',
      'deal_analysis',
      'dscr',
      'loan_payment',
      'max_offer',
      'portfolio_rollup',
      'stress_test',
    ]);
    expect(tools[0]?.input_schema.type).toBe('object');

    expect(t.toolCalls.map((c) => [c.name, c.result.isError])).toEqual([
      ['dscr', true],
      ['dscr', false],
      ['nope', true],
    ]);
    expect(t.toolCalls[0]?.result.text).toMatch(/rent/);
    expect(t.toolCalls[1]?.result.text).toMatch(/1\.23/);
    expect(t.toolCalls[1]?.result.structured).toMatchObject({ values: { method: 'rentToPitia' } });
    expect(t.toolCalls[1]?.args).toEqual(dscrArgs);

    // The error result went back to the model as a tool_result with is_error.
    const second = requests[1]?.messages.at(-1);
    expect(second).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }],
    });
    // Parallel calls come back in one user message.
    const third = requests[2]?.messages.at(-1);
    expect(third?.content).toMatchObject([
      { tool_use_id: 't2', is_error: false },
      { tool_use_id: 't3', is_error: true },
    ]);

    expect(requests).toHaveLength(3);
    expect(t.finalText).toBe('DSCR is 1.23 on rent over PITIA.');
    expect(t.askedQuestion).toBe(false);
    expect(t.usage).toMatchObject({ inputTokens: 2100, outputTokens: 180 });
    expect(t.usage.costUsd).toBeCloseTo((2100 * 1 + 180 * 5) / 1e6, 12);
    expect(t.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
      'tool',
      'assistant',
    ]);
  });

  test(`stops after ${MAX_TURNS} model calls`, async () => {
    const turns = Array.from({ length: MAX_TURNS + 2 }, (_, i) => ({
      content: [toolUse(`t${i}`, 'dscr', dscrArgs)],
      stop_reason: 'tool_use' as const,
    }));
    const { client, requests } = fakeClient(turns);
    const t = await direct({ ...base, client, transport: await serverTransport() });
    expect(requests).toHaveLength(MAX_TURNS);
    expect(t.toolCalls).toHaveLength(MAX_TURNS);
    expect(t.finalText).toBe('');
  });
});

test('direct spawns the built server over stdio by default', async () => {
  const { client, requests } = fakeClient([{ content: [text('Hi.')], stop_reason: 'end_turn' }]);
  const t = await direct({ ...base, client });
  expect(requests[0]?.tools).toHaveLength(7);
  expect(t.toolCalls).toEqual([]);
});
