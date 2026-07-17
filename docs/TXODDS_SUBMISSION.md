# MatchPulse — TxODDS submission draft

## Submission gate

- [x] Public production app
- [x] Public repository and passing CI
- [x] Technical documentation and exact TxLINE endpoint list
- [ ] Authenticated TxLINE fixture request through the official Solana signup
- [ ] At least one captured fixture with verified replay events
- [ ] Live replay, bilingual brief, provenance, keyboard, and TTS verification
- [ ] Public demo video under five minutes
- [ ] Human-reviewed submission before July 19, 2026 at 23:59 UTC

Do not submit while any of the first six items is incomplete. A polished empty state is not a functional TxLINE product.

## One-line pitch

MatchPulse turns provable TxLINE match events into accessible bilingual moment cards that help fans understand a game without exposing odds, wagers, profit forecasts, or trading flows.

## Consumer problem

Live score feeds tell fans what changed but rarely explain why a moment matters. Commentary is often inaccessible to users who prefer concise text, another language, keyboard navigation, or spoken summaries.

## Experience

- Live fixture selection from the official TxLINE fixtures snapshot.
- Verified event cards captured from the official scores snapshot.
- Clear provenance and capture timestamp on every replay card.
- English and Chinese fan explanations with deterministic fallback.
- Browser-native TTS, keyboard navigation, focus states, mobile layout, and reduced-motion support.
- Honest empty state when TxLINE is not activated; no synthetic event is presented as captured data.

## Non-betting boundary

MatchPulse has no odds display, betting recommendation, expected-return forecast, wallet transaction, or trading link. Its AI system prompt explicitly forbids these outputs.

## Original value and commercial path

MatchPulse is not another live-score skin. It creates an accessibility and comprehension layer on top of verified sports events: short bilingual explanations, spoken summaries, keyboard-first replay, and visible source provenance. The same capture can be replayed after a match, which matters when the live feed is quiet during judging.

The consumer app remains free. A sustainable path is a paid white-label embed and API for clubs, supporter communities, publishers, and accessibility-focused sports products. Customers could pay for branded moment cards, additional language packs, moderation policies, archive exports, and traffic-based API tiers. The product never needs odds, wagering, or a trading flow to monetize.

## Technical proof

- Cloudflare Worker, Hono, D1, Cron Triggers, and Workers AI.
- TxLINE endpoints: `/api/fixtures/snapshot` and `/api/scores/snapshot/{fixtureId}`.
- Admin-only event capture; public provenance-bearing replay.
- Test-covered deterministic safety rules shared with the EarnSignal opportunity engine.

Request path: the Worker calls the official fixtures snapshot with the guest JWT and TxLINE API token, then an admin-only capture endpoint reads `/api/scores/snapshot/{fixtureId}` and stores the source URL, capture time, fixture ID, and raw event evidence in D1. The public replay reads only those captured records; it does not substitute synthetic data.

## TxLINE API feedback

What worked well in implementation: the snapshot-oriented fixture and score endpoints map cleanly to an edge Worker and create a straightforward provenance trail for replay. Separating fixture discovery from score-event capture also keeps public reads simple and cacheable.

Friction encountered so far: onboarding spans a guest JWT, a network-specific Solana subscription transaction, an activation-message signature, and a separate API token. The wallet, network, API host, and program configuration must stay aligned. A guest-only fixture request returned 403, so a single official readiness endpoint or more structured authorization error body would shorten diagnosis. This feedback is intentionally limited to the integration work completed so far; it will be updated after the first authenticated fixture capture.

## Demo flow (under five minutes)

1. Open MatchPulse and show its no-betting boundary.
2. Select a captured fixture and play verified event cards.
3. Open provenance and capture timestamps.
4. Generate English/Chinese explanation for one event.
5. Use keyboard navigation and TTS.
6. Show the EarnSignal safety and test report briefly.

## Public links

- Live app: `https://earnsignal.detroxryo.workers.dev/matchpulse`
- Repository: `https://github.com/detroxryo/earnsignal`
- Demo video: `TBD_AFTER_RECORDING`
- Technical documentation: `https://github.com/detroxryo/earnsignal/blob/main/docs/TXODDS_SUBMISSION.md`
