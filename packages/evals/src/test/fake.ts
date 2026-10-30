import type Anthropic from '@anthropic-ai/sdk';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '@rental-deal-math/mcp-server/server';
import { resolveCase } from '../cases.js';
import type { MessagesClient } from '../harness/common.js';

type Turn = {
  content: Anthropic.ContentBlock[];
  stop_reason: Anthropic.StopReason;
  usage?: [number, number];
};

export const text = (t: string) =>
  ({ type: 'text', text: t, citations: null }) as Anthropic.TextBlock;
export const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: 'tool_use', id, name, input }) as Anthropic.ToolUseBlock;

/** An Anthropic client stand-in that replays scripted turns and records every request. */
export function fakeClient(turns: Turn[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        requests.push(structuredClone(body));
        const t = turns.shift();
        if (!t) throw new Error('fake client ran out of scripted turns');
        const [input_tokens, output_tokens] = t.usage ?? [100, 20];
        return {
          id: `msg_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: t.content,
          stop_reason: t.stop_reason,
          stop_sequence: null,
          usage: { input_tokens, output_tokens },
        } as Anthropic.Message;
      },
    },
  };
  return { client, requests };
}

/** The real MCP server, in memory, as the direct harness's transport. */
export async function serverTransport() {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  return clientSide;
}

export const testCase = resolveCase({
  id: 'dscr-01',
  category: 'single-tool',
  prompt:
    'DSCR on a 400k place, 3200 rent, 4800 taxes, 1800 insurance, 25% down at 7.25% for 30 years, rent over PITIA.',
  expected: { tools: ['dscr'] },
});

export const dscrArgs = {
  price: 400000,
  monthlyRent: 3200,
  annualPropertyTax: 4800,
  annualInsurance: 1800,
  financing: { downPaymentPct: 25 },
  loan: { interestRatePct: 7.25, termYears: 30 },
  method: 'rentToPitia',
};
