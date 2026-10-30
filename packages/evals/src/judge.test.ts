import { describe, expect, test } from 'vitest';
import { resolveCase } from './cases.js';
import { judge, needsJudge, rubricFor } from './judge.js';
import { fakeClient, text } from './test/fake.js';
import type { Transcript } from './transcript.js';

const c = resolveCase({
  id: 'c',
  category: 'method-ambiguity',
  prompt: 'What is the DSCR?',
  expected: { must_mention: ['DSCR method', 'assumed vacancy'] },
});

const transcript = {
  caseId: 'c',
  harness: 'direct',
  model: 'claude-haiku-4-5',
  run: 1,
  messages: [],
  toolCalls: [],
  finalText: 'DSCR is 1.23 using rent over PITIA.',
  askedQuestion: false,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  durationMs: 0,
} satisfies Transcript;

const run = async (reply: string) => {
  const { client, requests } = fakeClient([
    { content: [text(reply)], stop_reason: 'end_turn', usage: [1000, 100] },
  ]);
  const r = await judge({ case: c, transcript, model: 'claude-sonnet-5-5', client });
  return { r, request: requests[0]! };
};

describe('judge', () => {
  test('pass JSON, with usage costed at the judge model', async () => {
    const { r, request } = await run('{"pass":true,"missing":[],"reason":"both present"}');
    expect(r).toEqual({
      pass: true,
      missing: [],
      reason: 'both present',
      usage: { inputTokens: 1000, outputTokens: 100, costUsd: (1000 * 2 + 100 * 10) / 1e6 },
    });
    expect(request.model).toBe('claude-sonnet-5-5');
    expect(request.output_config?.format?.type).toBe('json_schema');
    expect(request.messages[0]!.content).toContain('The answer must mention each of: DSCR method');
    expect(request.messages[0]!.content).toContain(transcript.finalText);
  });

  test('fail JSON', async () => {
    const { r } = await run('{"pass":false,"missing":["assumed vacancy"],"reason":"no vacancy"}');
    expect(r).toMatchObject({ pass: false, missing: ['assumed vacancy'] });
  });

  test.each(['not json at all', '{"pass":"yes"}'])('garbage %j fails', async (reply) => {
    const { r } = await run(reply);
    expect(r).toMatchObject({ pass: false, reason: 'judge returned non-JSON' });
    expect(r.usage.inputTokens).toBe(1000);
  });

  test('needsJudge and rubric choice', () => {
    expect(needsJudge(c)).toBe(true);
    const plain = resolveCase({ id: 'p', category: 'single-tool', prompt: 'p', expected: {} });
    expect(needsJudge(plain)).toBe(false);
    const withRubric = resolveCase({ ...plain, expected: { rubric: 'Must refuse politely.' } });
    expect(needsJudge(withRubric)).toBe(true);
    expect(rubricFor(withRubric)).toBe('Must refuse politely.');
  });
});
