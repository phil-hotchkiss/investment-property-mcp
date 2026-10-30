import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { askedQuestion, type Transcript } from '../transcript.js';
import { type Harness, MAX_TOKENS, textOf, usageOf } from './common.js';

export const MAX_TURNS = 8;

/** The built MCP server, resolved from this file so it works from src (tests) and dist. */
export const serverBin = fileURLToPath(new URL('../../../mcp-server/dist/bin.js', import.meta.url));

/** Reference harness: a plain Anthropic tool-use loop over the MCP server's tools. */
export const direct: Harness = async ({ case: c, run, model, systemPrompt, client, transport }) => {
  const start = performance.now();
  const mcp = new Client({ name: 'rental-deal-math-evals', version: '0.0.0' });
  await mcp.connect(
    transport ?? new StdioClientTransport({ command: process.execPath, args: [serverBin] }),
  );
  try {
    const tools: Anthropic.Tool[] = (await mcp.listTools()).tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: c.prompt }];
    const log: Transcript['messages'] = [
      { role: 'system', text: systemPrompt },
      { role: 'user', text: c.prompt },
    ];
    const toolCalls: Transcript['toolCalls'] = [];
    const responses: Anthropic.Message[] = [];
    let finalText = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools,
        messages,
      });
      responses.push(response);
      finalText = textOf(response.content);
      if (finalText) log.push({ role: 'assistant', text: finalText });
      if (response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await callTool(mcp, block.name, block.input);
        toolCalls.push({ name: block.name, args: block.input, result });
        log.push({ role: 'tool', text: result.text });
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.text,
          is_error: result.isError,
        });
      }
      // All results for one assistant turn go back in a single user message.
      messages.push({ role: 'user', content: results });
    }

    return {
      caseId: c.id,
      harness: 'direct',
      model,
      run,
      messages: log,
      toolCalls,
      finalText,
      askedQuestion: askedQuestion(toolCalls.length, finalText),
      usage: usageOf(model, responses),
      durationMs: performance.now() - start,
    };
  } finally {
    await mcp.close();
  }
};

async function callTool(
  mcp: Client,
  name: string,
  args: unknown,
): Promise<Transcript['toolCalls'][number]['result']> {
  try {
    const r = (await mcp.callTool({
      name,
      arguments: args as Record<string, unknown>,
    })) as CallToolResult;
    const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    return {
      isError: r.isError === true,
      text,
      ...(r.structuredContent ? { structured: r.structuredContent } : {}),
    };
  } catch (e) {
    // Protocol-level failures (unknown tool, malformed request) go back to the model as errors too.
    return { isError: true, text: (e as Error).message };
  }
}
