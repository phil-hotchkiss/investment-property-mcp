# portfolioRollup fixture workings

Each section matches a test in `packages/core/src/calculators/portfolioRollup.test.ts`. Numbers
are shown rounded; the code keeps full precision.

Three properties, all 25% down at 7.25% for 30 years, vacancy 5, management 8, maintenance 5,
capex 5, no HOA:

```
name    price   rent  annual tax  annual insurance
Base    400000  3200  4800        1800
Strong  250000  2900  3000        1200
Weak    500000  2800  6000        2400
```

Payment factor 0.0068217628 per dollar of loan per month (see `max-offer.md`).

## Per property

```
           loan     P&I        tax  ins  PITIA
Base      300000   2046.5288   400  150  2596.5288
Strong    187500   1279.0805   250  100  1629.0805
Weak      375000   2558.1611   500  200  3258.1611
```

## Fixture A: rentToPitia

Per-property DSCR = rent / PITIA:

```
Base    3200 / 2596.5288 = 1.2324   fails 1.25
Strong  2900 / 1629.0805 = 1.7801   passes
Weak    2800 / 3258.1611 = 0.8594   fails, below 1.0
```

Portfolio DSCR, total income over total debt:

```
total rent  = 3200 + 2900 + 2800 = 8900
total PITIA = 2596.5288 + 1629.0805 + 3258.1611 = 7483.7704
portfolio   = 8900 / 7483.7704 = 1.1892
```

Average of ratios, for comparison only:

```
(1.2324 + 1.7801 + 0.8594) / 3 = 3.8719 / 3 = 1.2906
```

The average clears 1.25 and the portfolio does not. Averaging lets the cheap Strong property count
as much as the expensive Weak one, though Weak carries twice the debt. `passes` is false; weakest is
Weak. Warning: "Below 1.0 DSCR: Weak (0.86)." The portfolio itself is above 1.0, so no portfolio
warning.

## Fixture B: noi

Monthly NOI = rent - 5% vacancy - (tax + insurance + 18% of rent for management, maintenance, and
capex):

```
Base    3200 - 160 - (400 + 150 + 576) = 1914   annual 22968
Strong  2900 - 145 - (250 + 100 + 522) = 1883   annual 22596
Weak    2800 - 140 - (500 + 200 + 504) = 1456   annual 17472
```

Annual debt service = P&I * 12:

```
Base    2046.5288 * 12 = 24558.35
Strong  1279.0805 * 12 = 15348.97
Weak    2558.1611 * 12 = 30697.93
```

Per-property DSCR:

```
Base    22968 / 24558.35 = 0.9352
Strong  22596 / 15348.97 = 1.4722
Weak    17472 / 30697.93 = 0.5692
```

Portfolio and average:

```
total NOI          = 22968 + 22596 + 17472 = 63036
total debt service = 24558.35 + 15348.97 + 30697.93 = 70605.24
portfolio          = 63036 / 70605.24 = 0.8928
average of ratios  = (0.9352 + 1.4722 + 0.5692) / 3 = 2.9766 / 3 = 0.9922
```

Warnings: portfolio 0.89 below 1.0, and "Below 1.0 DSCR: Base (0.94), Weak (0.57)."

## Null DSCR

A property with `loanAmount: 0` has no debt service, so under noi its DSCR is null. It is named in
a warning, left out of the average and the weakest pick, and its NOI still counts in the total
(there is no debt to add). With only that property, total debt service is 0, so portfolio DSCR,
weakest, and the average are all null and `passes` is false.

Unnamed properties default to "Property 1", "Property 2", and so on.
