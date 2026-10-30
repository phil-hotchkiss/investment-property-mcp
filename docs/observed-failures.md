# Observed failures

A log of real agent behavior on deal math, observed by hand before or during development. Each entry names the eval case it became so the eval report can be traced back to something that actually happened. Entries are evidence, not anecdotes: quote the prompt and the model's words.

Format per entry: heading `## YYYY-MM-DD: short title`, then fields `Client and model`, `Prompt`, `What the model did`, `What was correct`, `Why it matters`, `Eval case` (id or "pending M3").

## 2026-10-30: Model pre-normalized a decimal rate, so the teaching error never fired

- **Client and model:** Claude Code, default model, with the rental-deal-math MCP server (PR #5 branch) registered.
- **Prompt:** "DSCR on a 400k place, 3200 rent, 4800 taxes, 1800 insurance, 25% down at 0.0725 for 30 years."
- **What the model did:** Made one dscr call with interestRatePct 7.25 and wrote "I read 0.0725 as 7.25%." The percent trap in the schema was never hit.
- **What was correct:** The result (DSCR 1.232) was correct. The behavior is fine for the user.
- **Why it matters:** A capable model normalizes units before calling. Unit-trap evals must grade the argument the tool received, not whether the error path fired. The error path still protects weaker models and is visible in the no-tools baseline.
- **Eval case:** pending M3 (unit traps category).

## 2026-10-30: Model derived the NOI method from the rent-to-PITIA result and got it wrong

- **Client and model:** Same session.
- **Prompt:** Same.
- **What the model did:** After a correct rentToPitia result of 1.232, it wrote, without a second tool call: "On the NOI method, with no operating expenses given, it would compute the same way minus HOA, so still about 1.23."
- **What was correct:** The NOI method on the same inputs gives 31,800 annual NOI (38,400 rent minus 4,800 taxes minus 1,800 insurance) over 24,558 annual debt service, which is 1.295. Taxes and insurance move from the denominator to the numerator between methods, so the two ratios are not derivable from each other.
- **Why it matters:** The model did in its head the one calculation it had not been handed a tool for, and stated it confidently. On a thinner deal the 0.06 gap decides pass or fail. Fix applied: the dscr tool description now says to call the tool again for the other method and explains why the two are not derivable. This is the README's concrete failure example.
- **Eval case:** pending M3 (method ambiguity or chaining category: "DSCR both ways", expected two dscr calls, expected 1.232 and 1.295).
