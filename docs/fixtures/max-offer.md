# maxOffer fixture workings

Each section matches a test in `packages/core/src/calculators/maxOffer.test.ts`. Numbers are shown
rounded; the code keeps full precision.

Input is the base property from `deal-analysis.md` without a price: rent 3200, flat tax 4800 and
insurance 1800 a year, 25% down, 7.25% for 30 years amortizing, vacancy 5, management 8,
maintenance 5, capex 5, closing 3% of price, rehab 10000, reserves 6 months of PITIA.

maxOffer runs dealAnalysis at each candidate price and bisects for the highest price where every
target passes. Bisection stops when the bracket is under 1 dollar; the answer is the passing end
of the bracket rounded down to a whole dollar. The binding constraint is whichever target fails at
maxPrice + 2.

## Shared arithmetic

Monthly payment factor at 7.25% for 30 years (see `loan-payment.md`):

```
r = 7.25 / 1200 = 0.0060416667
factor = r / (1 - (1 + r)^-360) = 0.0068217628
```

At any price P with 25% down:

```
loan  = 0.75 * P
P&I   = loan * 0.0068217628
PITIA = P&I + 400 tax + 150 insurance + 0 HOA = P&I + 550
NOI   = 22968 per year, 1914 per month (dscr.md fixture A; does not depend on price)
monthly cash flow = 1914 - P&I
cash invested = 0.25 * P + 0.03 * P + 10000 + 6 * PITIA
```

Default upper bound:

```
annual gross rent = 3200 * 12 = 38400
maxPriceBound     = 20 * 38400 = 768000
```

The search runs from 1 to 768000.

## Fixture A: minDscr 1.25, rentToPitia

At the 400000 ask DSCR is 3200 / 2596.53 = 1.2324 (dscr.md fixture A), below 1.25, so the max
offer must be lower.

Closed-form check of where the boundary should be:

```
PITIA needed = 3200 / 1.25 = 2560
P&I needed   = 2560 - 550 = 2010
loan         = 2010 / 0.0068217628 = 294645.13
price        = 294645.13 / 0.75 = 392860.17
```

The solver returns 392859, within the 1 dollar tolerance below that (the bracket ended between
392859.x and 392860.x, then rounded down).

At maxPrice 392859:

```
loan  = 0.75 * 392859 = 294644.25
P&I   = 294644.25 * 0.0068217628 = 2009.9932
PITIA = 2009.9932 + 550 = 2559.9932
DSCR  = 3200 / 2559.9932 = 1.250003    passes
monthly cash flow = 1914 - 2009.9932 = -95.99
```

At maxPrice + 2 = 392861:

```
loan  = 0.75 * 392861 = 294645.75
P&I   = 294645.75 * 0.0068217628 = 2010.0034
PITIA = 2560.0034
DSCR  = 3200 / 2560.0034 = 1.249998    fails
```

minDscr fails just above the max price, so `bindingConstraint` is `minDscr`.

Assumptions list the default bound (768000) and the scaling rules: financing (downPaymentPct) and
closing costs scale with price; property tax and insurance are flat, so they are held fixed.

## minCashOnCashPct 2, no dscrMethod

```
at 335779: loan 251834.25, P&I 1717.9535, PITIA 2267.9535
  annual cash flow = 22968 - 1717.9535 * 12 = 2352.5578
  cash invested = 0.28 * 335779 + 10000 + 6 * 2267.9535
                = 94018.12 + 10000 + 13607.72 = 117625.84
  CoC = 2352.5578 / 117625.84 * 100 = 2.0000    passes
at 335781: loan 251835.75, P&I 1717.9638, PITIA 2267.9638
  annual cash flow = 22968 - 1717.9638 * 12 = 2352.4350
  cash invested = 0.28 * 335781 + 10000 + 6 * 2267.9638 = 117626.46
  CoC = 2352.4350 / 117626.46 * 100 = 1.9999    fails
```

maxPrice 335779, binding `minCashOnCashPct`. With no dscrMethod, `metricsAtMaxPrice` has no DSCR
fields and the assumptions say "DSCR not computed: no dscrMethod was given."

## minMonthlyCashFlow 100

```
at 354551: loan 265913.25, P&I 1813.9971, cash flow = 1914 - 1813.9971 = 100.0029  passes
at 354553: loan 265914.75, P&I 1814.0073, cash flow = 1914 - 1814.0073 =  99.9927  fails
```

maxPrice 354551, binding `minMonthlyCashFlow`.

A separate test uses rent 2000 and minMonthlyCashFlow -1000 with no dscrMethod. At the max price
the rentToPitia DSCR (the method used internally) is below 1.0; that warning is dropped because no
method was asked for.

## All three targets

The lowest single-target max price wins: min(392859, 335779, 354551) = 335779. At 335781 only CoC
fails (DSCR 3200 / 2267.9638 = 1.4110, cash flow 196.04), so the binding constraint is
`minCashOnCashPct`. DSCR at 335779 is 3200 / 2267.9535 = 1.4110.

## Two targets binding together

minDscr 1.25 and minMonthlyCashFlow -96. At the DSCR boundary P&I is 2010, which is exactly where
cash flow is 1914 - 2010 = -96, so both targets cross at the same price (392860.17). At maxPrice + 2
both fail, so `bindingConstraint` is `minDscr, minMonthlyCashFlow`.

## Property tax as percent of price

Same as fixture A but `propertyTaxPctOfPrice: 1.2` instead of a flat 4800. At 400000 both give 4800
a year; below 400000 the percent form is cheaper, so the max price is higher.

```
at 394027: tax = 394027 * 1.2 / 100 / 12 = 394.027
  loan 295520.25, P&I 2015.9690
  PITIA = 2015.9690 + 394.027 + 150 = 2559.9960
  DSCR  = 3200 / 2559.9960 = 1.250002    passes
at 394029: tax = 394.029, loan 295521.75, P&I 2015.9793
  PITIA = 2560.0083, DSCR = 1.249996     fails
```

maxPrice 394027 vs 392859 with flat tax.

## Infeasible

Rent 500. At the lowest price, 1 dollar:

```
loan 0.75, P&I 0.0051, PITIA = 0.0051 + 550 = 550.0051
DSCR = 500 / 550.0051 = 0.9091 < 1.25
```

Fails at the lower bound, so `feasible` is false, `maxPrice` and `metricsAtMaxPrice` are null, and
`bindingConstraint` names the failing target, `minDscr`. Default bound here is 20 * 6000 = 120000.

## Upper bound hit

minDscr 1.0, maxPriceBound 300000:

```
at 300000: loan 225000, P&I 1534.8966, PITIA 2084.8966
DSCR = 3200 / 2084.8966 = 1.5348 >= 1.0
```

The target still passes at the bound, so `maxPrice` is 300000, `bindingConstraint` is null, and a
warning says to raise maxPriceBound. No default-bound assumption because a bound was given.

## Fixed loanAmount

`loanAmount: 280000`, `propertyTaxPctOfPrice: 1.2`, minDscr 1.25 rentToPitia. A price below the
loan is invalid, so the search starts at 280000 instead of 1. P&I is fixed:

```
P&I = 280000 * 0.0068217628 = 1910.0936
PITIA = 1910.0936 + price * 0.012 / 12 + 150
DSCR 1.25 needs PITIA 2560: tax = 2560 - 150 - 1910.0936 = 499.9064 per month
price = 499.9064 * 12 / 0.012 = 499906.4
at 499905: tax 499.905, PITIA 2559.9986, DSCR 1.2500007   passes
at 499907: tax 499.907, PITIA 2560.0006, DSCR 1.2499997   fails
```

maxPrice 499905. A warning says leverage changes with price and DSCR may not move one way.

With a flat tax and `loanAmount: 300000`, PITIA is 2596.53 at every price, DSCR is 1.2324 at every
price, so the target fails at the lowest price (300000): `feasible` false with a warning that
names the failing target and suggests downPaymentPct or ltvPct.

With `downPaymentAmount: 100000` the lowest price tried is 100001 (a 1 dollar loan; at exactly
100000 there is no loan). The assumptions list the fixed financing, tax, insurance, and closing
costs.

## Validation

- No targets: "Provide at least one of minDscr, minCashOnCashPct, minMonthlyCashFlow; none was given."
- minDscr without dscrMethod: names dscrMethod and the two methods.
- maxPriceBound below a fixed loanAmount, or a zero default bound (rent 0): error on maxPriceBound.
