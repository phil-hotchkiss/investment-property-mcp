# dealAnalysis fixture workings

Each section matches a test in `packages/core/src/calculators/dealAnalysis.test.ts`. Numbers are
shown rounded; the code keeps full precision.

Input is the base property from `dscr.md` fixture A plus the `cash-on-cash.md` fixture A cash
fields (closing 3% of price, rehab 10000, reserves 6 months of PITIA). dealAnalysis composes
`cashOnCash` and `dscr`; it does no math of its own beyond the three lines below.

## Fixture A

```
annual gross rent = 3200 * 12 = 38400
annual NOI        = 22968                 (dscr.md fixture A)
cap rate          = 22968 / 400000 * 100 = 5.742 (percent)
GRM               = 400000 / 38400 = 10.4167
```

Cash side (from `cash-on-cash.md` fixture A):

```
monthly PITIA       = 2596.53
annual cash flow    = -1590.35
monthly cash flow   = -132.53
total cash invested = 137579.17
CoC                 = -1.1559 (percent)
loan amount 300000, LTV 75
```

DSCR, target 1.25 (from `dscr.md` fixture A):

```
rentToPitia: 3200 / 2596.53 = 1.2324 -> below 1.25, passes false
noi:         22968 / 24558.35 = 0.9352 -> below 1.25, passes false
```

With `dscrTarget 1.2`, rentToPitia 1.2324 >= 1.2, so passes true.

## Notes

- With `rentToPitia`, `dscr` alone says it ignores the expense percents. In dealAnalysis those
  percents drive NOI, cap rate, and cash flow, so that line is dropped from the merged assumptions.
- Warnings from both pieces are merged and de-duplicated (LTV above 80 appears once).
- Zero gross rent: GRM is null with a warning. Zero debt and zero cash invested: DSCR and CoC are
  null.
