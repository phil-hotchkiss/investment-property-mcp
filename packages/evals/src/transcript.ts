import { z } from 'zod';

export const harnessNames = ['none', 'direct', 'agent-ts', 'agent-py'] as const;

export const transcriptSchema = z.strictObject({
  caseId: z.string(),
  harness: z.enum(harnessNames),
  model: z.string(),
  run: z.number().int().positive(),
  messages: z.array(
    z.strictObject({ role: z.enum(['system', 'user', 'assistant', 'tool']), text: z.string() }),
  ),
  toolCalls: z.array(
    z.strictObject({
      name: z.string(),
      args: z.unknown(),
      result: z.strictObject({
        isError: z.boolean(),
        text: z.string(),
        structured: z.unknown().optional(),
      }),
    }),
  ),
  finalText: z.string(),
  askedQuestion: z.boolean(),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  durationMs: z.number().nonnegative(),
});

export type Transcript = z.infer<typeof transcriptSchema>;
export type HarnessName = Transcript['harness'];

/** The JSON Schema checked in at packages/evals/transcript.schema.json, for agents in other languages. */
export const transcriptJsonSchema = () => z.toJSONSchema(transcriptSchema);

const asksForInfo =
  /\b(could you|can you|please (provide|share|confirm|tell|let me know)|do you (want|mean|know)|which (dscr )?method|what is the|what's the)\b/i;

/**
 * True when the model asked instead of answering: no tool calls, and the final text ends with a
 * question mark or contains a request for information.
 * ponytail: phrase heuristic, so a question buried in a computed answer is missed; the grader's
 * LLM judge can override it for expect_question cases.
 */
export function askedQuestion(toolCallCount: number, finalText: string): boolean {
  if (toolCallCount > 0) return false;
  return finalText.trim().endsWith('?') || asksForInfo.test(finalText);
}
