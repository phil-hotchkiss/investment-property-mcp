# PRD: Rental Deal Math Toolkit

Oct 30, 2026 · @Phil

## Instructions for Claude Code

Build this in milestone order and stop for review at the end of each milestone. Phil is the engineer of record; you are pairing with him, not replacing him.

- Start with Milestone 0: inventory the existing calculator folder and report back before writing new code.
- Ask before deleting, renaming, or restructuring anything in the source folder. Work in a new repo; treat the old folder as read-only.
- Keep commits small and conventional (`feat(core): add max offer solver`). The public history is part of the deliverable.
- Explain non-obvious React, MCP, and LangChain choices in the PR description or commit body. Phil must be able to defend every line in an interview.
- Never copy LoanBidz branding, marketing copy, lead-form URLs, or logos into the new repo.
- When a domain rule in this PRD is ambiguous, stop and ask. Do not invent underwriting rules.
- Write prose (README, docs, tool descriptions, system prompts) without em dashes.
- Follow the working agreement in `CLAUDE.md` at the repo root: Claude never merges; Phil merges every PR with a review comment, verifies fixtures under his own author line, and writes the ADRs and README in his own voice.

## Overview

A public, open-source toolkit for rental property deal math: a TypeScript calculation library, an MCP server that lets agents use it, an eval suite that proves agents use it correctly, two LangChain chat agents (TypeScript and Python) that consume the server as a client would, and a small React UI. It reuses calculator logic Phil owns from an earlier white-label app, generalized and unbranded.

**Why it exists.** LLMs are unreliable at multi-step financial math and at interpreting messy deal descriptions. Deterministic tools fix the math. Good schemas, tool descriptions, and evals fix the interpretation. That second half is the point of this project. The agents close the loop: they show the MCP contract is complete enough that a client with zero knowledge of the math can answer investor questions.

## Goals

- Agents can answer real investor questions ("what can I offer on this fourplex and still hit 1.25 DSCR?") by chaining tools correctly.
- Measurable: an eval suite reports tool-selection accuracy, argument accuracy, and final-answer accuracy, with and without tools, and across agent harnesses.
- Two LangChain agents, one per language, that hold no math and no tool definitions of their own and pass the same eval suite.
- Public and readable: clean history, tested core, a README that teaches something.
- Ships in 3 to 4 weeks of evenings.

## Non-goals

- No user accounts, persistence, or backend database.
- No lender-specific pricing, rate sheets, or underwriting guidelines.
- No mobile app and no white-label theming.
- No RAG, no long-term agent memory, no multi-agent orchestration. The agents are a single ReAct loop over MCP tools.
- No web UI for the agents. They are CLI chat programs. Wiring the TypeScript agent into the React app is a stretch goal only.
- Not financial advice; the README says so.

## Source material

The existing app is a hybrid (web + iOS) Angular project with five working calculators, unit tests, marketing pages, and lead-form links. Phil owns all of the code. Only the calculation logic and its tests carry over.

Milestone 0 output, before any new code:

1. A table of every calculator found: name, file path, inputs, outputs, formula used, and test coverage.
2. A mapping of those calculators onto the seven in this PRD, marking each as reuse, refactor, or build new.
3. Any formulas that look wrong or inconsistent (for example, DSCR computed two different ways in two places).
4. A list of Angular or Ionic dependencies tangled into the math that must be removed.

Phil reviews this before Milestone 1 starts.

## Architecture

One pnpm monorepo, TypeScript everywhere except the Python agent, strict mode on. Dependencies point one way: core depends on nothing; everything else depends on core. The agents depend on nothing in the repo except the built MCP server binary, which they launch as a subprocess.

```
repo/
  packages/
    core/          pure TS calculators + zod schemas, no I/O
    mcp-server/    MCP server exposing core as tools (stdio)
    evals/         eval cases, runner, grader, reports, agent harness adapters
  apps/
    web/           React + Vite UI over core
    agent-ts/      LangChain.js chat agent over the MCP server
    agent-py/      LangChain Python chat agent over the MCP server
  docs/
    agent/         shared system prompt, read by both agents
    decisions/     short ADRs for non-obvious choices
    PRD.md
  .github/workflows/
```

## Stack

- Node 22 LTS, pnpm workspaces, TypeScript strict
- zod for input and output schemas, shared by core, MCP, and UI
- Vitest for tests; ESLint + Prettier
- Official MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- Anthropic TypeScript SDK for the direct eval runner
- LangChain.js: `langchain`, `@langchain/core`, `@langchain/anthropic`, `@langchain/mcp-adapters`, `@langchain/langgraph`
- LangChain Python: `langchain`, `langchain-anthropic`, `langchain-mcp-adapters`, `langgraph`; Python 3.12, `uv`, `ruff`, `pytest`
- React + Vite for the web app; PostHog JS for analytics
- MIT license

## Core library

`packages/core` holds seven calculators as pure functions. Each takes a zod-validated input object and returns a typed result with the computed values, the assumptions it applied, and any warnings.

| Calculator | Answers | Key outputs |
|---|---|---|
| `loanPayment` | What is my monthly payment, amortizing or interest-only? | P&I, IO payment, total interest, balance at year N |
| `dscr` | Does this property cover its debt? | DSCR (by method), PITIA, pass/fail vs target |
| `cashOnCash` | What return does my cash earn? | Annual cash flow, total cash invested, CoC % |
| `dealAnalysis` | Give me the full picture on one deal | NOI, cap rate, GRM, DSCR, CoC, monthly cash flow |
| `maxOffer` | What is the most I can pay and still hit my targets? | Max price, binding constraint, metrics at that price |
| `stressTest` | What breaks this deal? | Grid of DSCR and cash flow; break-even vacancy, rate, rent |
| `portfolioRollup` | How does my whole portfolio cover its debt? | Aggregate DSCR, per-property DSCR, weakest property |

### Units and naming (non-negotiable)

- Every field name carries its period and unit: `monthlyRent`, `annualPropertyTax`, `interestRatePct`, `vacancyPct`, `termYears`.
- Percentages are percent numbers: 7.1 means 7.1%. Reject values that look like decimals for rate-type fields (for example `interestRatePct: 0.071`) with an error that says what was probably meant.
- Money is in US dollars as numbers. Compute at full precision; round only for display.

### Domain rules

- DSCR has two methods and the caller must pick one. `rentToPitia`: gross monthly rent divided by PITIA (principal, interest, taxes, insurance, HOA), the common DSCR-loan qualification method. `noi`: annual NOI divided by annual debt service, the traditional commercial method. Never default silently; the result states which method was used.
- NOI = gross rent minus vacancy, plus other income, minus operating expenses (taxes, insurance, HOA, management, maintenance, capex reserves, owner-paid utilities). NOI excludes debt service.
- Cash-on-cash = annual pre-tax cash flow divided by total cash invested (down payment + closing costs + rehab + reserves the caller includes).
- Cap rate = annual NOI divided by price. GRM = price divided by annual gross rent.
- Max offer solves for price numerically (bisection) because taxes and closing costs can scale with price. It accepts one or more targets (min DSCR, min CoC, min monthly cash flow) and returns the highest price that satisfies all of them, naming the binding constraint.
- Stress test varies vacancy, interest rate, rent, and expenses over caller-provided ranges and reports the break-even point for each against the caller's target.
- Portfolio DSCR = total income divided by total debt service across properties. Never average the per-property ratios; that is a known agent mistake and an eval case.
- Rent basis for DSCR: `monthlyRent` is required and is the lease or expected rent. `monthlyMarketRent` is optional. `rentBasis` selects `lease`, `market`, or `lesser`. When `monthlyMarketRent` is given and `rentBasis` is omitted, use `lesser` and say so in assumptions; when only `monthlyRent` is given, use it.
- Property tax and insurance accept either a flat annual dollar amount or a percent of price, never both for the same field: `annualPropertyTax` or `propertyTaxPctOfPrice`; `annualInsurance` or `insurancePctOfPrice`. Percent-of-price inputs scale inside the max offer solver; flat inputs do not. Assumptions state which form was used.
- Financing accepts exactly one of `downPaymentPct`, `ltvPct`, `downPaymentAmount`, or `loanAmount`. Results always report all four derived values. Zero or more than one supplied is a validation error that lists the four options.
- Loans carry `amortization`: `amortizing` (default, stated in assumptions) or `interestOnly`. DSCR, cash flow, and the solver all use the payment that matches.
- HOA is `monthlyHoa`, optional, default 0. PITIA is the output name throughout; when HOA is 0 the assumptions say "no HOA".
- Cash invested for cash-on-cash = down payment + closing costs + rehab + reserves. Closing costs accept `closingCosts` (dollars) or `closingCostsPctOfPrice`. Reserves accept `reservesAmount` (dollars) or `reservesMonthsOfPitia`. Each pair is either-or.

### Results always include

- `assumptions`: defaults applied and the DSCR method used, in plain language.
- `warnings`: for example DSCR below 1.0, LTV above 80%, negative cash flow, or a solver that hit its bounds.

### Tests

Each calculator has worked-example fixtures whose arithmetic is written out in `docs/fixtures/` and asserted in unit tests, anchored to a published reference value where one exists, plus edge cases (0% rate, IO loans, 100% vacancy, solver with no feasible price, each either-or input pair with both and neither supplied). Target 95%+ line coverage on core. Unit tests are required for every package, not only core: MCP server (schema generation, teaching errors, each tool's text summary), evals (grader, tolerance math, YAML loading), and both agents (fake-model tests described in the agent section).

## MCP server

`packages/mcp-server` exposes each core calculator as one MCP tool over stdio, using the official TypeScript SDK. It holds no math of its own; it adapts core to agents.

### Tools

- One tool per calculator, snake_case names: `loan_payment`, `dscr`, `cash_on_cash`, `deal_analysis`, `max_offer`, `stress_test`, `portfolio_rollup`.
- Input schemas generated from the core zod schemas, with a description on every field that states unit and period.
- Output schemas declared, with structured results returned alongside a short text summary.
- All tools marked read-only and idempotent in their annotations.

### Tool descriptions are written for a model, not a human

Each description covers: what it computes, when to use it, when to use a different tool instead, unit conventions, and one short example call. Example of the bar: the `dscr` description must tell the model to ask or state an assumption when the user has not said which DSCR method applies, and to use `portfolio_rollup` rather than averaging several `dscr` calls.

### Errors teach the agent

Validation failures return a tool error (not a protocol error) that names the field, the problem, and the likely fix. Example: "interestRatePct was 0.071. This field is a percent number; did you mean 7.1?"

### Distribution

- Runs with `npx` after build; README shows the config for Claude Desktop and Claude Code.
- Stretch: Streamable HTTP transport and an npm publish.

## Chat agents (LangChain)

Two chat agents, `apps/agent-ts` and `apps/agent-py`, built on LangChain in each language. They exist to prove two things: that the MCP server is a complete contract (a client that knows nothing about deal math can answer investor questions), and that Phil can ship the same agent design in both LangChain ecosystems.

### Rules that keep the proof honest

- **Zero math, zero tool definitions.** Agents discover tools at startup from the MCP server over stdio via the official LangChain MCP adapters (`@langchain/mcp-adapters` in TS, `langchain-mcp-adapters` in Python). No tool schema, description, or formula is written in agent code. If the agent needs to know something about a tool, it belongs in the MCP server.
- **Same system prompt.** Both agents load `docs/agent/system-prompt.md` at runtime. The prompt covers: ask when DSCR method is unknown, never invent missing inputs, state units when echoing numbers, say when a question is out of scope. One file, two consumers.
- **Same graph, one deliberate divergence.** The TypeScript agent uses LangGraph's prebuilt ReAct agent (`createReactAgent`) with in-memory conversation state and no customization. The Python agent starts from the same prebuilt graph, then replaces it with a small custom LangGraph `StateGraph` that adds one node: a clarification gate that runs before any `dscr` or `max_offer` tool call, checks whether the user has stated a DSCR method, and if not, interrupts the graph to ask the user rather than letting the model guess or state an assumption. Everything else about the two agents stays identical. The divergence exists to show graph-level control in Python, which is where PostHog's own assistant lives, and it must be the only divergence: same system prompt, same tools, same one-shot JSON transcript shape. The eval harness treats the interrupt as the agent asking a question, which is the correct behavior for the method ambiguity category.
- **Same eval suite.** Both agents must pass the existing eval cases through the agent harness described below. Parity is a reported number, not a claim.
- **Model is config.** The model id comes from `AGENT_MODEL`; the provider is selected through LangChain's string-based model init (`anthropic:claude-...`) so switching providers is an env change, not a code change. Anthropic is the default and the only provider tested.

### Behavior

- CLI chat: `pnpm --filter agent-ts chat` and `uv run agent-py chat`. Streams tokens, prints each tool call and its result in a dim block so the user sees the reasoning, keeps conversation history for the session.
- One-shot mode: `chat --prompt "..." --json` runs a single turn and writes a JSON transcript to stdout: messages, every tool call with arguments and result, the final answer, and token usage. This is the interface the eval harness consumes, so the two agents and the direct Anthropic SDK runner are graded identically.
- Teaching errors flow through. When the MCP server returns a validation error, the agent must retry with corrected arguments, not apologize and stop. This is an eval case.
- Optional LangSmith tracing when `LANGSMITH_TRACING=true`. No other observability in v1.

### Tests

- Unit: each agent has tests that use a fake chat model (`FakeToolCallingChatModel` in TS, `GenericFakeChatModel` in Python) scripted to emit one tool call. The test asserts the agent launched the MCP server, loaded all seven tools, invoked the right one with the given arguments, and returned the tool's result in the final message. No API key required; runs in CI.
- Smoke: a CI step starts each agent in one-shot mode against the real MCP server with the fake model and checks the JSON transcript shape.
- Live: eval runs are manual dispatch only, same as the rest of the eval suite.

### Deliverables

- Both agents runnable from a fresh clone with the commands above and a README section each: install, set `ANTHROPIC_API_KEY`, run, three example prompts.
- Parity table in the eval report: direct SDK vs agent-ts vs agent-py, pass rate per category.
- ADRs: MCP adapters instead of hand-written LangChain tools (single source of truth); prebuilt ReAct graph instead of a custom graph or legacy `AgentExecutor`.
- ADR: why the Python agent carries the custom graph and the TypeScript agent does not, and why a clarification gate is implemented as a graph node rather than prompt instruction.

## Evals

`packages/evals` measures whether a model, given the MCP tools, turns messy investor questions into correct tool calls and correct answers. It runs with one command (`pnpm evals`) and writes a markdown report.

### Case format (one YAML file per case)

```yaml
id: max-offer-fourplex-01
category: chaining
prompt: >
  Fourplex in KC, asking 520k, rents about 1,150 a door.
  Taxes 6,800 a year, insurance 3,200. 25% down at 7.25%, 30 years.
  What's the most I can offer and still hit 1.25 DSCR?
expected:
  tools: [max_offer]          # required; order matters when listed as sequence
  args:
    max_offer.monthlyRent: { value: 4600, tolerance: 0 }
    max_offer.interestRatePct: { value: 7.25, tolerance: 0 }
  answer:
    maxPrice: { value: 0, tolerance_pct: 1 }   # filled from core, not by hand
  must_mention: ["DSCR method"]
```

Expected numeric answers are computed by calling core directly, never typed by hand.

### Categories (25 to 30 cases total)

- Single tool, clean inputs (baseline sanity)
- Chaining: max offer then stress test; deal analysis then portfolio rollup
- Unit traps: "7 and a quarter", "1,150 a door", annual vs monthly taxes
- Method ambiguity: DSCR asked with no method given; model must state or ask
- Portfolio trap: model must use `portfolio_rollup`, not average ratios
- Missing information: model should ask, not invent a number
- Out of scope: questions the tools cannot answer; model should not force a tool call
- Error recovery: a prompt that invites a decimal rate; the agent must correct after the teaching error

### Harnesses

The runner takes `--harness` with one of:

- `none`: the model with no tools (baseline)
- `direct`: Anthropic SDK tool-use loop over the MCP tools (the reference harness)
- `agent-ts`: shells out to `apps/agent-ts` in one-shot JSON mode
- `agent-py`: shells out to `apps/agent-py` in one-shot JSON mode

All harnesses produce the same transcript JSON, so the grader is one implementation. `pnpm evals` runs `none` and `direct` by default; `pnpm evals --all` runs every harness.

### Grading

- Tool selection: right tools, right order where order matters
- Arguments: each graded field within tolerance
- Final answer: key numbers within tolerance; `must_mention` checked by a rubric-based LLM judge with the rubric stored in the case
- Each case runs 3 times; report pass rate per case, per category, and per harness

### Baseline comparison

Run the same prompts with no tools. The README headline is the delta between baseline and with-tools accuracy, per category. A second table shows the three tool-using harnesses side by side.

### Config

Model name, run count, and API key come from environment variables. Evals run locally and from a manual GitHub Actions workflow, never on every push.

## React web app

`apps/web` is a small, idiomatic React app over core. It is a showcase of React skill, not a port of the old app. Cut it first if the schedule slips.

### Scope: two screens

1. Deal analysis: enter one property, see NOI, cap rate, GRM, DSCR (method toggle), CoC, and monthly cash flow update live.
2. Max offer + stress test: set targets, see the max price and binding constraint, then a sensitivity grid for vacancy and rate.

### Requirements

- Function components and hooks only; derived values computed, not stored in state
- Form validation reuses the core zod schemas
- Shareable state in the URL query string so a deal can be linked
- Works on mobile widths; accessible labels on every input
- PostHog JS installed: page views, a `deal_analyzed` event, and one feature flag gating the stress-test grid
- Component tests with Vitest + Testing Library for the two screens
- Deployed to a free static host with the URL in the README

## Quality, CI, README

CI (GitHub Actions, every push and PR): install, lint, typecheck, unit tests, coverage report, build all packages. A second job sets up Python 3.12 with `uv`, runs `ruff` and `pytest` for `apps/agent-py`. Evals run only via manual dispatch.

ADRs: a short decision record in `docs/decisions/` for each non-obvious choice: percent-number units, explicit DSCR method, bisection solver, structured tool errors, MCP adapters over hand-written agent tools, prebuilt ReAct graph.

README is a writing sample. Required sections, in order:

1. One-paragraph pitch: what it is and who it is for
2. The problem: what agents get wrong on deal math, with one concrete failure from the baseline run
3. Results: the baseline vs with-tools table and the harness parity table from the latest eval report
4. Quick start: install, run the MCP server in Claude Desktop or Claude Code, try three example prompts
5. Chat agents: run either agent in two commands, with a short note on why they hold no tool definitions
6. Design notes: units, DSCR methods, error messages for agents (link the ADRs)
7. Live demo link to the web app
8. Not financial advice disclaimer and MIT license

Keep it under about 1000 words. No marketing tone, no em dashes.

## Milestones

Work in this order and stop for Phil's review after each. If the schedule slips, cut the React app first, then the Python agent. Never cut evals or the TypeScript agent.

1. **M0: Inventory** (day 1). Done when the Milestone 0 report from Source material is reviewed and the reuse/refactor/build mapping is approved.
2. **M1: Core library** (days 2 to 6). Done when all seven calculators pass their fixtures, coverage on core is 95%+, CI is green, and the repo is public.
3. **M2: MCP server** (days 7 to 9). Done when every tool works from Claude Desktop or Claude Code using the README config, and a bad-unit input returns the teaching error.
4. **M3: Evals** (days 10 to 14). Done when 25+ cases run with one command, baseline and direct reports are generated, and the README results table is filled from a real run.
5. **M4: TypeScript agent** (days 15 to 17). Done when `agent-ts` chats from a fresh clone, the fake-model unit tests pass in CI, and `pnpm evals --harness agent-ts` produces a report alongside the direct harness per category.
6. **M5: Python agent** (days 18 to 21). Done when `agent-py` meets the same bar as M4 using the prebuilt graph, then passes the same evals with the custom clarification-gate graph, and the method ambiguity category shows the gate firing in the transcripts. The parity table shows all three harnesses side by side.
7. **M6: README and ADRs** (day 22). Done when the README meets every required section and a stranger could run the MCP server and one agent in under five minutes.
8. **M7: React app** (days 23 to 27). Done when both screens work, the app is deployed, PostHog events and the flag fire, and component tests pass.

Days are evening work sessions, not calendar days.

## Open questions

- [x] Resolved in M0 review (Oct 30, 2026): rent basis, tax and insurance input forms, financing inputs, interest-only loans, HOA, cash-on-cash basis. See Domain rules.
- [ ] Repo and package name ("Rental Deal Math Toolkit" is a working title; repo is `investment-property-mcp` for now)
- [ ] Which five calculators exist today, and are any formulas lender-specific in a way that should not ship?
- [ ] Which model to run evals against, and a monthly API budget cap. Agent harnesses triple the eval cost; confirm the cap covers `--all`.
- [ ] Static host for the web app
- [ ] Python agent as a separate `uv` project under `apps/agent-py`, or a top-level `pyproject.toml`? Assumed separate so the pnpm workspace stays pure.
