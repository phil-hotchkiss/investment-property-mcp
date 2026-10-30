import type { z } from 'zod';

/**
 * Every calculator has the shape `fn(raw: unknown): CalcResult<T>`. It parses `raw` with its zod
 * schema via `parseInput`, which throws `ValidationError` on bad input. The MCP server turns that
 * into a tool error the agent can learn from.
 */
export type CalcResult<T> = { values: T; assumptions: string[]; warnings: string[] };

export type Issue = { path: string; message: string };

export class ValidationError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n'));
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
