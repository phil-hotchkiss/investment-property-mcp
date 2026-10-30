# Evals

`packages/evals` runs eval cases against a model through one or more harnesses and writes one JSON transcript per run. Grading and the markdown report come in later PRs.

## Run

```sh
pnpm install && pnpm build          # the direct harness spawns packages/mcp-server/dist/bin.js
eval "$(pnpm -s evals:env)"         # loads ANTHROPIC_API_KEY, see docs/secrets.md
pnpm evals --dry-run                # cases, harnesses, runs, estimated tokens and USD; no network
pnpm evals                          # none and direct, 3 runs each
```

## Flags

| Flag                  | Default                                  | Meaning                                                                                   |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `--harness <name>`    | `none` and `direct`                      | Repeatable. One of `none`, `direct`, `agent-ts`, `agent-py`.                              |
| `--all`               | off                                      | Every harness. `agent-ts` and `agent-py` refuse to run until M4 and M5; dry run works.    |
| `--runs N`            | 3                                        | Runs per case per harness.                                                                |
| `--cases <id or glob>` | all                                     | Matches case ids. `*` is the only wildcard, for example `--cases 'unit-traps-*'`.         |
| `--dry-run`           | off                                      | Print the plan and estimate, exit 0. Needs no API key.                                    |
| `--out <dir>`         | `packages/evals/results/<timestamp>/`    | Relative paths resolve from the directory you ran `pnpm` in.                              |

## Environment

| Variable            | Default             | Meaning                                                                                           |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | none                | Required unless `--dry-run`. See `docs/secrets.md`.                                               |
| `EVAL_MODEL`        | `claude-haiku-4-5`  | Model under test. Must be in `packages/evals/src/pricing.ts`.                                     |
| `EVAL_JUDGE_MODEL`  | `claude-sonnet-5-5` | Model for the LLM judge. Validated now, used once the grader lands.                               |
| `EVAL_MAX_USD`      | unset               | Refuse to start when the estimate exceeds it; stop between transcripts once actual spend does.   |

The estimate assumes 4 characters per token, one call for `none`, and three calls for the tool harnesses, each resending the tool definitions plus 400 output tokens. Real tool loops can run up to 8 calls, so treat it as a planning number.

## Harnesses

- `none`: one Messages API call with the system prompt in `docs/agent/system-prompt.md` and the case prompt. No tools.
- `direct`: starts the MCP server as a child process over stdio, lists its tools, and runs a plain Anthropic tool-use loop for at most 8 model calls. Tool errors go back to the model as `tool_result` blocks with `is_error: true`.
- `agent-ts`, `agent-py`: the LangChain agents in one-shot JSON mode, from M4 and M5.

## Output

`<out>/<caseId>.<harness>.<run>.json` per transcript, plus `summary.json` with totals, the estimate, and `stopped` (null, or why the run ended early). A run that stops early still writes everything it finished.

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

`askedQuestion` is a heuristic: true when there were no tool calls and the final text ends with a question mark or contains a request for information such as "could you" or "which method". The grader's judge can overrule it.

## Cost control

The `EVAL_MAX_USD` cap and the estimate are guards on this process, computed from a local price table. They do not see other runs, retries inside the SDK, or price changes. The only hard limit on spend is the monthly spend limit set on the API key's workspace in the Anthropic Console, so set one there before running evals.
