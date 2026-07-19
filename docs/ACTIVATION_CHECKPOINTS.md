# Activation checkpoints

EarnSignal exposes `GET /admin/readiness` so the operator can see which prerequisite is missing without reading or returning any secret value. A check reports only a boolean, an owner, and the next safe action.

## One-pass human handoff

The remaining wallet-bound work can be completed in one session. Do not paste a recovery phrase, private key, CDP secret, JWT, or API token into chat, source files, command arguments, screenshots, or issue comments.

1. Create or select a dedicated Solana wallet in the wallet's own official UI.
2. Copy only its public receiving address for x402 configuration.
3. Record every user-controlled payer public address in `CONTROLLED_PAYER_ADDRESSES`; this prevents self-tests from being counted as revenue.
4. Create CDP facilitator credentials in the official CDP portal and enter them directly through `wrangler secret put` in a private terminal.
5. Complete the official TxLINE subscription transaction and activation-message signature in the wallet UI. Enter the resulting guest JWT and API token directly through `wrangler secret put`.
6. Verify an official TxLINE fixture request before enabling live capture.
7. Review the readiness endpoint. Only then enable `PAYMENTS_ENABLED` or `TXLINE_LIVE_ENABLED` and deploy.

After publication, set `GRANT_RESPONSE_DRIVE_URL` and `TXODDS_DEMO_URL` as non-secret Worker variables. Submission readiness also checks the D1 opportunity state and requires at least one captured TxLINE event, so completed checkpoints stop appearing as pending work.

The Superteam Google OAuth checkpoint completed on 2026-07-19. The remaining profile form must use verified name and country data; do not submit the page's default country as an assumption. After profile creation, upload the prepared Grant PDF to Drive and stop for final application review before submission.

## Secret entry

Run each command interactively. Wrangler prompts for the value and does not require it in shell history.

```bash
pnpm wrangler secret put X402_RECEIVER_ADDRESS --env production
pnpm wrangler secret put CONTROLLED_PAYER_ADDRESSES --env production
pnpm wrangler secret put CDP_API_KEY_ID --env production
pnpm wrangler secret put CDP_API_KEY_SECRET --env production
pnpm wrangler secret put TXLINE_GUEST_JWT --env production
pnpm wrangler secret put TXLINE_API_TOKEN --env production
```

Although public addresses are not secret, using the same entry path keeps the deployment procedure consistent. Never run these commands with the value appended to the command line.

## Enablement gate

`PAYMENTS_ENABLED=true` is permitted only when the readiness response reports all x402 prerequisites ready and a human has explicitly authorized the real payment test. `TXLINE_LIVE_ENABLED=true` is permitted only after an authenticated official fixture request succeeds.

The first real self-test is always excluded from revenue. The first counted payment must be mainnet USDC, chain-confirmed, unique, and sent by an address outside the receiver and `CONTROLLED_PAYER_ADDRESSES` set.
