# Security boundaries

## Non-negotiable controls

- No private key, recovery phrase, mnemonic, API secret, bearer token, or wallet credential is committed or logged.
- The Worker never signs a blockchain transaction or sends funds.
- Contract deployment, token approvals, wallet creation, wallet permission changes, KYC, claiming, and paid subscriptions require an explicit human checkpoint.
- Direct capital cost is capped at $2 by deterministic scoring. A larger requirement is a hard rejection.
- Gambling, wagering, leveraged trading, speculative token purchases, pump-and-dump activity, and illegal or unethical work are hard rejections.
- AI text cannot change a score, override a hard risk, transition an opportunity, or authorize a payment.

## Secret handling

Production secrets must be stored with `wrangler secret put`. Local-only secrets belong in `.dev.vars`, which is ignored by Git. Logs use structured events and never include request bodies, authorization headers, payment headers, TxLINE credentials, or source API responses.

Run before every deployment:

```bash
pnpm secrets:scan
git diff --check
```

The scan is intentionally conservative. A zero-result `rg` exits with status 1; this means no patterns were found, not that the check failed.

## Payment safety

- Production uses Solana mainnet USDC and the CDP facilitator.
- Development uses the x402 test facilitator and Solana devnet.
- Payments remain disabled by configuration until receiver and facilitator credentials exist.
- A unique D1 constraint on `(chain, tx_hash)` prevents double counting.
- Receiver and controlled payer addresses are stored as non-secret configuration and excluded from external revenue.
- A paid opportunity can reach `PAID` only after a confirmed external ledger entry is associated with it.

## Incident response

If a secret appears in source, history, build output, or logs: disable payments, rotate the credential at its issuer, remove it from the active environment, preserve only non-secret incident evidence, and review all deployments and transaction history before restoring service.

