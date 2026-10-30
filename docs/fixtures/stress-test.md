# stressTest fixture workings

Each section matches a test in `packages/core/src/calculators/stressTest.test.ts`. Numbers are
shown rounded; the code keeps full precision.

Input is the base property from `deal-analysis.md` (price 400000, rent 3200, flat tax 4800 and
insurance 1800 a year, 25% down, 7.25% for 30 years, vacancy 5, management 8, maintenance 5,
capex 5, closing 3%, rehab 10000, reserves 6 months of PITIA). dscrTarget is the default 1.25.

Each sweep changes one input, runs dealAnalysis, and holds everything else at the base case. Points
are `steps` evenly spaced values from min to max inclusive (default 5). Break-even values come from
bisection inside the range to within one millionth of its width; the value reported is the last one
on the same side of the threshold as `min`, so it sits just short of the exact crossing.

## Shared arithmetic

Loan 300000. Monthly P&I by rate (annuity formula, see `loan-payment.md`):

```
6%    1798.6516
6.5%  1896.2041
7%    1995.9075
7.25% 2046.5288
7.5%  2097.6435
8%    2201.2937
```

Monthly NOI at vacancy v (percent), from `dscr.md` fixture A:

```
NOI = 3200 - 3200 * v / 100 - 1126 operating expenses = 2074 - 32 v
```

The 1126 is tax 400 + insurance 150 + HOA 0 + management 256 + maintenance 160 + capex 160.

## Fixture A: vacancy 0 to 20, noi method

DSCR = NOI / 2046.5288. Cash flow = NOI - 2046.5288.

```
v    NOI    DSCR     cash flow
0    2074   1.0134     27.47
5    1914   0.9352   -132.53
10   1754   0.8571   -292.53
15   1594   0.7789   -452.53
20   1434   0.7007   -612.53
```

All below 1.25, so every `passes` is false.

- DSCR 1.25 would need NOI 1.25 * 2046.5288 = 2558.16, above the 2074 at 0% vacancy. Not crossed in
  the range: `dscrAtTarget` null with a warning.
- Cash flow 0: 2074 - 32 v = 2046.5288, v = 27.4712 / 32 = 0.8585. Bisection returns 0.85846, so
  the test checks 0.858.

`base` equals `dealAnalysis` on the same input; no grid because only one of the two grid ranges was
given.

## Fixture B: rentToPitia

### Interest rate 6 to 8

PITIA = P&I + 550. DSCR = 3200 / PITIA. Cash flow = 1914 - P&I (NOI at 5% vacancy).

```
rate  PITIA      DSCR     cash flow   passes
6     2348.6516  1.3625    115.35     true
6.5   2446.2041  1.3081     17.80     true
7     2545.9075  1.2569    -81.91     true
7.5   2647.6435  1.2086   -183.64     false
8     2751.2937  1.1631   -287.29     false
```

- DSCR 1.25 needs PITIA 3200 / 1.25 = 2560, so P&I 2010. The rate where 300000 over 30 years costs
  2010 a month is 7.0698%.
- Cash flow 0 needs P&I 1914, rate 6.5900%.

There is no closed form for the rate; the test checks P&I at both reported rates comes back to
2010 and 1914 within 0.05.

### Rent 3000 to 4000

DSCR = R / 2596.5288 (PITIA does not depend on rent). Monthly NOI = R - 23% of R - 550 = 0.77 R -
550, so cash flow = 0.77 R - 550 - 2046.5288 = 0.77 R - 2596.5288.

```
R     DSCR     cash flow
3000  1.1554   -286.53
3250  1.2517    -94.03
3500  1.3480     98.47
3750  1.4442    290.97
4000  1.5405    483.47
```

- DSCR 1.25: R = 1.25 * 2596.5288 = 3245.66
- Cash flow 0: R = 2596.5288 / 0.77 = 3372.12

### Operating expenses change -20 to 20

Multiplier m = 1 + change / 100 on tax, insurance, HOA, management, maintenance, capex, and
owner-paid utilities. rentToPitia only sees tax and insurance (550 a month). NOI sees all 1126.

```
PITIA     = 2046.5288 + 550 m
cash flow = 3200 - 160 vacancy - 1126 m - 2046.5288 = 993.4712 - 1126 m
```

```
change  m    PITIA      DSCR     cash flow
-20     0.8  2486.5288  1.2869     92.67
-10     0.9  2541.5288  1.2591    -19.93
0       1.0  2596.5288  1.2324   -132.53
10      1.1  2651.5288  1.2069   -245.13
20      1.2  2706.5288  1.1823   -357.73
```

- DSCR 1.25: 550 m = 2560 - 2046.5288 = 513.4712, m = 0.93358, change = -6.642
- Cash flow 0: m = 993.4712 / 1126 = 0.88230, change = -11.770

## Fixture C: grid, noi method

Rows vacancy 0, 5, 10 (NOI 2074, 1914, 1754). Columns rate 6, 7, 8 (P&I 1798.6516, 1995.9075,
2201.2937). DSCR = NOI / P&I, cash flow = NOI - P&I.

```
DSCR        6%       7%       8%
0%       1.1531   1.0391   0.9422
5%       1.0641   0.9590   0.8695
10%      0.9752   0.8788   0.7968

cash flow   6%       7%       8%
0%       275.35    78.09  -127.29
5%       115.35   -81.91  -287.29
10%      -44.65  -241.91  -447.29
```

The 5% row equals the single interest rate sweep at the base vacancy.

## Other cases

- rentToPitia with a vacancy sweep: DSCR is 1.2324 at every point because the method uses gross
  rent. The warning says so.
- Rent 2000 to 3000, rentToPitia: at 3000 DSCR is 1.1554 and cash flow -286.53, both still on the
  failing side, so both break-evens are null with warnings.
- Expense change -100, noi, with percent-of-price tax and insurance, HOA 100, utilities 50: every
  operating expense goes to 0, so cash flow = 3200 - 160 - 2046.5288 = 993.47.
