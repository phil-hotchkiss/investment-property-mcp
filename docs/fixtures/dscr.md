# dscr fixture workings

Each section matches a test in `packages/core/src/calculators/dscr.test.ts`. Numbers are shown
rounded; the code keeps full precision.

The loan in every fixture is 300000 at 7.25% for 30 years. Its monthly principal and interest is
2046.53 (see `loan-payment.md` fixture A) and its interest-only payment is 1812.50.

## Fixture A: one property, both methods

Inputs:

```
price 400000
monthlyRent 3200 (no market rent, so rent basis is lease)
annualPropertyTax 4800, annualInsurance 1800, no HOA
financing: downPaymentPct 25
loan: interestRatePct 7.25, termYears 30, amortizing
vacancyPct 5, managementPct 8, maintenancePct 5, capexPct 5
```

Financing:

```
downPaymentAmount = 400000 * 25 / 100 = 100000
loanAmount = 400000 - 100000 = 300000
ltvPct = 300000 / 400000 * 100 = 75
```

Monthly costs:

```
tax       = 4800 / 12 = 400
insurance = 1800 / 12 = 150
HOA       = 0
P&I       = 2046.53
```

### Method rentToPitia

```
PITIA = 2046.53 + 400 + 150 + 0 = 2596.53
DSCR  = 3200 / 2596.53 = 1.2324
```

1.2324 < 1.25 target, so `passes` is false. Not below 1.0, so no warning. Vacancy and the
expense percents are not used by this method; the assumptions say so.

### Method noi

Management, maintenance, and capex percents apply to gross scheduled rent (3200), by convention.

```
vacancy      = 3200 * 5 / 100 = 160
management   = 3200 * 8 / 100 = 256
maintenance  = 3200 * 5 / 100 = 160
capex        = 3200 * 5 / 100 = 160
operating expenses = 400 + 150 + 0 + 256 + 160 + 160 + 0 utilities = 1126

monthly NOI = 3200 - 160 + 0 other income - 1126 = 1914
annual NOI  = 1914 * 12 = 22968

annual debt service = 2046.52884 * 12 = 24558.35
DSCR = 22968 / 24558.35 = 0.9352
```

0.9352 < 1.0, so the warning "DSCR is 0.94, below 1.0" fires. Same property, two methods:
1.2324 vs 0.9352.

## Fixture B: lesser rent basis, percent-of-price costs, HOA

Inputs:

```
price 400000
monthlyRent 3600, monthlyMarketRent 3500, rentBasis omitted
propertyTaxPctOfPrice 1.2, insurancePctOfPrice 0.45, monthlyHoa 100
financing: ltvPct 75
loan: 7.25%, 30 years, amortizing
method rentToPitia
```

```
rent used = lesser of 3600 and 3500 = 3500 (default when market rent is given)
loanAmount = 400000 * 75 / 100 = 300000
tax        = 400000 * 1.2 / 100 / 12 = 400
insurance  = 400000 * 0.45 / 100 / 12 = 150
PITIA = 2046.53 + 400 + 150 + 100 = 2696.53
DSCR  = 3500 / 2696.53 = 1.2980
```

1.2980 >= 1.25, so `passes` is true.

## Fixture C: interest-only, other income, owner-paid utilities, noi method

Inputs: fixture A, with `amortization interestOnly`, `monthlyOtherIncome 100`,
`monthlyOwnerPaidUtilities 150`, `method noi`, `target 1.0`.

```
operating expenses = 400 + 150 + 0 + 256 + 160 + 160 + 150 = 1276
monthly NOI = 3200 - 160 + 100 - 1276 = 1864
annual NOI  = 1864 * 12 = 22368

monthly debt service = 300000 * 0.0725 / 12 = 1812.50
annual debt service  = 1812.50 * 12 = 21750
DSCR = 22368 / 21750 = 1.0284
```

1.0284 >= 1.0 target, so `passes` is true.

## Warning cases (no arithmetic to check)

- `ltvPct 85` on fixture A: LTV 85 > 80, warning "LTV is 85.00%, above 80%."
- Price 100000, rent 1000, tax 0, insurance 0, loanAmount 0: PITIA and debt service are both 0,
  DSCR is null with a warning for each method.
