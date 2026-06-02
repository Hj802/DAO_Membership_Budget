# DAO Budget Vault

DAO Budget Vault is an MVP for a membership-based DAO treasury. Members can create a DAO, deposit Sepolia ETH, create spending or DAO termination proposals, vote, execute approved spending, register immutable evidence hashes, and close the DAO with equal member refunds.

## Workspace

| Path                 | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `apps/web`           | Vite + React frontend for Cloudflare Pages |
| `apps/api`           | Cloudflare Workers-compatible HTTP API     |
| `packages/contracts` | Hardhat smart contracts and tests          |
| `packages/db`        | D1/Prisma schema and event sync helpers    |
| `packages/shared`    | Shared enums and constants                 |
| `packages/scripts`   | Environment validation helpers             |

## Local Setup

1. Install dependencies.

```bash
npm install
```

2. Copy the environment template and fill local-only values.

```bash
cp .env.example .env
```

3. Validate the environment and run the full verification suite.

```bash
npm run validate:env
npm run format
npm run typecheck
npm test
npm run build
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

## Development

```bash
npm run dev:api
npm run dev:web
```

Default local endpoints:

- Web: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4000`

The MVP targets Sepolia:

- Chain ID: `11155111`
- Web factory address: `VITE_FACTORY_ADDRESS`
- API factory address: `FACTORY_ADDRESS`
- Web API base URL: `VITE_API_BASE_URL` when overriding the default local API

## Demo Scenario

Use two or more member wallets on Sepolia.

1. Connect a wallet and confirm the Sepolia network warning is clear when on another chain.
2. Create a DAO with the creator and at least one additional member.
3. Deposit Sepolia ETH as a member.
4. Create a spending proposal with title, description, amount, recipient, deadline, and approval rule.
5. Vote as members, then finalize after the deadline.
6. Execute the approved spending proposal and confirm the Etherscan transaction link.
7. Register evidence for the executed spending proposal as the proposer.
8. Confirm non-proposer evidence registration is blocked by UI/API/contract policy.
9. Create a DAO termination proposal only after voting or executable proposals are resolved.
10. Vote, finalize, execute termination, and confirm the DAO moves to the terminated filter.
11. Confirm terminated DAOs block deposits, proposal creation, voting, and execution.

## Security And Access Checks

- Non-members cannot list DAO details, proposal details, evidence, or budget history through the API.
- Non-members cannot deposit, vote, execute spending, execute termination, or register evidence in the contract.
- Spending proposal `amountWei` and `recipient` are required; termination proposals store those fields as `null` off-chain and `0/address(0)` on-chain.
- Evidence file bytes are stored in R2 when configured; API responses store and return metadata plus SHA-256 hash only.
- All user-facing transaction actions require wallet signing and smart-contract validation.
- `SEPOLIA_PRIVATE_KEY` is for deployment only. Do not configure it in the API Worker runtime.

## Deployment Notes

Frontend:

```bash
npm run build -w @dao-budget/web
```

Deploy `apps/web/dist` with the Cloudflare Pages settings in `apps/web/wrangler.toml`.

API:

```bash
npm run build -w @dao-budget/api
```

Deploy the Workers-compatible handler from `apps/api/src/app.ts` with:

- D1 binding: `DAO_BUDGET_DB`
- R2 binding: `DAO_BUDGET_EVIDENCE_BUCKET`
- Sepolia chain configuration from `.env.example`

Event sync:

- `handleScheduledSync` exposes the Workers Cron entrypoint and binding metadata.
- The current MVP keeps the Cron entrypoint ready for the RPC event-source adapter.

## Verification Summary

Before demo or release, run:

```bash
npm run format
npm run typecheck
npm test
npm run build
```

The expected passing coverage includes contract creation/deposit/proposal/voting/execution/termination/evidence tests, API membership and off-chain hash tests, DB sync tests, shared enum tests, and web UI transaction-flow tests.
