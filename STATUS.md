# Echo Assistant status — 27 October 2026

**Release decision: MANUAL VERIFICATION REQUIRED.** The extension is built in `dist`; adapter version 2.2.1. Automated results do not establish production readiness or live Messenger compatibility. The two-account TTS/STT/composer acceptance is pending.

Claude's uncommitted composer adapter, extension-message plumbing, DraftEditor/SidePanel integration and tests were preserved and continued on `feature/messenger-tts-stt-complete`, based on `6c3ad2d`. An exact pre-edit copy is in `.artifacts/handoff-20261027-083029/`. The inherited thread-change browser test passed before further edits; its historical failure could not be reproduced and no corresponding failure trace was present. Its draft-preservation assertion now checks a draft created before rejection instead of refilling it afterward.

Composer insertion requires a stable thread key and matching active tab; rechecks after asynchronous routing/focus and editor reconciliation; refuses ambiguous/disabled/hidden/reused targets; preserves the panel draft; supports textarea/native rich-editor transactions; and reports editor rejection instead of raw DOM-write success. A draft stays pinned to its original recipient until explicit confirmation. Request IDs suppress retries with existing text and after composer-node replacement. STT keeps recognized whitespace, preserves separate identical recordings, aborts on detected recipient changes, ignores late results and cannot mix another recipient's transcript with a retained draft. TTS logic was not changed.

Extension **0.2.0** adds opt-in incoming-message TTS in the Side Panel. Controls include voice, speed, sample, toggle and Stop reading. Enabling silently baselines already displayed messages; outgoing/unknown messages are never auto-read. Stable IDs preserve distinct identical messages while suppressing snapshot/edit replay. Pause/Stop, thread/session changes and panel closure cancel queued speech. TTS defaults off after reopening; keep the panel open to use it. Real Vietnamese voice availability and audible output remain manual checks. No extension permission or native dependency was added; the adapter remains 2.2.1.

The user's latest screenshot also demonstrates outgoing-message duplication: one sent message was surfaced in multiple revisions, including a revision with a delivery label. The repair reads only message payload anchors, extracts a clock instead of the full accessibility summary, and preserves one output identity through Sent/Delivered/rerender updates. Tests separately require three real messages with distinct IDs to remain three even when their text matches. The live duplicate-message check is pending reload of 2.2.1.

The old-message flood came from sending the first extraction batch directly into an append-only conversation store. The replacement ingestion policy separates a session's known history from its post-baseline output. Start and thread changes silently seed a baseline; history backfill and duplicate rerenders are remembered but suppressed. Only a proven later suffix or a full absolute timestamp after the baseline can create new output.

The preceding reader was user-reported to display actual Messenger messages. Direct authorized DOM inspection found a log wrapper, nested scroller, stable message IDs, sender headings and clipped accessibility labels; structural regressions use synthetic text only. The new-only release has not yet received its manual acceptance confirmation.

Current execution counts and timings are recorded in [VALIDATION.md](VALIDATION.md). The required live steps are in [docs/MESSENGER_DOM_QA.md](docs/MESSENGER_DOM_QA.md).

Current automated result: TypeScript PASS, ESLint PASS, 181 Vitest tests PASS (162 unit, 15 integration, 4 benchmark), 32 Playwright extension tests PASS, production build and MV3 asset validation PASS. DOM extraction is 863/863 exact; the final full-run correctness test took 4,181 ms and measured 56.94 ms average per 100 messages. An earlier full run timed out at 5,041 ms; instrumentation identifies jsdom computed CSS as about 93% of extraction cost. Timing variance remains a known risk near the unchanged 5,000 ms limit. No assertion, timeout, fixture-scenario count or latency threshold was relaxed. Latest logs are in `.artifacts/handoff-validation/`.

Recovery snapshots:

- `.artifacts/recovery-20261025-142359.zip`: takeover state before DOM/diagnostic repairs.
- `.artifacts/before-new-only-20261025-145904.zip`: reader state before the baseline-policy change; all 114 tests passed at that checkpoint.
- `.artifacts/previous-dist-*`: previous production builds preserved by the build script.

Git work targets the feature branch and a Draft PR into `main`; no automatic merge is authorized or performed. Builds, profiles, logs and local snapshots remain ignored. The PR and current commit are reported in the handoff. No credentials or security settings were changed.

Known limits: start at the conversation bottom when possible; completely disjoint undated windows are conservatively suppressed and reanchored, so some new arrivals can be missed during ambiguous virtualization. A newly navigated empty/loading thread waits for its first readable window, which becomes the baseline. Message/media formats that the adapter cannot recognize remain visibly unsupported. No Android or unrelated feature work is included.
