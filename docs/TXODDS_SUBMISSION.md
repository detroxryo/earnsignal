# MatchPulse — TxODDS submission draft

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

## Technical proof

- Cloudflare Worker, Hono, D1, Cron Triggers, and Workers AI.
- TxLINE endpoints: `/api/fixtures/snapshot` and `/api/scores/snapshot/{fixtureId}`.
- Admin-only event capture; public provenance-bearing replay.
- Test-covered deterministic safety rules shared with the EarnSignal opportunity engine.

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
