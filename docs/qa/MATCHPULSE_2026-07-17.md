# MatchPulse dogfood QA report

**Target:** <https://earnsignal.detroxryo.workers.dev/matchpulse>  
**Date:** 2026-07-17  
**Scope:** production desktop and 390px mobile layout, empty replay, controls, document language, console errors, and responsive overflow

## Executive summary

| Severity | Found | Open after fixes |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 1 | 0 |
| Low | 1 | 0 |
| **Total** | **2** | **0** |

The tested production shell is visually stable, keyboard-addressable, free of browser console errors, and has no horizontal overflow at 390px. Both discovered issues were fixed, redeployed, and rechecked. The unactivated TxLINE data path remains an external product checkpoint, not a hidden mock or QA pass.

## Fixed issues

### Issue 1: Empty replay actions appeared usable and the document language was incorrect

| Field | Value |
|---|---|
| Severity | Medium |
| Category | Accessibility / UX |
| URL | <https://earnsignal.detroxryo.workers.dev/matchpulse> |
| Status | Fixed and verified |

Steps to reproduce before the fix:

1. Open MatchPulse without activated TxLINE credentials.
2. Wait for the verified empty replay to load.
3. Inspect or activate **Play** and **Read latest**.

Expected: unavailable actions are disabled, and the English shell declares `lang="en"`.  
Actual before fix: both actions were enabled but did nothing; the page declared `lang="zh-CN"`.

Fix: disabled both actions until at least one verified event exists, added a visible disabled style, synchronized their state after every load, and corrected the document language. The production retest returned `playEnabled=false`, `readEnabled=false`, `lang=en`, and zero console issues.

Evidence:

- [Before](./assets/matchpulse-empty-state-before.png)
- [After](./assets/matchpulse-desktop-after.png)

### Issue 2: Narrow-screen control and footer wrapping lacked polish

| Field | Value |
|---|---|
| Severity | Low |
| Category | Visual |
| URL | <https://earnsignal.detroxryo.workers.dev/matchpulse> |
| Status | Fixed and verified |

Steps to reproduce before the fix:

1. Open MatchPulse at a 390px viewport.
2. Inspect the header, replay controls, and footer.

Expected: the fixture selector spans the content width, actions share one row, and footer statements remain separated.  
Actual before fix: controls wrapped unevenly and footer text ran together.

Fix: added a 520px breakpoint with a full-width fixture selector and equal-width actions, adjusted the header pill, and made footer statements separate blocks. Final browser geometry reported a 390px body, 358px controls/select/footer, and no horizontal overflow.

Evidence:

- [Before](./assets/matchpulse-mobile-before.png)
- [After control-layout pass](./assets/matchpulse-mobile-after.png)

## Testing coverage

Tested:

- production page load and verified empty state;
- fixture reload action;
- disabled replay and TTS actions without events;
- accessible names and live status text;
- desktop visual layout;
- 390px responsive layout and overflow geometry;
- browser console warnings and errors after navigation and interactions.

Not yet testable:

- captured-event playback, provenance links, per-event Workers AI button state, and browser TTS with real cards;
- TxLINE live fixtures and official score capture.

Those flows require the human-approved TxLINE Solana subscription and activation signature. The product intentionally exposes this as a truthful empty state instead of fabricating review data.
