# EarnSignal - Agentic Engineering Grant response

Application date: July 17, 2026

Applicant: detroxryo, solo builder

Official prompt used in Codex: `help me apply for the agentic engineering grant by Superteam`

## What I want to build

EarnSignal is an AI-native, evidence-first engine for sustainable Web3 work income. It continuously discovers engineering bounties, grants, competitions, and paid developer tasks; rejects speculative or unverifiable opportunities; ranks the remainder with deterministic expected-value rules; and records execution and verified revenue.

The business has two connected Solana products:

- A Solana x402 paid API that returns an auditable opportunity review for 0.10 USDC or a review plus implementation plan for 5 USDC.
- MatchPulse, a non-betting fan experience that turns official TxLINE match events into concise bilingual moment cards with provenance, keyboard access, and browser text-to-speech.

The long-term product is not a trading bot. It is infrastructure for agents and developers to find legitimate work, buy risk analysis, and prove what was actually earned.

## Current proof

This is already a working public MVP, not a pitch deck.

- Production: https://earnsignal.detroxryo.workers.dev
- MatchPulse: https://earnsignal.detroxryo.workers.dev/matchpulse
- Public repository: https://github.com/detroxryo/earnsignal
- Stack: Cloudflare Worker, Hono, D1, Cron Triggers, Workers AI, Solana x402, CDP Facilitator integration, and TxLINE adapters.
- Live today: hourly discovery, deterministic scoring, bilingual AI explanations with fallback, four-part daily reports, an execution state machine, revenue ledger guards, and a public low-risk opportunity feed.
- Safety proof: the service has no private keys and cannot create wallets, sign transactions, send funds, deploy contracts, or approve tokens. Self-payments and testnet assets are excluded from revenue.

The x402 and TxLINE code paths are implemented and tested, but mainnet settlement and authenticated live match capture remain deliberately disabled until their wallet-bound human checkpoints are completed. I am stating that boundary explicitly rather than presenting staged infrastructure as completed onchain traction.

## Why Solana

Solana makes sub-dollar machine payments practical. EarnSignal uses x402 exact payments with mainnet USDC so an agent can purchase a 0.10 USD risk review without an account, invoice, or subscription. The CDP facilitator handles verification and settlement, while EarnSignal stores only confirmed, unique transactions and separately labels user-controlled test payments.

MatchPulse adds a second Solana-native proof point. TxLINE access is activated through a Solana subscription and signed message, then the product captures official fixture and score snapshots for a verifiable replay. No betting odds, return forecasts, or trading entry points are exposed.

## How I use AI coding tools

Codex is the primary engineering surface for repository exploration, TypeScript implementation, test generation, security review, deployment checks, browser QA, and release preparation. Workers AI is part of the runtime, but it has a narrow role: bilingual extraction and explanation. It cannot alter deterministic scores or bypass safety gates.

The grant would let me upscale from an MVP sprint into a repeatable 30-day agentic engineering loop:

- Week 1: activate and verify Solana x402 on devnet and mainnet, complete one excluded self-test, and acquire the first external customer settlement.
- Week 2: improve official opportunity adapters, payout-evidence extraction, submission idempotency, and public evaluation examples.
- Week 3: activate TxLINE, capture real match events, finish the MatchPulse live and replay experience, and complete accessibility testing.
- Week 4: publish reusable agent documentation, run focused developer distribution, measure conversion, and ship a transparent revenue and lessons report.

AI accelerates implementation and review; deterministic code remains the authority for money, eligibility, scoring, and state transitions.

## Grant use

Requested: 200 USDG.

I will use the grant for one month of an eligible highest-tier AI coding Pro subscription, matching the stated purpose of the Agentic Engineering Grant. I will submit only genuine subscription receipts and only claim a later tranche if I can satisfy the official receipt and shipping requirements. I will not manufacture receipts or represent unrelated spend as eligible.

The subscription time is tied to the four-week delivery plan above: production hardening, Solana payment activation, TxLINE integration, test expansion, reviewer-ready documentation, and customer distribution.

## Success metrics

- One live Solana mainnet x402 endpoint returning 402 before payment and 200 after a valid payment.
- One chain-confirmed payment from an address outside all builder-controlled addresses.
- At least one verified TxLINE fixture and replay with provenance visible in MatchPulse.
- Public CI, tests, deployment, and operator documentation that another builder can reproduce.
- A transparent 30-day report covering revenue, gas, net profit, pending rewards, completed tasks, failures, and improvements.

## Why this builder

I have already compressed the idea into a deployed, test-covered system and documented the parts that are not yet activated. The grant would fund deeper use of the same AI coding workflow that produced the MVP, while the public repository and live service make progress easy to verify.

EarnSignal's central bet is simple: AI should make legitimate work easier to find and execute without making financial risk invisible. Solana provides the payment rail; agentic engineering provides the leverage; deterministic guardrails keep the system honest.
