import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  askedQuestion,
  transcriptJsonSchema,
  transcriptSchema,
  type Transcript,
} from './transcript.js';

const sample: Transcript = {
  caseId: 'dscr-01',
  harness: 'direct',
  model: 'claude-haiku-4-5',
  run: 1,
  messages: [
    { role: 'user', text: 'DSCR?' },
    { role: 'tool', text: 'DSCR 1.23' },
    { role: 'assistant', text: 'It is 1.23.' },
  ],
  toolCalls: [
    {
      name: 'dscr',
      args: { price: 1 },
      result: { isError: false, text: 'DSCR 1.23', structured: { values: {} } },
    },
    { name: 'dscr', args: {}, result: { isError: true, text: 'price is required' } },
  ],
  finalText: 'It is 1.23.',
  askedQuestion: false,
  usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.000035 },
  durationMs: 12.5,
};

describe('transcript', () => {
  test('round-trips through JSON', () => {
    expect(transcriptSchema.parse(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
  });

  test('rejects unknown fields and harnesses', () => {
    expect(() => transcriptSchema.parse({ ...sample, extra: 1 })).toThrow();
    expect(() => transcriptSchema.parse({ ...sample, harness: 'langchain' })).toThrow();
  });

  test('checked-in JSON Schema matches the zod schema (regenerate: pnpm --filter @rental-deal-math/evals schema)', () => {
    const checkedIn = JSON.parse(
      readFileSync(new URL('../transcript.schema.json', import.meta.url), 'utf8'),
    );
    expect(checkedIn).toEqual(transcriptJsonSchema());
  });
});

describe('askedQuestion', () => {
  test.each([
    [0, 'Which DSCR method should I use?', true],
    [0, 'Could you share the monthly rent. Then I can run it.', true],
    [0, 'Please provide the interest rate.', true],
    [0, 'The DSCR is 1.23 on rent over PITIA.', false],
    [1, 'Want the NOI method too?', false],
  ])('%i tool calls, %j -> %s', (calls, text, expected) => {
    expect(askedQuestion(calls, text)).toBe(expected);
  });
});
