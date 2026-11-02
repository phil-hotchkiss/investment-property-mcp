# Eval cases

One YAML file per case, validated by `caseSchema` in `../src/cases.ts`. See `docs/prd.md` (Evals) for the format.

## Naming

`<category>-<slug>-NN.yaml`, and the `id` inside matches the file name without `.yaml`. Categories are the eight in `categories` in `../src/cases.ts`.

## How answers are filled

Numeric answers are never typed by hand. Each `expected.answer` entry leaves out `value`; the loader runs the case's `compute` block (a core calculator with explicit inputs) and fills `value` from the dotted path into the result's `values`.

A case that needs numbers from more than one call uses a list of keyed blocks, and each answer key starts with its block's key:

```yaml
compute:
  - { key: rentToPitia, tool: dscr, input: { ..., method: rentToPitia } }
  - { key: noi, tool: dscr, input: { ..., method: noi } }
expected:
  answer:
    rentToPitia.dscr: { tolerance: 0.01 }
    noi.dscr: { tolerance: 0.01 }
```

Every block's input is explicit, so a number that depends on another call's output (for example a stress test at the max offer price) cannot be computed and stays with the rubric.

## Tools and questions

`expected.tools` as a list is a set, except that a name listed more than once must be called exactly that many times: `[dscr, dscr]` means two dscr calls. `{ sequence: [...] }` checks the order of first calls.

`accept_question: true` lets a case pass when the model asks instead of answering, for prompts where stating an assumption or asking are both fine. An answer is still graded in full.

`expected.args` values are what the prompt states, because they are what the agent must extract (for example `4600` for "1,150 a door" on a fourplex).

## Adding a case

1. Write the file with a one-line comment at the top saying what it tests.
2. Put the inputs the user stated, normalized to the tool's units, in `compute.input`.
3. Leave `value` out of every `answer` entry and set a tolerance.
4. If it came from something a model actually did, add `evidence: evals/observed-failures.md#<heading-anchor>`.
5. Bump the count in `cases.test.ts`, then run `pnpm build && pnpm evals --dry-run` and `pnpm test`.

Observed behavior that motivated several cases is in [evals/observed-failures.md](../../../evals/observed-failures.md).
