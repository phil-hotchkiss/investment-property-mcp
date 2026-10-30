/**
 * USD per million tokens, Anthropic first-party API rates. Taken 2026-10-30 from the claude-api
 * skill's model table (cached 2026-09-25). Used only for estimates and the summary, never billing.
 */
export const pricing: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

/** When the table above was last checked. Printed in the report header. */
export const PRICING_DATE = '2026-10-30';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const DEFAULT_JUDGE_MODEL = 'claude-sonnet-5-5';

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = pricing[model];
  if (!p)
    throw new Error(`No price for model ${model}. Known: ${Object.keys(pricing).join(', ')}.`);
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}
