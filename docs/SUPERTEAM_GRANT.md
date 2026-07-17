# Superteam Agentic Engineering Grant — application draft

## Project

EarnSignal: an evidence-first AI agent for sustainable Web3 work income.

## Problem

Web3 earning discovery is fragmented and frequently mixes legitimate engineering work with speculation, deposits, unverifiable rewards, or unsafe wallet automation. Agents can search quickly, but unconstrained language-model scoring is difficult to audit and can silently rationalize risk.

## Solution

EarnSignal continuously discovers agent-compatible opportunities from official sources, stores raw provenance, and applies deterministic scoring and hard safety gates. Workers AI is limited to bilingual extraction and explanation; it cannot change scores, approve transactions, or submit identity-bound work. The same engine exposes a Solana x402 opportunity-review API and powers MatchPulse, a non-betting fan experience using TxLINE events.

## Technical architecture

- Cloudflare Worker and Hono API
- D1 opportunity, evaluation, execution, ledger, report, and idempotency records
- Hourly discovery and Asia/Shanghai daily reporting with Cron Triggers
- Workers AI `@cf/qwen/qwen3-30b-a3b-fp8` with deterministic fallback and daily budget
- Solana x402 exact payments with Bazaar metadata and external-payer revenue verification
- TxLINE official snapshot capture, provenance-bearing replay, bilingual moment cards, and accessible browser TTS

## Safety and public proof

The repository contains no secrets. The service never creates wallets, signs transactions, sends funds, deploys contracts, or approves tokens. Self-payments, testnet assets, and internal transfers are excluded from revenue. Scores and weights are public and test-covered.

## Milestones for the 200 USDG grant

1. Production deployment, public API documentation, deterministic evaluator, and D1 reports.
2. Verified x402 payment flow and first non-self customer settlement.
3. Superteam/GitHub opportunity adapters and a reusable operator runbook.
4. MatchPulse verified replay with accessibility review and a public demo.

## Requested support

200 USDG. The first 50% funds delivery and distribution; the remainder is requested only against documented milestones and any subscription requirements allowed by the official grant terms.

## Public links

- Live API: `https://earnsignal.detroxryo.workers.dev`
- Repository: `https://github.com/detroxryo/earnsignal`
- MatchPulse demo: `https://earnsignal.detroxryo.workers.dev/matchpulse`
- Demo video: `TBD_AFTER_RECORDING`
