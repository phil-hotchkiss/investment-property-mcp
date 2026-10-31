import { z } from 'zod';
import type { Case } from './cases.js';
import type { JudgeVerdict } from './grade.js';
import { MAX_TOKENS, type MessagesClient, textOf, usageOf } from './harness/common.js';
import type { Transcript } from './transcript.js';

export const responseTypes = ['answered', 'asked_for_info', 'declined'] as const;
export type ResponseType = (typeof responseTypes)[number];

export type JudgeResult = JudgeVerdict & { usage: Transcript['usage'] };

const verdictSchema = z.strictObject({
  pass: z.boolean(),
  missing: z.array(z.string()),
  reason: z.string(),
  // Optional so a reply without it keeps its rubric verdict; the grader then uses the heuristic.
  responseType: z.enum(responseTypes).optional(),
});

const verdictJsonSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    responseType: { type: 'string', enum: [...responseTypes] },
  },
  required: ['pass', 'missing', 'reason', 'responseType'],
  additionalProperties: false,
};

/** True when the case needs the LLM judge: it lists must_mention or carries a rubric. */
export const needsJudge = (c: Case) => c.expected.must_mention.length > 0 || !!c.expected.rubric;

/**
 * True when the grade depends on whether the model answered, asked, or declined: the case expects
 * or accepts a question, or expects no tool calls (out of scope or missing info).
 */
export const needsClassify = (c: Case) =>
  !!c.expected.expect_question ||
  !!c.expected.accept_question ||
  (Array.isArray(c.expected.tools) && c.expected.tools.length === 0);

/** One judge call covers both the rubric and the response type. */
export const callsJudge = (c: Case) => needsJudge(c) || needsClassify(c);

export const rubricFor = (c: Case) =>
  c.expected.rubric ??
  (!needsJudge(c)
    ? 'No rubric for this case. Set pass to true and missing to []; only responseType matters.'
    : undefined) ??
  `The answer must mention each of: ${c.expected.must_mention.join('; ')}. Mentioning means the concept is present in substance, not necessarily the exact words.`;

export const JUDGE_SYSTEM =
  'You grade one answer from a real estate deal-math assistant against a rubric. Judge only what the rubric asks. Do not grade arithmetic unless the rubric asks for it. The <tool_calls> block lists the tool calls the agent actually made, in order, with each result truncated; judge any rubric item about tool usage from that list, not from what the answer claims. Reply with JSON: pass is true only if every rubric item is met; missing lists the rubric items not met; reason is one sentence. responseType classifies the final answer: answered if it gives the user an answer (stating assumptions is still answering), asked_for_info if it asks the user for missing information or a choice instead of answering, declined if it says the request is outside what it can do.';

/** Characters of each tool result shown to the judge. */
const RESULT_CHARS = 400;

/** The tool calls as the judge sees them: one line each, name, args JSON, error flag, result head. */
export function toolCallsFor(t: Transcript): string {
  if (t.harness === 'none') return 'The agent had no tools.';
  if (!t.toolCalls.length) return 'The agent made no tool calls.';
  return t.toolCalls
    .map(
      (tc, i) =>
        `${i + 1}. ${tc.name} ${JSON.stringify(tc.args)} ${tc.result.isError ? 'error' : 'ok'}: ${tc.result.text.slice(0, RESULT_CHARS)}`,
    )
    .join('\n');
}

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
        content: `<rubric>\n${rubricFor(c)}\n</rubric>\n<question>\n${c.prompt}\n</question>\n<tool_calls>\n${toolCallsFor(t)}\n</tool_calls>\n<answer>\n${t.finalText}\n</answer>`,
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
