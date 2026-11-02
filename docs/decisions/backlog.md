# ADR backlog

These are decision records waiting to be written up with [the template](0000-template.md); Phil writes them, and this file holds the raw material.

## 1. Percent-number units with decimal rejection

- **Context**
  - Agents and users mix 7.1 and 0.071 for the same rate.
  - A rate off by 100x still computes, so the wrong answer looks plausible.
  - Field names must carry unit and period so a model can read them cold.
- **Decision**
  - Percent fields MUST take percent numbers: 7.1 means 7.1%.
  - Rate-type percent fields MUST reject values in (0, 1) with an error that suggests the percent number ("did you mean 7.1?"). Exactly 1 is accepted as 1%.
  - Scope: every core input schema, so every MCP tool.
  - Currently achieved by the shared percent schemas in `packages/core/src/schemas/`, with an `allowSubOne` flag per field.
- **Alternatives considered**
  - Decimals everywhere. Rejected: humans and prompts say "7.25%", so every call would need a conversion the model can get wrong.
  - Accept both and infer from magnitude. Rejected: 0.5 is a real vacancy or tax percent, so inference guesses wrong on exactly the fields where it matters.
  - Separate fields for each form. Rejected: doubles the schema an agent reads and still lets it pick the wrong one.
- **Consequences**
  - (+) The wrong unit fails loudly and the error teaches the fix.
  - (-) `allowSubOne` exception: vacancy, management, maintenance, capex, and tax or insurance as percent of price accept values below 1, where 0.5% is real. Those fields get no decimal protection.
  - (-) A capable model pre-normalizes 0.0725 to 7.25 before calling, so the error path never fires in a live run ([observed failure](../../evals/observed-failures.md#2026-10-30-model-pre-normalized-a-decimal-rate-so-the-teaching-error-never-fired)). Evals must grade the argument the tool received, not whether the error fired.
- **Relation to other decisions**
  - The rejection message is delivered by structured tool errors (4).
- **Source**: [PR #2](https://github.com/phil-hotchkiss/investment-property-mcp/pull/2)

Status: not yet written

## 2. DSCR method is required, no default

- **Context**
  - DSCR has two common methods: rent to PITIA (DSCR-loan qualification) and NOI over debt service (commercial).
  - They give different answers for the same property (fixture A: 1.23 vs 0.94), often on opposite sides of a target.
  - Users rarely say which one their lender uses.
- **Decision**
  - `dscr`, `max_offer` with `minDscr`, and `portfolio_rollup` MUST require a method. There MUST NOT be a silent default.
  - The result MUST state which method was used.
  - Currently achieved by a required `method` (or `dscrMethod`) enum in the core schemas, and a `dscr` tool description that tells the model to ask or state an assumption, and to call the tool again for the other method rather than derive it.
- **Alternatives considered**
  - Default to `rentToPitia`. Rejected: hides a choice that changes pass or fail.
  - Compute both always. Rejected: doubles the output and still leaves the model to pick one for the answer.
- **Consequences**
  - (+) The method choice is visible in every call and every result.
  - (-) A required field does not make the model ask. In the first eval run, Haiku 4.5 with the tool picked `rentToPitia` silently on bare prompts (method ambiguity: 12/12 without tools, 5/12 with them; [report](../../packages/evals/reports/2026-10-30-haiku/report.md)).
  - (-) Without a second call, a model derived the NOI result from the rent to PITIA one and got it wrong ([observed failure](../../evals/observed-failures.md#2026-10-30-model-derived-the-noi-method-from-the-rent-to-pitia-result-and-got-it-wrong)).
- **Relation to other decisions**
  - The planned Python clarification gate enforces asking at the graph level, which this schema rule cannot.
- **Source**: [PR #2](https://github.com/phil-hotchkiss/investment-property-mcp/pull/2), description change in [PR #5](https://github.com/phil-hotchkiss/investment-property-mcp/pull/5)

Status: not yet written

## 3. Bisection solver for max offer

- **Context**
  - Max offer needs the highest price that meets up to three targets (min DSCR, min CoC, min monthly cash flow).
  - Taxes, insurance, closing costs, and financing can scale with price, and the targets interact.
- **Decision**
  - `maxOffer` MUST return the highest price within tolerance that satisfies every target, and MUST name the binding constraint.
  - It MUST flag when the search hit its bounds or no price is feasible.
  - Currently achieved by `solve/bisection.ts`: bisection on a monotone predicate, default upper bound 20x annual gross rent (stated in assumptions, overridable), binding constraint found by re-running targets at max price plus 2 dollars.
  - Price scaling: percent-of-price inputs (financing, tax, insurance, closing costs) scale with price; dollar inputs stay fixed.
  - Fixed-dollar financing floor: with a fixed `loanAmount` the search starts at the loan amount; with a fixed `downPaymentAmount` it starts at the down payment plus 1 dollar, since lower prices are invalid.
- **Alternatives considered**
  - Closed form. Rejected: needs a separate derivation for each target and input-form combination; base case still checked against it (392,859 vs closed form 392,860.17).
  - Newton's method. Rejected: needs derivatives across piecewise inputs and can diverge; bisection is guaranteed on a monotone predicate.
- **Consequences**
  - (+) One search covers every combination of targets and input forms.
  - (-) Answers are within a dollar tolerance, not exact, and depend on monotonicity.
  - (-) The 20x GRM bound is an assumption a caller may need to override.
- **Relation to other decisions**
  - Depends on percent-of-price inputs being distinct fields from dollar inputs, as in (1).
- **Source**: [PR #4](https://github.com/phil-hotchkiss/investment-property-mcp/pull/4)

Status: not yet written

## 4. Structured tool errors that teach

- **Context**
  - Agents send wrong units, misspelled fields, and conflicting either-or inputs.
  - A model only corrects what it can read in the tool result.
- **Decision**
  - Validation failures MUST come back as tool errors (`isError`), never protocol errors.
  - Each error MUST name the field, the problem, and the likely fix, then ask for a retry.
  - Unknown errors MUST rethrow, not be dressed up as validation.
  - Currently achieved by `packages/mcp-server/src/errors.ts` formatting core `ValidationError` issues as one `field: message` line each, ending "Fix the input and call the tool again."
- **Alternatives considered**
  - Protocol errors. Rejected: many clients surface them to the user, not the model, so the agent cannot retry.
  - Silent coercion (for example 0.071 to 7.1). Rejected: hides the mistake and guesses wrong on fields where small values are real.
- **Consequences**
  - (+) Agents retry with corrected arguments; error recovery is an eval category.
  - (-) Error text is part of the contract and must stay stable and readable.
- **Relation to other decisions**
  - Carries the messages from (1), (2), and (6); delivered through SDK validation (5).
- **Source**: [PR #5](https://github.com/phil-hotchkiss/investment-property-mcp/pull/5)

Status: not yet written

## 5. SDK validation with core schemas instead of a custom wrapper

- **Context**
  - The MCP SDK validates tool input against a zod schema passed to `registerTool`.
  - The first implementation bypassed it to control the error text.
- **Decision**
  - Tool input schemas MUST be core's zod schemas, passed straight to `registerTool`, so the SDK validates and advertises them.
  - Core's teaching text MUST survive in the SDK error.
  - Currently achieved by the SDK error, which keeps core's message and appends the field path ("... at loan.interestRatePct"); resolver checks after schema validation still go through core's `ValidationError` formatting.
- **Alternatives considered**
  - `toJSONSchema` for the advertised schema plus `looseObject` to skip SDK validation, with a custom validator. Rejected: non-idiomatic, and it bought only a trailing sentence in the error.
- **Consequences**
  - (+) One schema source, the idiomatic SDK path, less code.
  - (-) Error wording is partly the SDK's and can change with an SDK upgrade.
- **Relation to other decisions**
  - Delivers the errors in (4); enables the strict objects in (6).
- **Source**: [PR #5](https://github.com/phil-hotchkiss/investment-property-mcp/pull/5), changed after Phil's review

Status: not yet written

## 6. Strict input objects

- **Context**
  - zod objects drop unknown keys by default.
  - A misspelled optional field (for example `vacancyPercent` for `vacancyPct`) would vanish and its default would apply.
- **Decision**
  - Tool inputs MUST reject unknown fields with a tool error.
  - `tools/list` MUST advertise `additionalProperties: false`.
  - Currently achieved by strict zod objects in core, asserted in an mcp-server test.
- **Alternatives considered**
  - Silently drop unknown keys. Rejected: a misspelled vacancyPct computes zero vacancy and returns a confident wrong answer.
- **Consequences**
  - (+) Typos fail loudly and teach the correct name.
  - (-) Clients that add extra metadata keys get an error and must strip them.
- **Relation to other decisions**
  - Errors follow (4); validation runs through the SDK per (5).
- **Source**: [PR #5](https://github.com/phil-hotchkiss/investment-property-mcp/pull/5), changed after Phil's review

Status: not yet written

## 7. Every computed value in the tool text

- **Context**
  - Tools return `structuredContent` and a short text summary.
  - Most clients pass only the text to the model.
  - In an eval run, Haiku 4.5 invented a monthly P&I of 2,096.46 (true 1,676.56) that the summary left out ([observed failure](../../evals/observed-failures.md#2026-10-30-with-the-tool-result-in-hand-the-model-invented-the-one-number-the-summary-left-out)).
- **Decision**
  - Every tool result MUST include every computed value in its text content.
  - Currently achieved by a second text block, "All computed values:" plus the compact JSON of `values`, after the prose summary; a test asserts it parses to core's `values` for every tool.
- **Alternatives considered**
  - Rely on `structuredContent`. Rejected: clients do not pass it to the model, and the model invented P&I.
- **Consequences**
  - (+) The model never has to fill a gap; nothing is rounded.
  - (-) Larger tool results, more input tokens per call.
- **Relation to other decisions**
  - No related decisions yet.
- **Source**: [PR #11](https://github.com/phil-hotchkiss/investment-property-mcp/pull/11)

Status: not yet written

## 8. Regrade over rerun, with committed transcript archives and provenance

- **Context**
  - The first full run exposed grader defects ([PR #13](https://github.com/phil-hotchkiss/investment-property-mcp/pull/13)); no transcripts were committed, so nothing could be regraded.
  - README numbers must be verifiable by a stranger.
  - Model calls cost money and are not reproducible.
- **Decision**
  - Every published run MUST commit its report, summary JSON, and a gzipped transcript archive under `evals/runs/<name>`.
  - The summary MUST record provenance: repo commit, hashes of the system prompt, tool definitions, and each case file, model ids, pricing date.
  - Grader changes MUST be regrades, not reruns. Reruns happen only when the model's inputs changed.
  - `pnpm evals regrade <run>` MUST refuse when cases or tool definitions changed since the run, unless forced.
  - Currently achieved by: planned PR, not yet built.
- **Alternatives considered**
  - Rerun on every grader change. Rejected: cost, and the original evidence is lost.
  - Tracing SaaS as the only record. Rejected: not verifiable by strangers without an account.
- **Consequences**
  - (+) Results are reproducible and auditable from the repo alone.
  - (-) Archives add repo weight; provenance checks can block a regrade until forced.
- **Relation to other decisions**
  - Tracing (9) is the exploration surface; these archives stay the system of record.
- **Source**: [PRD, Evidence and regrading](../prd.md#evidence-and-regrading)

Status: not yet written

## 9. LangSmith over PostHog LLM analytics for tracing

- **Context**
  - Eval runs and agent sessions need traces for exploring failures and cost.
  - LangChain traces to LangSmith natively; the direct harness uses the Anthropic SDK.
- **Decision**
  - Every model call in the runner and agents SHOULD be traced to LangSmith when `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are set, tagged with case id, harness, model, run number, and commit.
  - The runner MUST work without tracing.
  - Currently achieved by: planned, `langsmith` SDK in both languages, LangSmith datasets and experiments for runs.
- **Alternatives considered**
  - PostHog LLM analytics. Deferred: could be added later as an optional sink if useful for the application story.
- **Consequences**
  - (+) Native LangChain integration, datasets, and side-by-side experiment comparison.
  - (-) Another account and API key; not a public record.
- **Relation to other decisions**
  - Committed archives (8) remain the system of record.
- **Source**: [PRD, Tracing](../prd.md#tracing)

Status: not yet written

## 10. Claude implements, Phil decides

- **Context**
  - Reviewers of a public repo should be able to tell which judgment was human.
- **Decision**
  - Claude MUST implement; Phil MUST review every PR in conversation and approve each merge. Claude MUST NOT merge on green CI alone.
  - Phil MUST write the ADRs and README in his own voice.
  - Currently achieved by `CLAUDE.md`, PR bodies that record review changes, and a co-author trailer on implementation commits.
- **Alternatives considered**
  - Phil implements with Claude assisting. Rejected: slower, and the project exists partly to show directing an agent.
  - Claude merges on green CI. Rejected: CI cannot judge domain rules or design.
- **Consequences**
  - (+) The human judgment is visible in history.
  - (-) Phil is the bottleneck for every merge.
- **Relation to other decisions**
  - No related decisions yet.
- **Source**: [CLAUDE.md](../../CLAUDE.md)

Status: not yet written
