import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type CalcResult,
  calcResultSchema,
  cashOnCash,
  cashOnCashInput,
  cashOnCashValues,
  dealAnalysis,
  dealAnalysisInput,
  dealAnalysisValues,
  dscr,
  dscrInput,
  dscrValues,
  loanPayment,
  loanPaymentInput,
  loanPaymentValues,
  maxOffer,
  maxOfferInput,
  maxOfferValues,
  portfolioRollup,
  portfolioRollupInput,
  portfolioRollupValues,
  stressTest,
  stressTestInput,
  stressTestValues,
} from '@rental-deal-math/core';
import { z } from 'zod';
import { descriptions, type ToolName } from './descriptions.js';
import * as summary from './summaries.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const annotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

function registerCalculatorTool<T>(
  server: McpServer,
  name: ToolName,
  input: z.ZodType,
  output: z.ZodType,
  compute: (raw: unknown) => CalcResult<T>,
  summarize: (r: CalcResult<T>) => string,
) {
  // The SDK validates arguments before the handler runs and words failures its own way. So the
  // SDK gets core's JSON Schema to advertise but accepts any object, and core's parse inside the
  // handler reports every validation failure.
  const json = z.toJSONSchema(input, { io: 'input', target: 'draft-7' });
  delete json.$schema;
  server.registerTool(
    name,
    {
      description: descriptions[name],
      inputSchema: z.looseObject({}).meta(json),
      outputSchema: calcResultSchema(output),
      annotations,
    },
    (args) => {
      const result = compute(args);
      return {
        structuredContent: result,
        content: [{ type: 'text', text: summarize(result) }],
      };
    },
  );
}

export function createServer(): McpServer {
  const s = new McpServer({ name: 'rental-deal-math', version });
  registerCalculatorTool(
    s,
    'loan_payment',
    loanPaymentInput,
    loanPaymentValues,
    loanPayment,
    summary.loanPaymentSummary,
  );
  registerCalculatorTool(s, 'dscr', dscrInput, dscrValues, dscr, summary.dscrSummary);
  registerCalculatorTool(
    s,
    'cash_on_cash',
    cashOnCashInput,
    cashOnCashValues,
    cashOnCash,
    summary.cashOnCashSummary,
  );
  registerCalculatorTool(
    s,
    'deal_analysis',
    dealAnalysisInput,
    dealAnalysisValues,
    dealAnalysis,
    summary.dealAnalysisSummary,
  );
  registerCalculatorTool(
    s,
    'max_offer',
    maxOfferInput,
    maxOfferValues,
    maxOffer,
    summary.maxOfferSummary,
  );
  registerCalculatorTool(
    s,
    'stress_test',
    stressTestInput,
    stressTestValues,
    stressTest,
    summary.stressTestSummary,
  );
  registerCalculatorTool(
    s,
    'portfolio_rollup',
    portfolioRollupInput,
    portfolioRollupValues,
    portfolioRollup,
    summary.portfolioRollupSummary,
  );
  return s;
}
