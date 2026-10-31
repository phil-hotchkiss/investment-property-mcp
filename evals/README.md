# Evals

`packages/evals` runs eval cases against a model through one or more harnesses, writes one JSON transcript per run, grades each transcript, and writes a markdown report.

## Run

```sh
pnpm install && pnpm build          # the direct harness spawns packages/mcp-server/dist/bin.js
eval "$(pnpm -s evals:env)"         # loads ANTHROPIC_API_KEY, see docs/guides/secrets.md
pnpm evals --dry-run                # cases, harnesses, runs, estimated tokens and USD; no network
pnpm evals                          # none and direct, 3 runs each
```

## Flags

| Flag                   | Default                               | Meaning                                                                                                                            |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--harness <name>`     | `none` and `direct`                   | Repeatable, or comma-separated. One of `none`, `direct`, `agent-ts`, `agent-py`.                                                   |
| `--all`                | off                                   | Every harness. `agent-ts` and `agent-py` refuse to run until M4 and M5; dry run works.                                             |
| `--runs N`             | 3                                     | Runs per case per harness.                                                                                                         |
| `--cases <id or glob>` | all                                   | Matches case ids. `*` is the only wildcard, for example `--cases 'unit-traps-*'`.                                                  |
| `--dry-run`            | off                                   | Print the plan and estimate, exit 0. Needs no API key.                                                                             |
| `--out <dir>`          | `packages/evals/results/<timestamp>/` | The default resolves from the repo root wherever you run `pnpm`. A relative `--out` resolves from the directory you ran `pnpm` in. |
| `--publish <name>`     | off                                   | After the run, copy `report.md` and `summary.json` (not transcripts) to `packages/evals/reports/<name>/`.                          |
| `--no-judge`           | off                                   | Skip judge calls. `mentions` is `na` unless the case sets `must_not_mention`.                                                      |

## Environment

| Variable            | Default             | Meaning                                                                                              |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | none                | Required unless `--dry-run`. See `docs/guides/secrets.md`.                                           |
| `EVAL_MODEL`        | `claude-haiku-4-5`  | Model under test. Must be in `packages/evals/src/pricing.ts`.                                        |
| `EVAL_JUDGE_MODEL`  | `claude-sonnet-5-5` | Model for the LLM judge.                                                                             |
| `EVAL_MAX_USD`      | unset               | Refuse to start when the estimate (agent plus judge) exceeds it; stop between calls once spend does. |

The estimate assumes 4 characters per token, one call for `none`, and three calls for the tool harnesses, each resending the tool definitions plus 400 output tokens. Real tool loops can run up to 8 calls, so treat it as a planning number. The judge estimate is one call per transcript whose case has `must_mention`, `rubric`, `expect_question`, `accept_question`, or empty `expected.tools`, sending the judge prompt, rubric, case prompt, and a 400-token answer, with 400 output tokens.

## Harnesses

- `none`: one Messages API call with the system prompt in `prompts/agent-system.md` and the case prompt. No tools.
- `direct`: starts the MCP server as a child process over stdio, lists its tools, and runs a plain Anthropic tool-use loop for at most 8 model calls. Tool errors go back to the model as `tool_result` blocks with `is_error: true`.
- `agent-ts`, `agent-py`: the LangChain agents in one-shot JSON mode, from M4 and M5.

## Output

`<out>/<caseId>.<harness>.<run>.json` per transcript, plus `summary.json` and `report.md`. Transcripts stay in `packages/evals/results/`, which is gitignored, so they survive for regrading but are not committed. To keep a run's results in the repo, pass `--publish <name>`: it copies `report.md` and `summary.json` only to `packages/evals/reports/<name>/`, for example `pnpm evals --publish 2026-11-01-haiku`. `summary.json` has agent and judge totals (`usage`, `judge`), both estimates, `pricingDate`, `passed`, `stopped` (null, or why the run ended early), and `graded`, one entry per transcript with its grade. A run that stops early still grades and reports everything it finished.

Every harness emits the same transcript, validated by `transcriptSchema` in `src/transcript.ts`. Agents in other languages validate against `packages/evals/transcript.schema.json`, which a test keeps in sync with the zod schema (`pnpm --filter @rental-deal-math/evals schema` regenerates it after a build).

```jsonc
{
  "caseId": "dscr-both-methods-01",
  "harness": "direct", // none | direct | agent-ts | agent-py
  "model": "claude-haiku-4-5",
  "run": 1,
  "messages": [{ "role": "user", "text": "..." }], // system | user | assistant | tool
  "toolCalls": [
    {
      "name": "dscr",
      "args": { "price": 400000 },
      "result": { "isError": false, "text": "...", "structured": {} },
    },
  ],
  "finalText": "...",
  "askedQuestion": false,
  "usage": { "inputTokens": 0, "outputTokens": 0, "costUsd": 0 },
  "durationMs": 0,
}
```

`askedQuestion` is a heuristic: true when there were no tool calls and the final text ends with a question mark or contains a request for information such as "could you" or "which method". It stays in the transcript for backward compatibility. The grader decides whether the model asked from the judge's `responseType` when the judge ran, and from `askedQuestion` only when it did not (`--no-judge`, or a skipped judge call). See Judge below.

## Grading

`src/grade.ts` grades one transcript against its case with no network. Each dimension is `pass`, `fail`, or `na`. `na` means the dimension does not apply and does not count against the run. A run passes overall when no dimension failed.

| Dimension       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolSelection` | A list in `expected.tools` is a set: the tools called must equal it, and an extra tool fails. A name listed once may be called any number of times; a name listed n > 1 times must be called exactly n times (`[dscr, dscr]` means two dscr calls). `{ sequence }` also checks the order of first calls and does not count repeats. An empty list passes only when no tool was called.                                                                                          |
| `args`          | Per tool, passes when any one call to it matches every expected `tool.field` for that tool, so a corrected retry after a tool error counts; with several calls the details record which one matched (`args: dscr matched call 2 of 2`). When none matches, the details describe the first call. Dotted paths reach nested fields (`dscr.loan.interestRatePct`). Numbers within `tolerance` or `tolerance_pct` (default 0); anything else exact. `na` when no args are expected. |
| `answer`        | Each key in `expected.answer` passes when any number in `finalText` is within tolerance. Asking a question when the case does not set `expect_question` fails here as "asked instead of answering". `na` when there is nothing to check.                                                                                                                                                                                                                                        |
| `question`      | Only when `expect_question` is true: passes when the model asked (judge `responseType` `asked_for_info`, or `askedQuestion` without the judge) and no tool was called.                                                                                                                                                                                                                                                                                                          |
| `mentions`      | Fails when `finalText` contains a `must_not_mention` string (case-insensitive), or when the judge fails. `na` with neither.                                                                                                                                                                                                                                                                                                                                                     |

A case with `accept_question: true` also passes when the model asked (as above, no tool calls): `question` is pass, every other dimension is `na`, no judge call is made, and the per-case table counts the run as `asked n`. When the model answers instead, the case grades as if the flag were absent.

The `none` harness cannot call tools, so its `toolSelection` and `args` are always `na`. The report says so in its header.

### Number extraction

The answer check reads every number in the final text. It strips `$` and thousands commas, ignores a `%` suffix, and reads a `k` or `K` suffix as thousands. So `$392,859`, `393k` (392859 at 1%), `7.25%`, and `1.23` all parse. A Unicode minus (U+2212), en dash, or em dash reads as a hyphen, and a minus counts only at the start of a word, so `30-year` is 30. Accounting parentheses, `(1,234)` or `($473)`, read as negative. For a negative expected value, the unsigned figure also matches when one of "negative", "loss", "lose", "short" (so "shortfall"), or "deficit" appears within 40 characters of it, so "you would lose $473 a month" matches -473. It does not read "million" or spelled-out numbers. Matching any number in the text is lenient on purpose: the grader checks that the right figure appears, and the judge checks the phrasing.

### Judge

`src/judge.ts` makes one Messages API call per transcript when the case has `must_mention` or `rubric`, on `EVAL_JUDGE_MODEL`. The prompt is the case's `rubric`, or else: "The answer must mention each of: <must_mention>. Mentioning means the concept is present in substance, not necessarily the exact words." Besides the case prompt and the final text, the judge gets the tool calls the agent actually made, one line each: name, args JSON, `ok` or `error`, and the first 400 characters of the result text. The judge prompt says to grade rubric items about tool usage from that list. For the `none` harness the list says the agent had no tools. Structured outputs constrain the reply to `{ pass, missing, reason }`; a reply that still does not parse grades as a fail with reason "judge returned non-JSON". The same call also returns `responseType`: `answered`, `asked_for_info`, or `declined`. The judge runs for a case with `must_mention` or `rubric`, and also for a case with `expect_question`, `accept_question`, or an empty `expected.tools`, where the rubric is replaced by "No rubric for this case" and only `responseType` is used; such a verdict does not grade `mentions`. `asked_for_info` satisfies `expect_question` and `accept_question`. `declined` is not asking, so an out-of-scope case (no tools, no answer expected) passes, while a case that expected a question fails `question`. `answered` on a case that expected a question fails as before. Each grade records the source in its details, for example `response: declined (judge)` or `response: asked_for_info (heuristic)`, on cases that classify and on any run that asked. Judge usage and cost are recorded separately in `summary.json` under `judge`. `--no-judge` skips every judge call.

## Report

`report.md` in the results dir has:

1. A header: date, agent and judge models, harnesses, runs per case, total cost and tokens (agent plus judge), pricing date, and why the run stopped early if it did.
2. Pass rate by category: one row per category plus `all`, one column per harness, each cell `n/N (pct%)`.
3. Per case: id, category, `evidence`, then per harness `passes/runs` with the failing dimensions.
4. Failures: for each failed run, the case, harness, run number, grader details, and the first 300 characters of the final text. Use this to add entries to `evals/observed-failures.md`.

A results dir covers one agent model. To compare models, run each into its own dir and merge:

```sh
pnpm -s evals report --merge results/haiku results/sonnet > report.md
```

Merge concatenates the graded runs from each `summary.json` and prints one report with a column per harness and model.

## CI

`.github/workflows/evals.yml` runs only by manual dispatch: Actions, Evals, Run workflow. Inputs are `harnesses` (default `none,direct`), `model` (default `claude-haiku-4-5`), `runs` (default 3), and `cases` (default `*`). It needs the `ANTHROPIC_API_KEY` repository secret. The cap comes from the `EVAL_MAX_USD` repository variable, 5 when unset. It writes to the default results dir, and `packages/evals/results/`, transcripts and report included, uploads as the `eval-results` artifact even when the run stops early.

## Cost control

The `EVAL_MAX_USD` cap and the estimate are guards on this process, computed from a local price table. They do not see other runs, retries inside the SDK, or price changes. The only hard limit on spend is the monthly spend limit set on the API key's workspace in the Anthropic Console, so set one there before running evals.
