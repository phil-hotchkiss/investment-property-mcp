# Eval cases

One YAML file per case, validated by `caseSchema` in `../src/cases.ts`. See `docs/PRD.md` (Evals) for the format.

## Naming

`<category>-<slug>-NN.yaml`, and the `id` inside matches the file name without `.yaml`. Categories are the eight in `categories` in `../src/cases.ts`.

## How answers are filled

Numeric answers are never typed by hand. Each `expected.answer` entry leaves out `value`; the loader runs the case's `compute` block (a core calculator with explicit inputs) and fills `value` from the dotted path into the result's `values`. Only one `compute` block is allowed per case, so a chaining case grades the answer of one call and leaves the rest to the rubric.

`expected.args` values are what the prompt states, because they are what the agent must extract (for example `4600` for "1,150 a door" on a fourplex).

## Adding a case

1. Write the file with a one-line comment at the top saying what it tests.
2. Put the inputs the user stated, normalized to the tool's units, in `compute.input`.
3. Leave `value` out of every `answer` entry and set a tolerance.
4. If it came from something a model actually did, add `evidence: docs/observed-failures.md#<heading-anchor>`.
5. Bump the count in `cases.test.ts`, then run `pnpm build && pnpm evals --dry-run` and `pnpm test`.

Observed behavior that motivated several cases is in [docs/observed-failures.md](../../../docs/observed-failures.md).
