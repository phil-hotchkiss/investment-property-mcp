import { z } from 'zod';
import type { Case } from './cases.js';
import type { JudgeVerdict } from './grade.js';
import { MAX_TOKENS, type MessagesClient, textOf, usageOf } from './harness/common.js';
import type { Transcript } from './transcript.js';

export type JudgeResult = JudgeVerdict & { usage: Transcript['usage'] };

const verdictSchema = z.strictObject({
  pass: z.boolean(),
  missing: z.array(z.string()),
  reason: z.string(),
});

const verdictJsonSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['pass', 'missing', 'reason'],
  additionalProperties: false,
};

/** True when the case needs the LLM judge: it lists must_mention or carries a rubric. */
export const needsJudge = (c: Case) => c.expected.must_mention.length > 0 || !!c.expected.rubric;

export const rubricFor = (c: Case) =>
  c.expected.rubric ??
  `The answer must mention each of: ${c.expected.must_mention.join('; ')}. Mentioning means the concept is present in substance, not necessarily the exact words.`;

export const JUDGE_SYSTEM =
  'You grade one answer from a real estate deal-math assistant against a rubric. Judge only what the rubric asks. Do not grade arithmetic unless the rubric asks for it. Reply with JSON: pass is true only if every rubric item is met; missing lists the rubric items not met; reason is one sentence.';

/**
 * One Messages API call. Structured outputs (output_config.format) constrain the reply to the
 * verdict schema; forced tool_choice is rejected by current models, so it is not used. A reply
 * that still fails to parse grades as a fail rather than throwing.
 */
export async function judge(input: {
  case: Case;
  transcript: Transcript;
  model: string;
  client: MessagesClient;
}): Promise<JudgeResult> {
  const { case: c, transcript: t, model, client } = input;
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: JUDGE_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: verdictJsonSchema } },
    messages: [
      {
        role: 'user',
        content: `<rubric>\n${rubricFor(c)}\n</rubric>\n<question>\n${c.prompt}\n</question>\n<answer>\n${t.finalText}\n</answer>`,
      },
    ],
  });
  const usage = usageOf(model, [response]);
  try {
    return { ...verdictSchema.parse(JSON.parse(textOf(response.content))), usage };
  } catch {
    return { pass: false, missing: [], reason: 'judge returned non-JSON', usage };
  }
}
