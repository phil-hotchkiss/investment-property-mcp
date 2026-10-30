import { ValidationError } from '@rental-deal-math/core';

/**
 * Bad input becomes a tool result with isError, not a protocol error, so the model reads what was
 * wrong and retries. Each issue is a `field: message` line from core. Anything else rethrows.
 */
export function teachingError(e: unknown) {
  if (!(e instanceof ValidationError)) throw e;
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: `${e.message}\nFix the input and call the tool again.` },
    ],
  };
}
