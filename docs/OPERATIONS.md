# 72-hour operator runbook

All times are relative to mission start. Automated checks may continue unattended; every wallet or identity checkpoint is manual.

## H0–H4: foundation

- Deploy staging with payments and TxLINE live mode disabled.
- Run the first discovery and generate the first four-part report.
- Register the Superteam Agent and store its API key only as a Worker secret.
- Human checkpoint: create or select a dedicated public Solana receiving address. Never paste a recovery phrase into this project.
- Human checkpoint: activate TxLINE through its official subscription/signature flow. If official fixture data is unavailable by H4, keep MatchPulse in honest empty-replay mode and prioritize the paid API.

## H4–H12: opportunity engine

- Confirm hourly Cron upserts without duplicate opportunity or evaluation corruption.
- Inspect `/v1/opportunities/top` and manually verify every candidate scoring at least 80.
- Transition the selected opportunity through `SELECTED` and `IN_PROGRESS` only after scope verification.
- Automatic Agent API submission is permitted only for a human-reviewed, public, allowlisted artifact attached to an eligible Superteam opportunity. The queue is idempotent, retries at most three times, and processes no more than three submissions per day. Grants and hackathons remain human-submission checkpoints.

## H12–H30: product and payment test

- Capture at least one official TxLINE fixture through the admin endpoint after credentials exist.
- Test keyboard navigation, reduced motion, event provenance, bilingual explanation, and browser TTS.
- With explicit human confirmation, perform a Solana devnet x402 402 → payment → 200 test.
- Verify replayed payment headers and transaction hashes do not create duplicate ledger entries.

## H30–H42: submissions

- Generate production screenshots and a demo under five minutes.
- Review `SUPERTEAM_GRANT.md` and submit through the official human flow.
- Review `TXODDS_SUBMISSION.md` and submit at least six hours before the official deadline.
- Record the artifact URL and move each opportunity to `SUBMITTED`.

## H42–H54: production revenue path

- Configure CDP facilitator credentials and a verified Solana mainnet receiver.
- Human checkpoint: explicitly approve the first real x402 payment test. Mark it excluded if the payer is user-controlled.
- Publish one factual launch post with a working URL and a concrete example.

## H54–H72: focused distribution and closeout

- Send at most ten personalized, relevant messages; no scraping-based blasts or repeated follow-ups.
- Re-run discovery and execute only high-score work that fits the remaining time.
- Verify external settlements using the public address and official explorer/RPC evidence.
- Generate the final daily report. If external revenue is zero, report zero and preserve the failure evidence.

## Daily operator checks

```bash
curl "$BASE_URL/health"
curl "$BASE_URL/v1/opportunities/top"
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/admin/reports/daily"
```

Never put real tokens into shared terminal output, issue comments, demo recordings, or CI logs.
