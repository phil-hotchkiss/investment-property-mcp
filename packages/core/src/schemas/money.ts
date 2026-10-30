import { z } from 'zod';

// zod v4 numbers already reject NaN and Infinity, so these are finite.
/** US dollars, zero or more. */
export const money = z.number().nonnegative();

/** US dollars, strictly positive (a purchase price). */
export const price = z.number().positive();
