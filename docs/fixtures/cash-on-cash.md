# cashOnCash fixture workings

Each section matches a test in `packages/core/src/calculators/cashOnCash.test.ts`. Numbers are
shown rounded; the code keeps full precision.

Base property, same as `dscr.md` fixture A: price 400000, rent 3200, tax 4800 per year, insurance
1800 per year, no HOA, 25% down, loan 300000 at 7.25% for 30 years (amortizing), vacancy 5%,
management 8%, maintenance 5%, capex 5%.

Shared numbers (see `dscr.md` fixture A):

```
P&I                 = 2046.5288
PITIA               = 2046.5288 + 400 + 150 + 0 = 2596.5288
annual debt service = 2046.5288 * 12 = 24558.35
annual NOI          = 22968
```

## Fixture A: closing 3% of price, rehab 10000, reserves 6 months of PITIA

```
down payment = 400000 * 25 / 100 = 100000
closing      = 400000 * 3 / 100  = 12000
rehab        = 10000
reserves     = 6 * 2596.5288 = 15579.17
total cash invested = 100000 + 12000 + 10000 + 15579.17 = 137579.17

annual cash flow  = 22968 - 24558.35 = -1590.35
monthly cash flow = -1590.35 / 12 = -132.53
CoC = -1590.35 / 137579.17 * 100 = -1.1559 (percent)
```

Cash flow is negative, so the warning "Annual cash flow is negative (-1590.35 dollars)." fires.
LTV is 75, so no LTV warning.

## Fixture B: positive cash flow, flat closing and reserves

Base property with rent 4000, `closingCosts 9000`, `reservesAmount 5000`, no rehab.

```
vacancy      = 4000 * 5 / 100 = 200
management   = 4000 * 8 / 100 = 320
maintenance  = 4000 * 5 / 100 = 200
capex        = 4000 * 5 / 100 = 200
operating expenses = 400 + 150 + 0 + 320 + 200 + 200 + 0 = 1270
monthly NOI = 4000 - 200 + 0 - 1270 = 2530
annual NOI  = 2530 * 12 = 30360

annual cash flow = 30360 - 24558.35 = 5801.65
total cash invested = 100000 + 9000 + 0 + 5000 = 114000
CoC = 5801.65 / 114000 * 100 = 5.0892 (percent)
```

## Either-or pairs

- Both `closingCosts` and `closingCostsPctOfPrice`: validation error. Same for `reservesAmount`
  and `reservesMonthsOfPitia`.
- Neither: closing costs and reserves are 0 and the assumptions say "Closing costs assumed 0." and
  "Reserves assumed 0." Total cash invested is then the down payment, 100000.

## Edge: zero cash invested

`financing: { ltvPct: 100 }` with no closing, rehab, or reserves: down payment 0, total 0, so
`cashOnCashPct` is null. Warnings: "Total cash invested is 0, so cash-on-cash is undefined." and
"LTV is 100.00%, above 80%."
