# Observed failures

A log of real agent behavior on deal math, observed by hand before or during development. Most entries are failures. Passes are logged when they change what the evals must measure. Each entry names the eval case it became so the eval report can be traced back to something that actually happened. Entries are evidence, not anecdotes: quote the prompt and the model's words.

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

## 2026-10-30: Without the MCP server, Claude Code computed the portfolio correctly by writing Python

- **Client and model:** Claude Code, default model, MCP server removed. Bash tool available.
- **Prompt:** "I have three rentals, all bought with 25% down at 7.25% for 30 years, no HOA. 1. Price 400,000, rent 3,200 a month, taxes 4,800 a year, insurance 1,800 a year. 2. Price 250,000, rent 2,900 a month, taxes 3,000 a year, insurance 1,200 a year. 3. Price 500,000, rent 2,800 a month, taxes 6,000 a year, insurance 2,400 a year. Does my portfolio cover its debt at a 1.25 DSCR? Use rent over PITIA."
- **What the model did:** Wrote a Python one-liner in Bash to compute the amortized payments, then reported per-property DSCR 1.23, 1.78, 0.86 and portfolio 1.19 (8,900 over 7,484). It did not average the ratios. It gave three correct remedies: about 460 dollars more monthly rent, about 364 dollars less monthly PITIA, or about 53,000 dollars of principal paydown on property 3.
- **What was correct:** Everything. Fixture values are 1.2324, 1.7801, 0.8594, portfolio 1.1892.
- **Why it matters:** This was not a no-tools run. A model with a code interpreter and fully specified, clean inputs does the math correctly. The eval baseline harness must therefore be a bare API call with no tools at all, as the PRD specifies, or the baseline-versus-tools delta disappears. It also sharpens the project's claim: the toolkit's value is on messy inputs, missing information, unit traps, method ambiguity, weaker or cheaper models, and consistency across repeated runs, not on arithmetic a strong model can script. The README should say this rather than claim models cannot do deal math.
- **Eval case:** None directly. Informs the `none` harness design and the single-tool-clean-input category, which is expected to show a small delta.

## 2026-10-30: With the tool result in hand, the model invented the one number the summary left out

- **Client and model:** evals direct harness, claude-haiku-4-5, single-tool-dscr-01.
- **Prompt:** "Condo in Tampa. Price $315,000, rent $2,450 per month, property tax $5,200 per year, insurance $3,100 per year, HOA $325 per month. 20% down, 7.0% interest, 30-year loan. What is the DSCR using the rent-to-PITIA method, and does it clear a 1.0 target?"
- **What the model did:** Took DSCR 0.91 and PITIA 2,693.23 correctly from the tool text. Then it wrote a breakdown table with a monthly P&I of 2,096.46. That number appears nowhere in the tool output.
- **What was correct:** DSCR and PITIA. The true monthly P&I is 1,676.56.
- **Why it matters:** Models fill gaps. A tool result must contain every number the model might echo. `structuredContent` is not enough, because most clients pass only the text content to the model. Fix applied: the tool text now carries a second block with the full values JSON, and the eval cases now check P&I and loan amount.
- **Eval case:** `single-tool-dscr-01` (now checks `monthlyDebtService` and `loanAmount`).
