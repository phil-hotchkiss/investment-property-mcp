import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export function createServer(): McpServer {
  return new McpServer({ name: 'rental-deal-math', version });
}
