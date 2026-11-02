# Eval report

- Date: 2026-10-31
- Agent model: claude-sonnet-5-5
- Judge model: claude-sonnet-5-5 (108 calls, $0.5337)
- Harnesses: none, direct
- Runs per case: 3
- Total cost: $8.3851 (agent plus judge)
- Total tokens: 3220115
- Pricing date: 2026-10-30

`na` dimensions do not count against a run. The `none` harness cannot call tools, so its tool
selection and arguments are always `na`. `asked n` counts runs that asked a question where
the case accepts one (`accept_question`).

## Pass rate by category

| Category | none | direct |
| --- | --- | --- |
| single-tool | 11/15 (73%) | 14/15 (93%) |
| chaining | 3/12 (25%) | 12/12 (100%) |
| unit-traps | 15/15 (100%) | 15/15 (100%) |
| method-ambiguity | 12/12 (100%) | 11/12 (92%) |
| portfolio-trap | 3/9 (33%) | 8/9 (89%) |
| missing-info | 9/9 (100%) | 9/9 (100%) |
| out-of-scope | 1/6 (17%) | 2/6 (33%) |
| error-recovery | 1/6 (17%) | 6/6 (100%) |
| all | 55/84 (65%) | 77/84 (92%) |

## Per case

| Case | Category | Evidence | none | direct |
| --- | --- | --- | --- | --- |
| chaining-deal-portfolio-01 | chaining |  | 0/3 (mentions) | 3/3 |
| chaining-dscr-both-ways-01 | chaining | docs/observed-failures.md#2026-10-30-model-derived-the-noi-method-from-the-rent-to-pitia-result-and-got-it-wrong | 0/3 (mentions) | 3/3 |
| chaining-loan-then-dscr-01 | chaining |  | 3/3 | 3/3 |
| chaining-max-offer-stress-01 | chaining |  | 0/3 (mentions) | 3/3 |
| error-recovery-decimal-rate-01 | error-recovery | docs/observed-failures.md#2026-10-30-model-pre-normalized-a-decimal-rate-so-the-teaching-error-never-fired | 0/3 (answer, mentions) | 3/3 |
| error-recovery-vacancy-field-01 | error-recovery |  | 1/3 (mentions, answer) | 3/3 |
| method-ambiguity-bare-cover-01 | method-ambiguity |  | 3/3 | 3/3 |
| method-ambiguity-bare-cover-02 | method-ambiguity |  | 3/3 | 3/3 |
| method-ambiguity-commercial-context-01 | method-ambiguity |  | 3/3 (asked 3) | 2/3 (mentions) |
| method-ambiguity-lender-context-01 | method-ambiguity |  | 3/3 (asked 3) | 3/3 (asked 3) |
| missing-info-max-offer-no-rent-01 | missing-info |  | 3/3 | 3/3 |
| missing-info-no-rate-01 | missing-info |  | 3/3 | 3/3 |
| missing-info-no-rent-01 | missing-info |  | 3/3 | 3/3 |
| out-of-scope-rate-forecast-01 | out-of-scope |  | 1/3 (answer) | 2/3 (answer) |
| out-of-scope-which-market-01 | out-of-scope |  | 0/3 (answer, mentions) | 0/3 (answer, mentions) |
| portfolio-trap-average-ask-01 | portfolio-trap |  | 0/3 (mentions) | 2/3 (mentions) |
| portfolio-trap-average-passes-01 | portfolio-trap |  | 3/3 | 3/3 |
| portfolio-trap-three-props-01 | portfolio-trap | docs/observed-failures.md#2026-10-30-without-the-mcp-server-claude-code-computed-the-portfolio-correctly-by-writing-python | 0/3 (mentions) | 3/3 |
| single-tool-cash-on-cash-01 | single-tool |  | 3/3 | 2/3 (answer) |
| single-tool-deal-analysis-01 | single-tool |  | 2/3 (answer) | 3/3 |
| single-tool-dscr-01 | single-tool |  | 3/3 | 3/3 |
| single-tool-loan-payment-01 | single-tool |  | 2/3 (answer) | 3/3 |
| single-tool-stress-test-01 | single-tool |  | 1/3 (answer) | 3/3 |
| unit-traps-decimal-rate-01 | unit-traps | docs/observed-failures.md#2026-10-30-model-pre-normalized-a-decimal-rate-so-the-teaching-error-never-fired | 3/3 | 3/3 |
| unit-traps-dollars-down-01 | unit-traps |  | 3/3 | 3/3 |
| unit-traps-monthly-taxes-01 | unit-traps |  | 3/3 | 3/3 |
| unit-traps-per-door-01 | unit-traps |  | 3/3 | 3/3 |
| unit-traps-quarter-pct-down-01 | unit-traps |  | 3/3 | 3/3 |

## Failures

### chaining-deal-portfolio-01 / none / run 1

- mentions: judge failed (missing: Fourplex deal metrics from deal_analysis (no tool was called), Combined DSCR from portfolio_rollup with both properties (no tool was called)): The answer computed the combined DSCR from summed NOI over summed debt service and clearly said yes against 1.25, but the agent had no tools and made no deal_analysis or portfolio_rollup calls as the rubric requires.

> # Combined DSCR (NOI method) **Combined DSCR is about 1.42, so you clear 1.25.** ## Fourplex \| Item \| Calculation \| Annual \| \|---\|---\|---\| \| Gross potential rent \| 4 units × 900 dollars/month × 12 \| 43,200 \| \| Vacancy (5%) \| 43,200 × 0.05 \| −2,160 \| \| Effective gross income \| \| 41,040 \| \| Managem

### chaining-deal-portfolio-01 / none / run 2

- mentions: judge failed (missing: Deal metrics for the fourplex from deal_analysis (no tool was called), Combined DSCR from portfolio_rollup with both properties (no tool was called)): The agent had no tools, so the fourplex metrics were not produced by deal_analysis and the combined DSCR was not produced by portfolio_rollup, even though the combined DSCR was correctly computed from total NOI over total debt service, named as the NOI method, and clearly compared to 1.25.

> **Yes, the combined DSCR on the NOI method is about 1.42, which clears 1.25.** **Assumptions I made** - Management at 8% is applied to effective gross income (rent after vacancy), not to gross rent. - The loan is 75% of purchase price, with a fixed-rate payment on a 30-year amortization for both pr

### chaining-deal-portfolio-01 / none / run 3

- mentions: judge failed (missing: Fourplex deal metrics from deal_analysis tool call, Combined DSCR computed via portfolio_rollup tool call with both properties): The agent had no tools, so deal_analysis and portfolio_rollup were never called, even though the answer computes the combined DSCR from summed NOI and debt service, names the NOI method, and clearly says it clears 1.25.

> # Combined DSCR (NOI method): about 1.42, which clears 1.25 ## Fourplex (360,000 dollars) \| Item \| Math \| Dollars per year \| \|---\|---\|---\| \| Gross rent \| 900 per unit per month × 4 × 12 \| 43,200 \| \| Vacancy (5%) \| 43,200 × 0.05 \| −2,160 \| \| Effective income \| \| 41,040 \| \| Management (8%) \| 41,040

### chaining-dscr-both-ways-01 / none / run 1

- mentions: judge failed (missing: Two dscr tool calls (one with method rentToPitia, one with method noi) — the agent had no tools and made no calls, Both ratios matching actual tool results — ratios were computed by hand, not taken from tool output): The agent made no dscr tool calls, so both ratios were computed manually rather than from two tool results, failing the rubric's tool-call requirement even though both ratios were reported with method labels.

> # DSCR both ways **Inputs (as you gave them)** - Price: $400,000 - Down payment: 25% = $100,000, so loan = $300,000 - Rate: 7.25% per year, 30-year fixed (360 monthly payments) - Rent: $3,200 per month ($38,400 per year) - Property taxes: $4,800 per year ($400 per month) - Insurance: $1,800 per yea

### chaining-dscr-both-ways-01 / none / run 2

- mentions: judge failed (missing: Two dscr tool calls (one with method rentToPitia and one with method noi) — the agent had no tools and made no calls, Both ratios matching actual tool results — the ratios were computed by hand rather than taken from tool outputs): The agent made no dscr tool calls, so the rentToPitia and NOI ratios were computed manually even though both were reported and labeled by method.

> Both DSCRs are below, but the NOI figure is provisional because you didn't give any operating expenses beyond taxes and insurance. **Loan** - Price: 400,000 dollars. Down payment: 25% = 100,000 dollars. Loan: 300,000 dollars. - Rate: 7.25% per year, 30-year term, 360 monthly payments. - Principal a

### chaining-dscr-both-ways-01 / none / run 3

- mentions: judge failed (missing: Two dscr tool calls (one with method rentToPitia, one with method noi) — the agent had no tools and made no calls, Both ratios matching actual tool results — the ratios were computed by hand, not taken from tool outputs): The agent made no dscr tool calls, so the rubric requirement of two calls (rentToPitia and noi) was not met, even though both ratios were reported with method labels.

> # DSCR both ways **Inputs (as you gave them)** - Price: 400,000 dollars - Down payment: 25% = 100,000 dollars, so the loan is 300,000 dollars - Rate and term: 7.25% per year, 30 years (360 monthly payments) - Rent: 3,200 dollars per month (38,400 dollars per year) - Property taxes: 4,800 dollars pe

### chaining-max-offer-stress-01 / none / run 1

- mentions: judge failed (missing: Max price from a max_offer tool call, stress_test run at the max_offer price with an interest rate range, Break-even rate taken from the stress_test result rather than computed by hand): The agent had no tools and computed everything by hand, so there was no max_offer or stress_test call, although the answer did name the NOI DSCR method.

> The question specifies NOI-based DSCR, so I used NOI ÷ annual debt service. **Inputs** - Rents: 1,050 + 1,050 + 1,200 = 3,300 dollars per month, or 39,600 dollars per year - Vacancy: 5% of gross rent - Management: 8%, which I applied to rent after vacancy (if you meant 8% of gross rent, the price d

### chaining-max-offer-stress-01 / none / run 2

- mentions: judge failed (missing: max price from a max_offer tool call, stress_test run at the max_offer price with an interest rate range, break-even rate taken from the stress_test result): The agent had no tools, so the max price and break-even rate were computed by hand with no max_offer or stress_test calls; the answer does name the DSCR method (NOI ÷ debt service) and gives a break-even of about 7.25%.

> You asked for 1.25 on NOI, so I used NOI ÷ annual debt service. **Inputs** - Rents: 1,050 + 1,050 + 1,200 = 3,300 dollars per month, or 39,600 dollars per year gross - Vacancy: 5% of gross rent = 1,980 dollars per year - Effective gross income: 37,620 dollars per year - Management: 8% of effective

### chaining-max-offer-stress-01 / none / run 3

- mentions: judge failed (missing: Max price from a max_offer tool call, stress_test run at the max_offer price with an interest rate range, Break-even rate where DSCR falls to 1.25 taken from the stress_test result): The agent had no tools, so the price and break-even rate came from hand calculation rather than max_offer and stress_test calls, though the DSCR method was named.

> **Method:** DSCR = NOI ÷ annual debt service, with a 1.25 target. **Inputs (as you gave them)** - Rents: 1,050 + 1,050 + 1,200 = 3,300 dollars/month, or 39,600 dollars/year gross - Vacancy: 5% of gross rent - Management: 8%, which I applied to collected rent (after vacancy). If you meant 8% of gros

### error-recovery-decimal-rate-01 / none / run 1

- answer: monthlyCashFlow expected -418.4734545955416, not found in final text
- mentions: judge failed (missing: DSCR and monthly cash flow matching a deal_analysis result computed at 7.25% (no deal_analysis call was made; the agent had no tools)): The answer uses 7.25% and names NOI DSCR, but the figures were computed by hand rather than from a deal_analysis result, so nothing exists for them to match.

> # Boise rental: NOI DSCR analysis ## Inputs \| Item \| Value \| \|---\|---\| \| Price \| $435,000 \| \| LTV \| 80% \| \| Note rate \| 7.25% per year, 30-year fixed \| \| Rent \| $2,650 per month \| \| Property taxes \| $2,900 per year \| \| Insurance \| $1,300 per year \| \| Vacancy \| 5% of gross rent \| \| Management \| 8% (

### error-recovery-decimal-rate-01 / none / run 2

- answer: monthlyCashFlow expected -418.4734545955416, not found in final text
- mentions: judge failed (missing: Figures must match a deal_analysis tool result computed at 7.25%; the agent had no tools and made no deal_analysis call, so the figures are self-computed): The rubric requires DSCR and monthly cash flow to match a deal_analysis result at 7.25%, but no tool was called, so there is no tool result to match, even though the manual figures appear to use 7.25%.

> # Boise rental: NOI DSCR analysis ## Inputs (as you gave them) - Price: $435,000 - LTV: 80% - Note rate: 7.25% per year, 30-year fixed (from "0.0725") - Rent: $2,650 per month - Property taxes: $2,900 per year - Insurance: $1,300 per year - Vacancy: 5% of gross rent - Management: 8%, which I applie

### error-recovery-decimal-rate-01 / none / run 3

- answer: monthlyCashFlow expected -418.4734545955416, not found in final text
- mentions: judge failed (missing: DSCR and monthly cash flow matching a deal_analysis result computed at 7.25% (no deal_analysis call was made; figures were computed by hand)): The answer correctly uses 7.25%, names NOI DSCR, and does not narrate any tool error, but the agent had no tools, so no deal_analysis result exists for the figures to match.

> # Boise rental: NOI DSCR analysis ## Inputs - Price: $435,000 - LTV: 80%, so loan = **$348,000** and down payment = **$87,000** (closing costs not included) - Rate: 0.0725 = **7.25% per year**, 30-year fixed, 360 monthly payments - Rent: $2,650 per month - Taxes: $2,900 per year - Insurance: $1,300

### error-recovery-vacancy-field-01 / none / run 1

- mentions: judge failed (missing: Final cash-on-cash figure matching a tool result (the agent made no tool calls, so no tool result exists to match)): The answer applies 8% vacancy and has no tool-error narration, but the agent made no tool calls, so its -0.32% figure cannot match any tool result as the rubric requires.

> # Cash-on-cash: Tulsa 4-plex **Result: about -0.3% per year.** The property is roughly break-even to slightly negative on cash flow at these numbers. ## Income (per year) - Gross potential rent: 4 units × 925 dollars per month × 12 = **44,400 dollars per year** - Vacancy at 8%: -3,552 dollars per

### error-recovery-vacancy-field-01 / none / run 2

- answer: cashOnCashPct expected -0.942214348529466, not found in final text

> # Cash-on-cash: Tulsa 4-plex **Result: about -0.6% per year. The property runs roughly 726 dollars per year negative after debt service.** ## Assumptions - Vacancy, maintenance, and capex are percentages of gross potential rent. Management is a percentage of collected rent (after vacancy). - No ot

### method-ambiguity-commercial-context-01 / direct / run 2

- response: answered (judge)
- mentions: judge failed (missing: Does not say the NOI method was chosen because of the commercial framing): The answer names the NOI-over-debt-service method and clearly fails the deal against 1.25, but never says the method was chosen because the user framed it as a commercial deal.

> **The deal doesn't cover. DSCR is 0.90 by the NOI method, against the bank's 1.25.** NOI is about 31,952 dollars per year and debt service is about 35,599 dollars per year, so income doesn't even cover the loan payment. **Inputs** - Price: 540,000 dollars - Down payment: 25%, which is 135,000 dolla

### out-of-scope-rate-forecast-01 / none / run 2

- response: asked_for_info (judge)
- answer: asked instead of answering

> I can't forecast mortgage rates. Nobody reliably can, and a guess from me would be worse than no answer. Predicting rates is also outside rental deal math, so I'd treat any confident call, including from me, with suspicion. What I can do is show how much a rate change matters for your deal, so you

### out-of-scope-rate-forecast-01 / none / run 3

- response: asked_for_info (judge)
- answer: asked instead of answering

> Forecasting interest rates is outside what I can do reliably. Nobody can predict next year's rates with any consistency, and a guess from me would just be noise. What I can do is help you test whether waiting makes sense using your own numbers. **A few ways to frame the decision:** 1. **Breakeven

### out-of-scope-rate-forecast-01 / direct / run 2

- response: asked_for_info (judge)
- answer: asked instead of answering

> I can't tell you what rates will do next year. Nobody can forecast that reliably, and it's outside rental deal math, so I won't guess. I can show you how much the rate matters for a specific deal, which may help you decide whether to wait. Two things I can run: 1. **Rate sensitivity:** how your pa

### out-of-scope-which-market-01 / none / run 1

- response: asked_for_info (judge)
- answer: asked instead of answering

> I can't pick a market without numbers for specific deals, and I don't want to guess at prices, rents, or taxes. Here is what I need to run a side-by-side comparison. **For each market (or a specific property in each):** 1. Purchase price, in dollars 2. Expected rent, in dollars per month 3. Propert

### out-of-scope-which-market-01 / none / run 2

- response: asked_for_info (judge)
- answer: asked instead of answering
- mentions: judge failed (missing: Does not explicitly say it cannot pick a market from the tools it has; it only says it can't pick a winner without real numbers, with no mention of tool limitations): The reply invents no market figures and redirects to analyzing specific properties with price, rent, taxes, insurance, and financing, but it never says the limit comes from its tools.

> I can't pick a winner without real numbers for each deal, and I don't want to guess at prices, rents, or taxes. Here's what I need to compare them properly. **For each market (or each specific property)** - Purchase price (dollars) - Expected rent (dollars per month) - Property taxes (dollars per y

### out-of-scope-which-market-01 / none / run 3

- response: asked_for_info (judge)
- answer: asked instead of answering

> I can't pick a market without numbers for specific deals, and I don't want to guess at them. Here's what I need to compare the two properly. **For each market (or each property you're considering):** 1. Purchase price (dollars) 2. Expected rent (dollars per month) 3. Property taxes (dollars per yea

### out-of-scope-which-market-01 / direct / run 1

- response: asked_for_info (judge)
- answer: asked instead of answering

> I can compare them, but I need real numbers for each property first. I won't guess at prices, rents, or tax rates for either city, because the answer depends on them. **For each property (Kansas City and Austin):** 1. Purchase price, in dollars. 2. Expected rent, in dollars per month. Tell me if it

### out-of-scope-which-market-01 / direct / run 2

- response: asked_for_info (judge)
- answer: asked instead of answering

> I can compare them, but I need the details of each deal first. I won't guess at prices, rents, or rates. For each property (Kansas City and Austin), please send: **Required** - Purchase price, in dollars - Expected rent, in dollars per month - Property tax, in dollars per year or as a percent of pr

### out-of-scope-which-market-01 / direct / run 3

- response: asked_for_info (judge)
- answer: asked instead of answering
- mentions: judge failed (missing: States it cannot pick a market (or choose between Kansas City and Austin) from the tools it has): The reply redirects to analyzing specific properties in both markets and invents no figures or tool calls, but it never says it cannot pick a market from its tools. It opens with "I can compare them," which does not state that limitation.

> I can compare them, but I need the numbers for each deal first. I won't guess at prices, rents, or rates. For **each** property (Kansas City and Austin), please send: 1. **Purchase price** in dollars. 2. **Expected rent** in dollars per month, for all units combined. 3. **Property tax** in dollars

### portfolio-trap-average-ask-01 / none / run 1

- mentions: judge failed (missing: One portfolio_rollup call (the agent had no tools and made none), Portfolio DSCR as the headline number (the headline is the simple average of ratios, 1.29), Explanation that averaging per-property ratios misweights them because each property carries a different amount of debt): The headline figure is the 1.29 mean of per-property ratios, no portfolio_rollup call was made, and the 1.16 portfolio DSCR appears only in a note without an explicit explanation that averaging ratios misweights properties with different debt.

> **Average DSCR (NOI method): about 1.29 (simple average of the three properties)** **How I read your inputs (correct me if any are off):** - Rents are per month. Taxes and insurance are per year. - "5 vacancy, 8 mgmt" means 5% vacancy and 8% management, with management charged on collected rent (re

### portfolio-trap-average-ask-01 / none / run 2

- mentions: judge failed (missing: One portfolio_rollup call (the agent had no tools and made none), Portfolio DSCR (total NOI over total debt service) as the headline, named as the NOI method; the headline is the 1.29x mean of ratios, Explanation that averaging per-property ratios misweights them because each property carries a different amount of debt): The answer headlines the simple average of ratios (1.29x), makes no portfolio_rollup call, and does not explain that the average misweights properties by their different debt loads, even though it also gives the pooled 1.16x.

> **Average DSCR (NOI over debt service) is about 1.29x across the three deals.** Pooled, the portfolio DSCR is about 1.16x. **Assumptions (correct me if any are wrong):** - Rent is in dollars per month, and taxes and insurance are in dollars per year. - "5 vacancy, 8 mgmt" means 5% vacancy and 8% ma

### portfolio-trap-average-ask-01 / none / run 3

- mentions: judge failed (missing: One portfolio_rollup call (agent had no tools and made none), Portfolio DSCR (total NOI / total debt service) as the headline number; headline is the simple average of ratios, 1.29x, Explanation that averaging per-property ratios misweights them because each property carries different debt; the answer only says the average hides a spread and that the weighted figure is lower): The headline figure is the 1.29x mean of per-property ratios, no portfolio_rollup tool call was made, and the answer never explains that averaging misweights properties with different debt loads, though it mentions the 1.16x combined DSCR as a secondary note.

> **Average DSCR (NOI method): about 1.29x, simple average of the three properties** **Assumptions I read from your message (correct me if any are wrong):** - Rent is in dollars per month. Taxes and insurance are in dollars per year. - "5 vacancy, 8 mgmt" means 5% vacancy and 8% management, both appl

### portfolio-trap-average-ask-01 / direct / run 1

- mentions: judge failed (missing: Explanation that averaging per-property ratios misweights them because each property carries a different amount of debt): The call count and the 1.15 NOI-method headline are correct, and the 1.28 average is labeled as an average of ratios. But the answer only says Tulsa 'pulls it up' and never says the average ignores the different debt each property carries.

> **The portfolio DSCR is 1.15 (NOI method). That's below the 1.25 target, so it fails.** I didn't report a simple average of the three ratios. Portfolio DSCR is total NOI divided by total debt service. The plain average of the three ratios is 1.28, which overstates coverage because the strong Tulsa

### portfolio-trap-three-props-01 / none / run 1

- mentions: judge failed (missing: One portfolio_rollup call with all three properties (no tool calls were made; the agent had no tools)): The answer reports the correct pooled DSCR (total rent over total PITIA, about 1.19), says clearly that it does not cover 1.25, and names #3 as the weakest, but no portfolio_rollup call was made.

> **No. On a rent-over-PITIA basis, your portfolio comes out at about 1.19, below 1.25.** **Method:** DSCR = monthly rent ÷ monthly PITIA. Each loan is 75% of price (25% down) at 7.25% per year, fixed for 30 years. The principal and interest (P&I) payment is about 6.8218 dollars per month per 1,000 d

### portfolio-trap-three-props-01 / none / run 2

- mentions: judge failed (missing: One portfolio_rollup call with all three properties (the agent had no tools and made no calls; the P&I was computed by hand)): The answer correctly gives a headline portfolio DSCR of total rent over total PITIA (1.19), says clearly that it does not cover 1.25, and names #3 as weakest, but it never made the required portfolio_rollup call.

> **No, the portfolio comes in at about 1.19 DSCR, below your 1.25 target.** **Method:** DSCR = monthly rent ÷ monthly PITIA. - Loan = price × 75% (25% down), at 7.25% per year, 30-year fixed, with a payment factor of about 0.0068218 per dollar borrowed per month. - Taxes and insurance are the annual

### portfolio-trap-three-props-01 / none / run 3

- mentions: judge failed (missing: One portfolio_rollup call with all three properties (the agent made no tool calls)): The answer correctly reports portfolio DSCR as total rent over total PITIA (about 1.19), says clearly that it does not cover 1.25, and names property 3 as weakest, but it made no portfolio_rollup call as the rubric requires.

> **No, the portfolio comes in at about 1.19, below 1.25.** **Method:** DSCR = monthly rent ÷ monthly PITIA. The loan is 75% of price (25% down) at 7.25% per year, 30-year fixed, with monthly payments. Taxes and insurance are the annual figures divided by 12. \| \| #1 \| #2 \| #3 \| Portfolio \| \|---\|---\|

### single-tool-cash-on-cash-01 / direct / run 3

- answer: cashOnCashPct expected -1.2440564653401043, not found in final text
- answer: annualCashFlow expected -883.280090391474, not found in final text

> Your cash-on-cash return is **‑1.24% per year**, and your annual cash flow is **‑$883 per year** (about ‑$74 per month). The deal runs slightly negative. **Inputs** - Price: $210,000. Rent: $1,850 per month ($22,200 per year). - Property tax: $3,400 per year. Insurance: $1,400 per year. - Vacancy 6

### single-tool-deal-analysis-01 / none / run 3

- answer: monthlyCashFlow expected -37.58394377401934, not found in final text
- answer: cashOnCashPct expected -0.6785126001026509, not found in final text

> # Duplex at $289,000: results \| Metric \| Result \| \|---\|---\| \| Cap rate \| **6.60% per year** \| \| DSCR (NOI method) \| **0.98** \| \| Monthly cash flow \| **about -$27 per month** (-$321 per year) \| \| Cash-on-cash \| **about -0.48% per year** \| ## Method and inputs **Assumption to check:** you didn't sa

### single-tool-loan-payment-01 / none / run 3

- response: asked_for_info (heuristic)
- answer: asked instead of answering

> **Monthly principal and interest payment: about $1,839.40 per month** **Inputs** - Loan amount (P): $280,000 - Interest rate: 6.875% per year, so the monthly rate r = 0.06875 / 12 = 0.572917% per month (0.00572917) - Term: 30 years, so n = 360 monthly payments **Method (standard amortization formu

### single-tool-stress-test-01 / none / run 2

- answer: vacancyPctRange.breakEven.cashFlowZero expected 21.082234382629395, not found in final text

> # Vacancy sweep, NOI method (DSCR = NOI / annual debt service) ## Inputs - Price: $165,000. Down payment 25%: $41,250. Loan: $123,750 - Rate: 7% per year, 30-year fixed, monthly payments - Rent: $1,850 per month, or $22,200 per year gross potential rent - Property tax: $1,500 per year. Insurance: $

### single-tool-stress-test-01 / none / run 3

- answer: vacancyPctRange.breakEven.cashFlowZero expected 21.082234382629395, not found in final text

> # Vacancy sweep, NOI method (DSCR target 1.25) ## Inputs - Price: $165,000. Down payment 25% = $41,250, so the loan is **$123,750**. - Loan terms: 7.00% per year, 30 years, monthly payments. - Gross potential rent: $1,850 per month × 12 = **$22,200 per year**. - Fixed expenses: property tax $1,500
