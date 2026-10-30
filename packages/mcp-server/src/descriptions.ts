/**
 * Tool descriptions, written for a model. Each covers, in order: what the tool computes, when to
 * use it, when to use a different tool, unit conventions, and one example call. The example is
 * the JSON after "Example call: " and is checked against core in the tests.
 */

const units =
  'Units: money is US dollars as plain numbers. Percent fields are percent numbers, so 7.25 means 7.25%, never 0.0725. Every field name states its period: monthlyRent and monthlyHoa are per month, annualPropertyTax and annualInsurance are per year.';

const dealFields =
  'Property tax takes exactly one of annualPropertyTax or propertyTaxPctOfPrice; insurance takes exactly one of annualInsurance or insurancePctOfPrice. financing takes exactly one of downPaymentPct, ltvPct, downPaymentAmount, or loanAmount.';

const dscrMethods =
  'rentToPitia is gross monthly rent divided by PITIA, the common DSCR-loan qualification method; noi is annual NOI divided by annual debt service, the traditional commercial method.';

export const descriptions = {
  loan_payment: `Computes the monthly payment on a loan, amortizing or interest-only, with total interest over the term and optionally the remaining balance after a given year.

Use it when the user asks only about a loan: the payment, the interest cost, or the balance left after N years.

Use a different tool when the question involves the property: dscr for debt coverage, cash_on_cash for return on cash, deal_analysis for the full picture. Those tools compute the payment themselves, so do not call loan_payment first to feed them.

${units} interestRatePct is the annual rate; termYears is whole years; the payment returned is per month.

Example call: {"loanAmount": 300000, "interestRatePct": 7.25, "termYears": 30}`,

  dscr: `Computes the debt service coverage ratio (DSCR) of one rental property and whether it meets a target ratio.

Use it when the user asks whether one property covers its debt or would qualify for a DSCR loan.

method is required and has no default. ${dscrMethods} If the user has not said which method applies, ask them, or pick one and state that assumption explicitly in your answer. Never present a DSCR without naming its method. To report the other method, call dscr again with that method. The two are not derivable from each other: taxes and insurance reduce the numerator under noi but increase the denominator under rentToPitia.

Use a different tool when there is more than one property: call portfolio_rollup once with all of them. Never call dscr per property and average the ratios; portfolio DSCR is total income over total debt service. Use deal_analysis when the user also wants cap rate, cash flow, or cash-on-cash.

${units} target is a ratio such as 1.25, not a percent. ${dealFields} When monthlyMarketRent is given and rentBasis is not, the lesser of lease and market rent is used.

Example call: {"price": 400000, "monthlyRent": 3200, "annualPropertyTax": 4800, "annualInsurance": 1800, "financing": {"downPaymentPct": 25}, "loan": {"interestRatePct": 7.25, "termYears": 30}, "method": "rentToPitia"}`,

  cash_on_cash: `Computes the annual cash-on-cash return of one rental property: annual pre-tax cash flow divided by total cash invested (down payment, closing costs, rehab, and reserves).

Use it when the user asks what return their cash earns, or what the annual or monthly cash flow is.

Use a different tool when the user also wants DSCR, cap rate, or GRM: deal_analysis returns all of those plus cash-on-cash in one call. Use max_offer to find the price that hits a cash-on-cash target.

${units} Vacancy, management, maintenance, and capex percents apply to gross scheduled rent. ${dealFields} Closing costs take closingCosts (dollars) or closingCostsPctOfPrice; reserves take reservesAmount (dollars) or reservesMonthsOfPitia; each is optional and defaults to 0.

Example call: {"price": 400000, "monthlyRent": 3200, "annualPropertyTax": 4800, "annualInsurance": 1800, "vacancyPct": 5, "managementPct": 8, "maintenancePct": 5, "capexPct": 5, "financing": {"downPaymentPct": 25}, "loan": {"interestRatePct": 7.25, "termYears": 30}, "closingCostsPctOfPrice": 3}`,

  deal_analysis: `Computes the full picture of one rental deal in one call: NOI, cap rate, GRM, DSCR, cash-on-cash, monthly and annual cash flow, PITIA, and cash invested.

Use it when the user asks whether a deal is good, or wants several metrics for one property at a known price. It is the default tool for a single deal.

Use a narrower tool when the user asks for one number only: dscr for coverage alone, cash_on_cash for return alone, loan_payment for the payment alone. Use max_offer when the price is the unknown, stress_test to see what breaks the deal, and portfolio_rollup for several properties.

dscrMethod is required with no default. ${dscrMethods} If the user has not said which method applies, ask them or state the assumption explicitly in your answer.

${units} dscrTarget is a ratio such as 1.25, not a percent. ${dealFields}

Example call: {"price": 400000, "monthlyRent": 3200, "annualPropertyTax": 4800, "annualInsurance": 1800, "vacancyPct": 5, "managementPct": 8, "financing": {"downPaymentPct": 25}, "loan": {"interestRatePct": 7.25, "termYears": 30}, "dscrMethod": "noi"}`,

  max_offer: `Finds the highest purchase price that still meets every target the user gives (minimum DSCR, minimum cash-on-cash, minimum monthly cash flow) and names the binding constraint.

Use it when the user asks how much they can pay, what to offer, or the most a property is worth to them given a target.

Use a different tool when the price is already known: deal_analysis for the metrics at that price, stress_test for what breaks the deal at that price.

It solves for price numerically (bisection), because some inputs scale with price. These scale with price: financing given as downPaymentPct or ltvPct, propertyTaxPctOfPrice, insurancePctOfPrice, closingCostsPctOfPrice, and reserves given in months of PITIA. Flat dollar amounts (annualPropertyTax, annualInsurance, closingCosts, downPaymentAmount, loanAmount) stay fixed at every price. Rent and the expense percents of rent do not depend on price. Prefer the percent-of-price forms when the user states taxes or insurance as a rate.

dscrMethod is required when targets.minDscr is set, with no default. ${dscrMethods} If the user has not said which applies, ask them or state the assumption explicitly.

${units} targets.minDscr is a ratio such as 1.25; targets.minCashOnCashPct is a percent number per year; targets.minMonthlyCashFlow is dollars per month. Do not pass price. maxPriceBound caps the search and defaults to 20 times annual gross rent.

Example call: {"monthlyRent": 3200, "propertyTaxPctOfPrice": 1.2, "annualInsurance": 1800, "vacancyPct": 5, "financing": {"downPaymentPct": 25}, "loan": {"interestRatePct": 7.25, "termYears": 30}, "targets": {"minDscr": 1.25}, "dscrMethod": "rentToPitia"}`,

  stress_test: `Re-runs a deal analysis while varying vacancy, interest rate, rent, or operating expenses across ranges, and reports DSCR and monthly cash flow at each point plus the break-even value where each crosses its threshold.

Use it when the user asks what breaks the deal, how sensitive it is, how high rates can go, or how much vacancy it can absorb.

Use deal_analysis for the base case alone, and max_offer when the question is about price.

Each range is {min, max, steps}: steps evenly spaced values from min to max inclusive (2 to 25, default 5). Give at least one of vacancyPctRange, interestRatePctRange, monthlyRentRange, or operatingExpensesChangePctRange. Each range is swept on its own with everything else held at the base case. Break-evens are dscrAtTarget (where DSCR crosses dscrTarget) and cashFlowZero (where monthly cash flow crosses 0), null when not crossed inside the range. A two-way grid of vacancy by interest rate appears only when both vacancyPctRange and interestRatePctRange are given. With dscrMethod rentToPitia, vacancy does not move DSCR because that method uses gross rent.

dscrMethod is required with no default. ${dscrMethods}

${units} vacancyPctRange and interestRatePctRange use percent numbers; monthlyRentRange is dollars per month; operatingExpensesChangePctRange is a percent change, -20 means 20% lower. ${dealFields}

Example call: {"price": 400000, "monthlyRent": 3200, "annualPropertyTax": 4800, "annualInsurance": 1800, "vacancyPct": 5, "financing": {"downPaymentPct": 25}, "loan": {"interestRatePct": 7.25, "termYears": 30}, "dscrMethod": "noi", "vacancyPctRange": {"min": 0, "max": 20}, "interestRatePctRange": {"min": 6, "max": 9}}`,

  portfolio_rollup: `Computes the DSCR of a whole portfolio of rental properties, the DSCR of each property, and the weakest property.

Use it whenever the user asks about debt coverage across two or more properties, including after analyzing each deal separately.

Use dscr for a single property.

Portfolio DSCR is total income divided by total debt service across all properties. It is never the average of the per-property ratios. The output field averageOfRatios exists only for comparison; do not report it as the portfolio DSCR.

method is required with no default and applies to every property. ${dscrMethods} If the user has not said which applies, ask them or state the assumption explicitly.

${units} target is a ratio such as 1.25. Each entry in properties takes the same fields as the dscr tool minus method and target, plus an optional name. ${dealFields}

Example call: {"method": "noi", "properties": [{"name": "Duplex", "price": 300000, "monthlyRent": 2600, "annualPropertyTax": 3600, "annualInsurance": 1500, "financing": {"ltvPct": 75}, "loan": {"interestRatePct": 7, "termYears": 30}}, {"name": "Condo", "price": 250000, "monthlyRent": 1900, "annualPropertyTax": 3000, "annualInsurance": 900, "monthlyHoa": 250, "financing": {"ltvPct": 80}, "loan": {"interestRatePct": 7.5, "termYears": 30}}]}`,
};

export type ToolName = keyof typeof descriptions;
