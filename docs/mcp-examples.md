# MCP server: client config and example prompts

The server speaks MCP over stdio and exposes seven tools: `loan_payment`, `dscr`, `cash_on_cash`, `deal_analysis`, `max_offer`, `stress_test`, `portfolio_rollup`.

## Run from a checkout

Build once from the repo root:

```sh
pnpm install
pnpm build
```

The server entry point is `packages/mcp-server/dist/bin.js`. Use an absolute path in client config; the examples below assume the checkout lives at `/path/to/investment-property-mcp`.

### Claude Desktop

Add this to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "rental-deal-math": {
      "command": "node",
      "args": ["/path/to/investment-property-mcp/packages/mcp-server/dist/bin.js"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add rental-deal-math -- node /path/to/investment-property-mcp/packages/mcp-server/dist/bin.js
```

## Run with npx (not yet published)

The package `@rental-deal-math/mcp-server` is not on npm yet, so these do not work today. Once it is published:

```json
{
  "mcpServers": {
    "rental-deal-math": {
      "command": "npx",
      "args": ["-y", "@rental-deal-math/mcp-server"]
    }
  }
}
```

```sh
claude mcp add rental-deal-math -- npx -y @rental-deal-math/mcp-server
```

## Check it with the MCP Inspector

```sh
npx @modelcontextprotocol/inspector --cli node packages/mcp-server/dist/bin.js --method tools/list
```

## Example prompts

Each comes from an eval category in `docs/PRD.md`.

1. Chaining (max offer, then stress test):
   "Fourplex in KC, asking 520k, rents about 1,150 a door. Taxes 6,800 a year, insurance 3,200. 25% down at 7.25%, 30 years. What's the most I can offer and still hit 1.25 DSCR? Then tell me how high rates can go before it breaks."
   Expect `max_offer`, then `stress_test` at the max price. The answer should name the DSCR method, or ask which one applies.

2. Method ambiguity:
   "Duplex, 380k, 25% down at 7 and a quarter for 30 years, rents 3,100 a month total, taxes 4,200 a year, insurance 1,600 a year. What's the DSCR?"
   Expect the model to ask whether the lender uses rent to PITIA or NOI to debt service, or to state the method it assumed. It should pass `interestRatePct: 7.25`, not 0.0725.

3. Portfolio trap:
   "I own three rentals: a duplex at 1.35 DSCR, a condo at 0.95, and a single family at 1.20. What's my portfolio DSCR?"
   Expect `portfolio_rollup` with each property's inputs, or a request for those inputs. The model must not average the three ratios; portfolio DSCR is total income divided by total debt service.
