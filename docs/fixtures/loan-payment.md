# loanPayment fixture workings

Each section matches a test in `packages/core/src/calculators/loanPayment.test.ts`. Numbers are
shown rounded; the code keeps full precision and rounds only in the test assertion.

Notation: `L` = loan amount, `r` = monthly rate = interestRatePct / 100 / 12, `n` = termYears * 12.

Spreadsheet equivalents: `=PMT(r, n, -L)` for the payment, `=FV(r, m, PMT, -L)` for the balance
after `m` months (sign flipped).

## Fixture A: 300000 at 7.25% for 30 years (externally verified)

Inputs: `loanAmount 300000, interestRatePct 7.25, termYears 30` (amortizing by default).

```
r = 7.25 / 100 / 12 = 0.00604166667
n = 30 * 12 = 360
(1 + r)^n = 1.00604166667^360 = 8.74477196

monthlyPrincipalAndInterest = L * r * (1 + r)^n / ((1 + r)^n - 1)
                            = 300000 * 0.00604166667 * 8.74477196 / 7.74477196
                            = 2046.53

monthlyInterestOnly = L * r = 300000 * 0.00604166667 = 1812.50
monthlyPayment      = monthlyPrincipalAndInterest (amortizing) = 2046.53

totalInterest = payment * n - L
              = 2046.52884 * 360 - 300000
              = 736750.38 - 300000
              = 436750.38
```

Expected: payment 2046.53, total interest 436750.38. 2046.53 matches common online mortgage
calculators for this loan.

## Fixture B: balance after 5 years on fixture A's loan

Inputs: fixture A plus `balanceAtYear 5`, so `m = 60` months.

```
(1 + r)^60 = 1.00604166667^60 = 1.43535089

balance = L * (1 + r)^m - payment * ((1 + r)^m - 1) / r
        = 300000 * 1.43535089 - 2046.52884 * 0.43535089 / 0.00604166667
        = 430605.27 - 147468.93
        = 283136.33
```

Expected: 283136.33. Also tested: year 0 gives 300000 and year 30 gives 0.

## Fixture C: 0% rate is straight-line

Inputs: `loanAmount 120000, interestRatePct 0, termYears 10, balanceAtYear 4`.

The payment formula divides by zero at r = 0, so principal is paid in equal parts.

```
n = 10 * 12 = 120
monthlyPrincipalAndInterest = L / n = 120000 / 120 = 1000
monthlyInterestOnly = 0
totalInterest = 0
balance after 4 years = 120000 - 1000 * 48 = 72000
```

## Fixture D: interest-only

Inputs: `loanAmount 300000, interestRatePct 7.25, termYears 30, amortization interestOnly,
balanceAtYear 10`.

Interest-only covers the whole term; the full balance is due at the end.

```
monthlyPayment = L * r = 300000 * 0.00604166667 = 1812.50
totalInterest  = 1812.50 * 360 = 652500
balance after 10 years = 300000 (no principal paid)
```
