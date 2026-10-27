# Echo Assistant status — 25 October 2026

**Release decision: BLOCKED on the manual new-message-only Messenger acceptance check.** The usable extension is built in `dist`; adapter version 2.2.1. Do not label the new behavior WEB VERIFIED until the live check below is confirmed.

Extension **0.2.0** adds opt-in incoming-message TTS in the Side Panel. Controls include voice, speed, sample, toggle and Stop reading. Enabling silently baselines already displayed messages; outgoing/unknown messages are never auto-read. Stable IDs preserve distinct identical messages while suppressing snapshot/edit replay. Pause/Stop, thread/session changes and panel closure cancel queued speech. TTS defaults off after reopening; keep the panel open to use it. Real Vietnamese voice availability and audible output remain manual checks. No extension permission or native dependency was added; the adapter remains 2.2.1.

The user's latest screenshot also demonstrates outgoing-message duplication: one sent message was surfaced in multiple revisions, including a revision with a delivery label. The repair reads only message payload anchors, extracts a clock instead of the full accessibility summary, and preserves one output identity through Sent/Delivered/rerender updates. Tests separately require three real messages with distinct IDs to remain three even when their text matches. The live duplicate-message check is pending reload of 2.2.1.

The old-message flood came from sending the first extraction batch directly into an append-only conversation store. The replacement ingestion policy separates a session's known history from its post-baseline output. Start and thread changes silently seed a baseline; history backfill and duplicate rerenders are remembered but suppressed. Only a proven later suffix or a full absolute timestamp after the baseline can create new output.

The preceding reader was user-reported to display actual Messenger messages. Direct authorized DOM inspection found a log wrapper, nested scroller, stable message IDs, sender headings and clipped accessibility labels; structural regressions use synthetic text only. The new-only release has not yet received its manual acceptance confirmation.

Current execution counts and timings are recorded in [VALIDATION.md](VALIDATION.md). The required live steps are in [docs/MESSENGER_DOM_QA.md](docs/MESSENGER_DOM_QA.md).

Current automated result for TTS 0.2.0: TypeScript PASS, ESLint PASS, 157 Vitest tests PASS, 22 Playwright extension tests PASS, production build and MV3 asset validation PASS. DOM extraction is 863/863 exact with a measured 60.96 ms average per 100 messages. TTS browser checks use a synthetic audio boundary; native speech API presence was checked separately. No meaningful assertion, timeout or latency threshold was relaxed. Evidence is in `.artifacts/tts-validation/`.

Recovery snapshots:

- `.artifacts/recovery-20261025-142359.zip`: takeover state before DOM/diagnostic repairs.
- `.artifacts/before-new-only-20261025-145904.zip`: reader state before the baseline-policy change; all 114 tests passed at that checkpoint.
- `.artifacts/previous-dist-*`: previous production builds preserved by the build script.

Git remains on `main` without an initial commit. Source/tests/configuration/docs are untracked. No author identity was invented, no remote push was made, and profiles/private messages are excluded from artifacts and Git. To commit later, configure a repository-local identity using your own values:

```bash
git config --local user.name "Your Name"
git config --local user.email "you@example.com"
git add .
git commit -m "Track only post-baseline Messenger messages"
```

Known limits: start at the conversation bottom when possible; completely disjoint undated windows are conservatively suppressed and reanchored, so some new arrivals can be missed during ambiguous virtualization. A newly navigated empty/loading thread waits for its first readable window, which becomes the baseline. Message/media formats that the adapter cannot recognize remain visibly unsupported. No Android or unrelated feature work is included.
