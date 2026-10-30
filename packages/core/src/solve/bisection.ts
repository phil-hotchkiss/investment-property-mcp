export type BisectResult = {
  x: number;
  hitUpperBound: boolean;
  hitLowerBound: boolean;
  iterations: number;
};

/**
 * Largest x in [lo, hi] where `f(x)` is true, to within `toleranceAbs`. Assumes `f` is monotone:
 * true from lo up to some point, false after. If `f(lo)` is false, returns lo with
 * `hitLowerBound` (no x satisfies f). If `f(hi)` is true, returns hi with `hitUpperBound`.
 */
export function bisect(
  f: (x: number) => boolean,
  lo: number,
  hi: number,
  opts: { toleranceAbs: number; maxIterations?: number },
): BisectResult {
  if (!f(lo)) return { x: lo, hitUpperBound: false, hitLowerBound: true, iterations: 0 };
  if (f(hi)) return { x: hi, hitUpperBound: true, hitLowerBound: false, iterations: 0 };
  const max = opts.maxIterations ?? 200;
  let iterations = 0;
  while (hi - lo > opts.toleranceAbs && iterations < max) {
    const mid = (lo + hi) / 2;
    if (f(mid)) lo = mid;
    else hi = mid;
    iterations++;
  }
  return { x: lo, hitUpperBound: false, hitLowerBound: false, iterations };
}
