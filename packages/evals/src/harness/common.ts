import type Anthropic from '@anthropic-ai/sdk';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Case } from '../cases.js';
import { costUsd } from '../pricing.js';
import type { Transcript } from '../transcript.js';

/** The slice of the Anthropic client the harnesses use, so tests can inject a scripted fake. */
export type MessagesClient = {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
};

export type HarnessInput = {
  case: Case;
  run: number;
  model: string;
  systemPrompt: string;
  client: MessagesClient;
  /** direct only: talk to this MCP transport instead of spawning the server over stdio. */
  transport?: Transport;
};

export type Harness = (input: HarnessInput) => Promise<Transcript>;

export const MAX_TOKENS = 16000;

export const textOf = (content: Anthropic.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

export function usageOf(model: string, responses: Anthropic.Message[]): Transcript['usage'] {
  const inputTokens = responses.reduce((n, r) => n + r.usage.input_tokens, 0);
  const outputTokens = responses.reduce((n, r) => n + r.usage.output_tokens, 0);
  return { inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) };
}
