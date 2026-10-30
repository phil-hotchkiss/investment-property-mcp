# Working agreement

Phil is the engineer of record. Claude implements. The repo must show that split, not just claim it.

## Claude does

- Implement from `docs/PRD.md`, milestone by milestone, stopping for review after each.
- Work on a branch per PR. Small conventional commits. Each PR body has a "Choices" section with one line per non-obvious decision.
- Run lint, format, typecheck, test, and build locally before pushing. Watch CI until green.
- Write fixture workings in `docs/fixtures/` showing the arithmetic behind every asserted number.
- Never merge. Never force-push. Never edit the source project at `~/git/investment-properties`.
- Ask when a domain rule is ambiguous. Do not invent underwriting rules.
- No em dashes in prose, comments, or commit messages.
- When a change comes from Phil's review, say so in the PR body or commit message.

## Phil does

- Review each PR in conversation with Claude, then merge it. Review feedback that a future reader should find may go on the PR, but is not required.
- Verify fixture workings against a spreadsheet and commit the verification note under his own author line.
- Write or edit every ADR in `docs/decisions/` and the README in his own voice before they land.
- Own the eval results table. Numbers come from a real run, never typed by hand.

## Why

Reviewers of a public repo should be able to tell which judgment was human. Merges, fixture verification, ADRs, and the README carry Phil's name. PR bodies record which changes came from his review. Implementation carries a Claude co-author trailer.
