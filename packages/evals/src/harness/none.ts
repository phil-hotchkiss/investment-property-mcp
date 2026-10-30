import { askedQuestion } from '../transcript.js';
import { type Harness, MAX_TOKENS, textOf, usageOf } from './common.js';

/** Baseline: one Messages API call, same system prompt, no tools. */
export const none: Harness = async ({ case: c, run, model, systemPrompt, client }) => {
  const start = performance.now();
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: c.prompt }],
  });
  const finalText = textOf(response.content);
  return {
    caseId: c.id,
    harness: 'none',
    model,
    run,
    messages: [
      { role: 'system', text: systemPrompt },
      { role: 'user', text: c.prompt },
      { role: 'assistant', text: finalText },
    ],
    toolCalls: [],
    finalText,
    askedQuestion: askedQuestion(0, finalText),
    usage: usageOf(model, [response]),
    durationMs: performance.now() - start,
  };
};
