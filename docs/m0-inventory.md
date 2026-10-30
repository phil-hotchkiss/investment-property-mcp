# Milestone 0 inventory: source project `/Users/phil/git/investment-properties`

Source is Angular 19 + Ionic 8 + Capacitor 8, Karma/Jasmine. Paths below are relative to `src/app/`. Nothing in the source repo was modified.

**Test run (verbatim tail):** `npx ng test --watch=false --browsers=ChromeHeadless` gave
`Chrome Headless 156.0.0.0 (Mac OS 10.15.7): Executed 69 of 69 SUCCESS (0.099 secs / 0.083 secs)` and `TOTAL: 69 SUCCESS`.
69 is the whole suite (includes SEO, app and component specs). The five calculator specs hold 31 cases.

Headline: the five calculators are already pure functions in `services/*-calculator.ts` with no Angular imports. Components only parse form strings and call them; no math lives in components or templates (templates only apply pipes like `currency`, `percent`, `number`). All defaults (rates, LTV, rent) are seed values for the forms in the components, not baked into the math. There is no vacancy, management %, closing-cost %, or property-tax model anywhere.

## 1. Calculator inventory

Unit convention for every source calculator: rates and LTVs are **decimals** (0.0725 = 7.25%). Money is annual or monthly as the field name says; periods are mixed per field, not uniformly named.

| Name | File | Inputs (unit) | Outputs | Formula (one line) | Tests |
|---|---|---|---|---|---|
| DSCR | `services/dscr-calculator.ts` | `purchasePrice` $; `monthlyRent` $/mo; `annualTax` $/yr; `annualInsurance` $/yr; `annualHOA` $/yr; `ltcLtv` decimal; `interestRate` decimal annual; `loanTermYears`; `dscrMinimum` ratio | `loanAmount`, `principalAndInterest` ($/mo), `interestOnly` ($/mo), `piti`, `iti` ($/mo), `dscrPiti`, `dscrIti`, `isPitiValid`, `isItiValid` | `dscrPiti = monthlyRent / (P&I + (tax+ins+HOA)/12)`, P&I standard amortization, IO = `loan*rate/12` | `dscr-calculator.spec.ts`, 7 cases. Covers loan amount, P&I vs external calc (2046.53), IO, PITI sum, zero denominator, 0% rate. Gaps: pass/fail test is partly tautological (line 42 compares to its own formula), no `loanTermYears: 0`, no negative or 100% LTV, no assertion on DSCR value itself. |
| Cap Rate + Cash-on-Cash | `services/cap-rate-calculator.ts` | `purchasePrice`; `downPayment`; `annualRent` $/yr; `annualOperatingExpenses` $/yr (lumped); `interestRate` decimal; `loanTermYears`; `closingCosts` $ | `noi`, `capRate` (decimal), `loanAmount`, `monthlyDebtService`, `annualDebtService`, `annualCashFlow`, `totalCashInvested`, `cashOnCashReturn` (decimal) | `capRate = (rent - opex)/price`; `CoC = (NOI - 12*PMT)/(down + closing)` | `cap-rate-calculator.spec.ts`, 7 cases. Covers NOI, cap, loan, CoC, zero cash invested, all-cash, zero price. Gaps: no dollar-exact debt service or cash flow value, no 0% rate, no down payment > price. |
| Fix and Flip | `services/flip-calculator.ts` | `purchasePrice`; `ltcLtv` decimal; `rehabBudget`; `arv`; `interestRate` decimal | `initialLoan`, `totalLoan`, `ioPayment` ($/mo), `loanToArv`, `loanToCost` | `totalLoan = price*ltc + rehab`; `IO = totalLoan*rate/12` | `flip-calculator.spec.ts`, 6 cases. One edge (ARV 0). No zero-cost-basis case. |
| BRRRR | `services/brrrr-calculator.ts` | `purchasePrice`; `rehabBudget`; `arv`; `initialLoanAmount`; `initialRate` decimal; `holdMonths`; `refiLtv` decimal; `refiRate` decimal; `refiTermYears`; `monthlyRent` $/mo; `monthlyOperatingExpenses` $/mo (lumped, includes vacancy per comment) | `cashToCloseInitial`, `holdingInterestCost`, `totalCashInvested`, `newLoanAmount`, `cashReturnedAtRefi`, `cashLeftInDeal`, `refiMonthlyPI`, `monthlyCashFlow`, `cashOnCashReturn`, `isInfiniteReturn` | `CoC = 12*(rent - PMT(arv*refiLtv) - opex) / (cashIn - (newLoan - initialLoan))` | `brrrr-calculator.spec.ts`, 6 cases. Covers the infinite-return path. Gaps: negative cash flow with zero cash left, 0% rate, `refiTermYears: 0`. |
| MAO (70% rule) | `services/mao-calculator.ts` | `arv`; `rehabBudget`; `rulePercent` decimal; `closingCosts` $ | `maxAllowableOffer`, `totalProjectCost`, `potentialProfit`, `ruleCeiling`, `isUnviable` | `MAO = max(0, arv*rule - rehab - closing)` | `mao-calculator.spec.ts`, 5 cases. Covers 70%, closing costs, 75%, unviable, profit. Gap: `rawMao` exactly 0. |

Components feeding them (`calculator`, `cap-rate`, `flip-calculator`, `brrrr`, `mao`): each builds a string-valued reactive form, runs `parseNumeric()` for money and `Number()` for rates, calls the service, stores the result, calls `analytics.trackCalcCompleted`. No arithmetic beyond `Math.round`/`toFixed` for analytics payloads.

## 2. Mapping to the seven PRD calculators

| PRD calculator | Source(s) | Verdict | Justification |
|---|---|---|---|
| `loanPayment` | amortization in `dscr-calculator.ts:53-57`, `cap-rate-calculator.ts:33-39` (`amortizePI`), `brrrr-calculator.ts:40-46`; IO at `dscr-calculator.ts:59` | refactor | Same formula copied three times with slightly different guards. Consolidate into one function and add total interest, balance at year N, and IO as a first-class output, which none of them have. |
| `dscr` | `dscr-calculator.ts` | refactor | rent/PITIA math is correct and tested against an external calc, but the PRD needs an explicit method switch, a `noi` method (absent from source), pass/fail with warnings, and percent-number units. Keep the P&I test fixture. |
| `cashOnCash` | `cap-rate-calculator.ts:60-62` | refactor | Right shape (cash flow / (down + closing)) but it has no rehab or reserves term and is welded to cap rate. BRRRR's CoC (`brrrr-calculator.ts:76-77`) is a different, post-refi definition. |
| `dealAnalysis` | `cap-rate-calculator.ts` (NOI, cap rate, cash flow, CoC) plus `dscr-calculator.ts` | refactor | Cap-rate file is about 60% of the output set. Missing: GRM, vacancy, other income, itemized expenses, DSCR in the same result. Needs an NOI builder per PRD domain rules. |
| `maxOffer` | `mao-calculator.ts` | build new | The source is the flipper 70% closed form and shares nothing with the PRD's bisection on price against DSCR / CoC / cash-flow targets. Reuse only its zero-floor and "unviable" idea. |
| `stressTest` | none | build new | No sensitivity, grid, or break-even code exists anywhere. |
| `portfolioRollup` | none | build new | No multi-property logic exists. |

Source calculators with no PRD counterpart:

| Source | Recommendation | Reason |
|---|---|---|
| Fix and Flip (`flip-calculator.ts`) | drop | Lender loan-sizing view (LTC, loan-to-ARV), 3 lines of math, outside the seven. Nothing reusable. |
| BRRRR (`brrrr-calculator.ts`) | keep as stretch, not Milestone 1 | Only calculator with a refinance cash-out model. Has a bug (section 3) and a lumped-expense input. A later `brrrr` tool would reuse `loanPayment`. |
| MAO 70% rule | drop as-is | The PRD `maxOffer` is a different algorithm. A 70% rule could be a one-line mention in docs, not a tool. |

## 3. Formulas that look wrong or inconsistent

**DSCR method.** One method only, rent over payment, in `services/dscr-calculator.ts:64-65`:
```ts
const dscrPiti = piti > 0 ? monthlyRent / piti : 0;
const dscrIti = iti > 0 ? monthlyRent / iti : 0;
```
This is the rent/PITIA method (HOA is included at line 61, so it is PITIA even though named `piti`). There is no NOI/debt-service DSCR in any file, so it is not inconsistent across files, but the PRD's `noi` method has no source. The copy in `shared/tool-content.ts:52` states the rule explicitly: "DSCR uses gross monthly rent ... not subtracted before the DSCR calculation". Consistent with the code. Note `cap-rate-calculator.ts` computes NOI and debt service but never forms a ratio.

**Does NOI include debt service?** No. `cap-rate-calculator.ts:52` `const noi = annualRent - annualOperatingExpenses;` and debt service is subtracted afterward at line 58 `const annualCashFlow = noi - annualDebtService;`. Correct. Caveat: whether the caller's `annualOperatingExpenses` includes taxes and insurance is left to the user; there is no check.

**Vacancy before expenses.** Not implemented anywhere. No vacancy field exists in any calculator; `cap-rate` takes `annualRent` as given, `dscr` uses gross rent, BRRRR hides vacancy inside `monthlyOperatingExpenses` (comment `brrrr-calculator.ts:22`), which treats vacancy as a fixed dollar expense rather than a percent of gross rent. Nothing is wrong, but the PRD NOI definition is not met.

**MAO.** Closed form, no numerical solve, `mao-calculator.ts:28-30`:
```ts
const ruleCeiling = arv * rulePercent;
const rawMao = ruleCeiling - rehabBudget - closingCosts;
const maxAllowableOffer = Math.max(0, rawMao);
```
Arithmetic is correct for what it is. Closing costs are a flat dollar input, so nothing scales with price. Minor: when unviable, `potentialProfit` (line 32) is computed with offer 0, which reads as a profit on a purchase that should not happen. `isUnviable: rawMao <= 0` (line 39) also flags exactly-zero as unviable, fine.

**Percent handling.** Core math uses decimals consistently (OK), but the UI conversion layer is ambiguous:
- `shared/mask.directive.ts:86` `const asPercent = num <= 1 ? num * 100 : num;` treats a stored 1 as 100% and anything above as already a percent. A stored `1` (1%) and `0.01` (1%) cannot both be right.
- `shared/formatters.ts:37` `const asDecimal = num > 1 ? num / 100 : num;` same heuristic, so typing "1" shows 100.00%. (Whether `formatPercentInput` is still used was not checked; the mask directive is what templates use.)
- `mask.directive.ts:117` `return String(num / 100);` is a clean, unambiguous input path.
- Form validators cap rates at `Validators.max(1)` (e.g. `calculator.component.ts:52`), so a mistyped 7.25 as a decimal is rejected, but 0.5 (meaning 0.5%) in an unmasked path would pass. The PRD wants percent numbers (7.1), the opposite of the source convention, so every rate field flips.

**Rounding before computation.** None. No `Math.round` or `toFixed` precedes any calculation; rounding appears only in analytics payloads (`calculator.component.ts:88-89`) and templates via pipes. The one precision hazard is `parseNumeric` (`formatters.ts:10-13`), which strips every non-digit/dot character, so a negative number becomes positive and "1e5" becomes 15.

**Other defects found while checking:**
- `services/brrrr-calculator.ts:75-77`: when `cashLeftInDeal <= 0` and `monthlyCashFlow <= 0`, `cashOnCashReturn` is still `Infinity` (line 77) but `isInfiniteReturn` is false (line 75). A deal with no cash left and negative cash flow reports an infinite return.
- `services/brrrr-calculator.ts:63-69`: `cashToCloseInitial` is clamped at 0 (line 63) but `cashReturnedAtRefi` (line 69) is not adjusted when the initial loan exceeds price + rehab, so the over-borrowed cash is neither counted as returned nor as cash out.
- `services/brrrr-calculator.ts:65`: hold interest treats the loan as fully drawn at day one and ignores points and refi closing costs. Simplification, not a math error, but it overstates cash recycled.
- `services/dscr-calculator.ts:53-57`: no guard for `loanTermYears: 0` (0/0 NaN at 0% rate, Infinity otherwise), unlike `amortizePI` in the other files (`cap-rate-calculator.ts:34`). The form validator blocks it (`min(1)`), the function does not.
- The amortization formula is duplicated three times (`dscr-calculator.ts:53`, `cap-rate-calculator.ts:33`, `brrrr-calculator.ts:40`) with inconsistent edge guards.
- `dscr-calculator.ts:64`: returns 0 when PITI is 0 instead of Infinity or undefined, so `isPitiValid` is false for a debt-free property (asserted as intended by the spec at `dscr-calculator.spec.ts:49-60`).
- `dscr-calculator.ts:56`: DSCR loan amount is `price * LTV`; cap-rate derives loan as `price - downPayment` (`cap-rate-calculator.ts:55`). Different borrowing models in different files, not wrong, but not shared.

## 4. Angular / Ionic / Capacitor tangles in the math

The five calculator files themselves are clean: no `@Injectable`, no signals, no RxJS, no DOM, no formatters import. Header comment `dscr-calculator.ts:1` already says "No DI, no state". Nothing to strip from the math. The entanglement is in the layers around it, none of which should be copied:

- `shared/formatters.ts:15-24, 31-39`: `formatCurrencyInput` / `formatPercentInput` take a DOM `Event` and mutate `HTMLInputElement`. `parseNumeric` / `stripNumeric` (lines 6-13) are pure but lossy (strip sign). `formatCurrency` / `formatPercent` (41-47) use `toLocaleString`. Display only, drop from core.
- `shared/mask.directive.ts:1-2, 19-31`: Angular `Directive`, `ElementRef`, `NgControl`. Contains the decimal/percent conversion rules that core must replace with zod validation.
- Each component (`calculator.component.ts:1-11, 39-41` etc.): `@Component`, `inject(AnalyticsService)`, `FormBuilder`, `IonButton`. Controllers only, no math.
- `services/analytics.service.ts` and `services/native.service.ts:2-5, 49` (`Capacitor`, `Haptics`, `SplashScreen`, `StatusBar`): imported by components, not by calculators. Drop.
- `shared/tool-info.component.ts:1` (signals, OnPush) and `shared/tool-content.ts`: UI copy; the explanatory text is a useful reference for tool descriptions but contains lender claims (section 5).

## 5. Lender-specific / LoanBidz content near the math

Not inside any calculator function. All of it sits in adjacent files and must not carry over:
- `config.ts:4-17`: `PARTNER` (name LoanBidz, legal name, NMLS 1647914, phone, email, URLs, logo).
- `config.ts:31-67`: `TOOLS` registry with a `loanProduct` field (`dscr`, `fix-and-flip`, `brrrr`) per tool.
- `config.ts:70-78`: `buildCtaUrl` lead-form URL with UTM params to `investmentpropertyloanexchange.com/financing`.
- `shared/financing-cta/financing-cta.component.ts:4, 13-22`: "Submit a Deal for Review", phone link.
- `shared/tool-info.component.ts:178-180`: JSON-LD provider `LoanBidz`.
- `services/seo.service.ts:12, 18`; `src/index.html:5, 16, 19`; `capacitor.config.ts:4-5` (appId `com.loanbidz.investortoolkit`); `services/native.service.ts:25` (comment about LoanBidz navy).
- `shared/formatters.ts:2` header comment ("original LoanBidz behavior").
- Hardcoded rate and underwriting assumptions in prose only, `shared/tool-content.ts`: DSCR minimum 1.20 or 1.25 (lines 30, 37), credit 660+ (60), flip LTC 85-90% and rates 9-13% (76, 94-95), loan-to-ARV 70-75% (71), terms 6-18 months (99), BRRRR 70-75% refi LTV and 15-25% CoC (116, 136). These are marketing copy, not math.
- Form seed defaults in components (not in the math): DSCR 400000 price, 3000 rent, 75% LTV, 7.25% rate, 1.25 minimum (`calculator.component.ts:46-54`); cap-rate 7.5% (`cap-rate.component.ts:35`); flip 90% LTC, 11% (`flip-calculator.component.ts:35-39`); BRRRR 11% / 7.75% (`brrrr.component.ts:31-35`). Useful only as candidate worked-example fixtures, not as library defaults.

## 6. Open questions for Phil

PRD open questions:
1. **DSCR rent input.** Source uses gross scheduled rent with no vacancy haircut, and says so in user-facing copy. For `rentToPitia`, do you want gross rent only (matches source and common DSCR-loan practice), or an optional lender-style haircut? For `noi` method, vacancy would be applied to gross before expenses per the PRD.
2. **Property tax model.** Source takes `annualTax` as a flat dollar input and never scales it with price. The PRD wants `maxOffer` to solve numerically because taxes scale with price. Choose: tax as `taxRatePct` of price, flat dollars, or either with a reassessed-at-purchase flag. Same for insurance and closing costs (source: flat dollar `closingCosts`).

New:
3. **Naming.** Source calls `P&I + tax + insurance + HOA` "PITI" and ignores HOA in the name. PRD says PITIA. Confirm the output field name.
4. **Interest-only DSCR.** Source outputs a second DSCR on interest-only payment (`dscrIti`). PRD `dscr` lists only PITIA vs NOI. Keep an `interestOnly` flag on `loanPayment` and `dscr`, or drop it?
5. **Cash-on-cash scope.** Source CoC = down + closing only. PRD adds rehab and caller-chosen reserves. Confirm input shape (one `reservesDollars` or itemized).
6. **Loan sizing.** Source has two models: `price * LTV` (DSCR) and `price - downPayment` (cap rate). PRD should pick one input (`ltvPct` vs `downPaymentPct`) or accept either with a conflict error.
7. **Fixtures.** Only one number in the source was checked against an external calculator (P&I 2046.53 on 300k, 7.25%, 30y). The other specs assert the code against itself. Do you want the existing fixtures carried over as a starting point, or built fresh from your spreadsheet?
8. **Flip, BRRRR, 70% rule.** Confirm drop, stretch, drop (section 2).
9. **Source BRRRR bug** (infinite CoC with negative cash flow): ignore, since BRRRR is not in scope, or record as a known issue?
