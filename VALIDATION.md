# Composer / TTS / STT takeover — 27 October 2026 (Asia/Saigon)

Local branch: `feature/messenger-tts-stt-complete`; base: `6c3ad2d734c87b5b4b124483f6d92eaee436a096`. Before any edit, status/branches/log/full diff were read. Claude's seven modified files and two untracked files were copied intact to `.artifacts/handoff-20261027-083029/`. No hard reset, clean, replacement checkout, security-setting change or automatic message send was used.

## Current verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS: 181/181 across 14 files; 162 unit, 15 integration, 4 benchmark; zero failed/skipped |
| Composer unit coverage | 23 tests; all 11 inherited cases retained and extended |
| `npm run test:browser` | PASS: 32/32; original 25 retained, plus five composer and two STT cases; zero failed/skipped |
| `npm run build` | PASS: production Vite/WASM build, previous dist preserved |
| `npm run validate:build` | PASS: MV3 entry points, icons, local OCR worker/core/WASM and Vietnamese/English data |
| Exact extraction | 863/863 (100%); zero incorrect, missed, duplicate or ordering events; all 50 scenarios retained |
| Full-run correctness workload | 4,181 ms, unchanged 5,000 ms timeout; fixture construction 139.12 ms, extraction 4,030.34 ms |
| jsdom CSS cost within extraction | 2,179 `getComputedStyle` calls, 3,729.53 ms (~93% of extraction time) |
| Extraction latency | 56.94 ms per 100 messages, average of 50 runs; unchanged <100 ms assertion |
| Live Messenger A/B, real microphone/service, Vietnamese speaker output, native docked Side Panel | NOT RUN — MANUAL VERIFICATION REQUIRED |

Logs: `.artifacts/handoff-validation/{typecheck,lint,test,build,test-browser,validate-build,bench}.log`; latest browser JSON: `test-results/browser-results.json`. Build: `C:\Users\hantu\.codex\messenger\echo-assistant\dist`.

## Failure diagnosis and repairs

The inherited test `composer insertion refuses when the selected thread changed` **passed unchanged on the first isolated run (1.3 s)**. The reported historical 24-pass/1-fail run could not be reproduced from the supplied local snapshot, and its failing trace was unavailable; a definitive historical root cause cannot honestly be assigned. The supplied test's draft-preservation assertion filled the draft *after* rejection, so it did not establish survival. It now creates the draft first, verifies it after each rejection, and exercises both direct extension messaging and the UI after the new live recipient is detected.

The audit found concrete implementation defects: a null expected conversation key bypassed recipient validation while monitoring was idle; the draft automatically followed the panel's latest conversation; retries could duplicate an appended suffix; contenteditable replacement bypassed the editor's editing transaction; and insertion returned success without checking editor acceptance. The continuation requires a stable thread key, original tab ID and pinned draft recipient; rechecks active tab after awaited routing, target after focus, and selected/visible target after reconciliation; uses browser editing/native textarea input; and checks the resulting visible text. Ambiguous, disabled, hidden, unrecognized and cross-thread reused editor nodes fail conservatively. A bounded page-memory operation ledger covers retries, existing prefixes and composer replacement. Failures never clear the panel draft. No Send event/button/keyboard shortcut is triggered.

Fixtures now model placeholders as attributes rather than literal editable user text. Multi-line rich editors use `white-space: pre-wrap`; a new end-to-end STT test caught the previous fixture collapsing intentional spaces. Visible rich-editor spacing is compared with Chromium NBSP representation accounted for. Rejection tests restore the editor value after input and require failure instead of false success. The send regression supplies an actual Send button and verifies that it is never invoked.

STT final handling preserves recognized whitespace/accents, still deduplicates by result index, and keeps identical utterances from separate recordings. Delivery is allowed after Stop; it verifies the source recipient, refuses combining another recipient's transcript with an existing draft, and retains an undelivered final in the Voice view. Detected recipient changes dispose recognition; late events cannot change the retained draft. A full rerun exposed a separate initial-discovery race: recording could begin before the first composer-status response, then that response changed the VoiceRecorder key and disposed the recording before Stop. Recording/retry now wait for an identified recipient, preserving disposal on actual target changes. TTS policy/queue code was not edited; its existing unit and browser cases remain green.

## Benchmark timeout investigation

An earlier full run in this takeover produced 178/179 passes with one timeout: the same correctness workload took 5,041 ms (fixture 174.22 ms; extraction 4,849.47 ms), while accuracy was still 863/863 and latency 58.59 ms. Separate benchmark runs passed 4/4; one instrumented run took 4,415 ms with 3,919.32 ms spent in jsdom computed CSS. Final full verification passed at 4,181 ms with the figures above. This demonstrates substantial cold-DOM/jsdom CSS overhead and timing variance near the aggregate timeout. It does **not** isolate Windows itself or prove CPU contention as the sole cause; warm-browser latency must not be inferred from jsdom timings. No timeout, correctness target, scenario count or latency limit was increased/reduced. No persistent visibility cache was added across scans, so CSS visibility changes remain observable.

The live acceptance gate and A/B instructions are in [docs/MESSENGER_DOM_QA.md](docs/MESSENGER_DOM_QA.md). Synthetic speech and editor tests prove extension transport/policy behavior, not real Facebook editor state, audio recognition or audible Vietnamese speech. Use manual copy/paste if real Messenger insertion cannot be confirmed.

---

The following records are historical; their old Git state and test counts do not describe this takeover.

# TTS execution record — 25 October 2026 (Asia/Saigon)

Extension **0.2.0**, adapter **2.2.1**, adds opt-in incoming-message TTS. Build directory remains `C:\Users\hantu\.codex\messenger\echo-assistant\dist`; packaged build is `release/echo-assistant-0.2.0-tts.zip`. Previous production builds are preserved by the existing atomic build script. No security setting, native dependency, build-tool override or manifest permission was changed.

Executed: TypeScript PASS, ESLint PASS, **157 Vitest tests across 13 files PASS** (zero failed/skipped), including 9 new TTS policy/queue tests; **22 Playwright browser tests PASS** (zero failed/skipped), including two new TTS extension tests. Existing integration, OCR/CSP, dictation, duplicate-outgoing and new-only regressions remain included. DOM benchmark: 863/863 exact, no incorrect/missed/duplicate/order events; 60.96 ms average per 100 messages; correctness test 4,801 ms under the unchanged 5,000 ms timeout. Production build and MV3 validation PASS.

TTS tests verify opt-in baseline, incoming-only filtering, three legitimate identical IDs, queue ordering, polling/edit suppression, chosen voice/rate, long Unicode message segmentation, cancellation on pause/Stop/thread/session changes, stale callbacks, surfaced errors and no backlog replay after reopening. The browser tests use the real built extension and transport, with a synthetic SpeechSynthesis/utterance pair at the audio boundary. The initial fixture incorrectly mixed synthetic voices with a native utterance setter, which rejected them; the fixture now simulates both sides consistently. Native browser speech API availability is checked before installing that fixture. **Actual speaker output and Vietnamese voice quality are not automated or live verified.** Use the manual TTS checklist in `docs/MESSENGER_DOM_QA.md`.

Artifacts: `.artifacts/tts-validation/vitest-results.json`, `browser-full-results.json`, `browser.log`, `build.log`, `typecheck.log`, `lint.log`, `tts-tests.log`, and `tts-controls-synthetic.png`. The screenshot was visually inspected at a 420 px panel width and contains synthetic content only. The final post-error-status-fix build also reruns the two TTS browser tests; results are in `browser-tts-final.log`. Available voices depend on the user's Chrome/Windows environment; network voices are labeled and warned about in the controls. Keep the Side Panel open. TTS is off by default on reopening.

Git remains `main` with no commits and untracked project files; no author identity was invented. Live new-only/duplicate acceptance and real audible TTS remain manual checks.

# Previous new-only execution record — 25 October 2026 (Asia/Saigon)

Adapter **2.2.1** implements new-message-only tracking and outgoing-message revision handling. Exact output: `C:\Users\hantu\.codex\messenger\echo-assistant\dist`. Packaged build: `release/echo-assistant-2.2.1-new-only.zip`.

## Current root causes and corrections

The first extraction was previously appended directly to the panel store, so historical messages were called new. `core/new-message-session.ts` now owns a separate known-history ledger and post-baseline output. Start and every thread selection silently establish a baseline. Stable message IDs, per-element render tokens, constrained one-to-one sequence alignment, tail position and explicit full timestamps distinguish arrivals from duplicate observations and historical backfill. Pause preserves the ledger; resume can catch a provable suffix received during the pause. Stop clears it; restarting creates a new baseline. Clearing the view preserves known identities.

The user's latest screenshot showed multiple outgoing revisions of one message, including a revision carrying a delivery label. Generic row text walking mixed payloads with sender/status/accessibility text, and the old append-only store could append those revisions separately. The adapter now prioritizes message payload anchors, ignores heading/status/tooltip metadata, and extracts only a clock from an aria timestamp summary. An already known semantic message ID updates its existing output item. Genuine separate IDs remain distinct, even for identical text.

DOM discovery supports composer-scoped scrollers, named legacy lists and semantic logs/grids. Direct authorized Messenger DOM inspection found a log wrapping an inner scroller, stable message IDs, sender headings and clipped accessibility labels. Fixtures use synthetic structure/text only. No private message transcript or personal screenshot was saved to the repository or recovery archives.

Visibility decisions are cached only within one extraction. Chrome metadata checks use explicit tag/role predicates and a direct payload fast path. Test files run serially to prevent jsdom benchmark contention. The correctness test's 5-second timeout, 100% exactness assertions and the separate latency threshold below 100 ms remain unchanged. Intermediate runs exposed a real performance regression and timed out; the final passing measurements below were taken after the optimization.

## Current executed checks

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | 148 passed across 12 files; zero failed or skipped |
| Modern DOM adapter suite | 38 passed |
| New-message session policy suite | 23 passed |
| New adapter-to-session integration suite | 5 passed |
| DOM extraction correctness | 863/863, 100%; zero incorrect, missed, duplicate or ordering events across 50 scenarios |
| DOM extraction latency | 65.75 ms average for 100 messages over 50 runs |
| Correctness fixture test runtime | 4,624 ms, under its unchanged 5,000 ms timeout |
| Production Vite/WASM build | PASS |
| `npm run test:browser` | 20 passed; zero failed, skipped or flaky, including the three-outgoing-message lifecycle regression |
| MV3 build validator | PASS; worker, content script, Side Panel, icons, local OCR worker/core/WASM and Vietnamese/English language data present |

Full browser results are in `.artifacts/new-only-validation/browser-results.json`. The browser suite loads the real built extension and exercises native extension messaging; it does not replace the content-script relay with a mock. It includes a three-outgoing-message burst followed by Sent/Delivered changes and DOM replacement, a silent initial baseline, backfill, rerender, E2EE switching, Pause/Resume, Stop/Start, clear/identity behavior, same-thread URL changes, OCR CSP initialization and synthetic speech/manual draft flows.

Logs and machine-readable Vitest results: `.artifacts/new-only-validation/`. Inspected synthetic outgoing screenshot: `.artifacts/new-only-validation/three-outgoing-synthetic.png`; it shows exactly three outgoing bubbles with clean payloads and clock-only timestamps.

## Current live verification and Git status

The user reported that the earlier reader could extract/display real Messenger messages, then supplied a screenshot proving outgoing duplication. The **new-only/duplicate repair in 2.2.1 remains pending manual reload and live confirmation**. Chrome's internal extension-management page is blocked by the browser tool's URL policy; the native Windows UI helper was unavailable. No insecure remote-debugging port was attached to an authenticated profile. See [docs/MESSENGER_DOM_QA.md](docs/MESSENGER_DOM_QA.md).

Branch `main` still has no initial commit and no configured author identity. Source/configuration/tests/docs remain untracked; no identity was invented and nothing was pushed. Recovery snapshots are `.artifacts/recovery-20261025-142359.zip` and `.artifacts/before-new-only-20261025-145904.zip`. The latter checkpoint had 114 passing tests before the new-only policy change. Prior production output is preserved under `.artifacts/previous-dist-*`.

Primary new/modified files: `core/new-message-session.ts`, `core/models.ts`, `content/content-script.ts`, `content/messenger-adapter.ts`, `ui/SidePanel.tsx`, `ui/ConversationView.tsx`, `ui/DiagnosticsView.tsx`, the new session/integration tests, modern fixtures/adapter tests, `tests/browser/extension.spec.ts`, `vitest.config.ts`, and the four project/QA documents. Rollup WASM and esbuild WASM overrides remain in place. Windows security was not changed.

## Earlier execution record — 24 October 2026 (Asia/Saigon)

Environment: Windows, Node 24.21.0, npm 11.19.0, Windows Git Bash, installed Google Chrome 155.0.8059.85. The extension was exercised in Playwright's bundled Chromium, not an authenticated Facebook session.

## Blocker investigation

1. npm's prior install log showed the original install completed, but `npm ls` showed no WASI binding installed.
2. Installed and verified Rolldown / WASI binding at matching version 1.2.15.
3. Ran `NAPI_RS_FORCE_WASI=error` with Vitest, then Vite production build. WASI initialized; both failed with `UNRESOLVED_ENTRY` on existing Windows absolute config paths.
4. Tried Vitest with native config loading. It started all eight test files, but its WASI resolver failed on existing relative source imports.
5. Replaced the build/test stack with Vite 7.3.7, Vitest 4.1.12 and explicit Rollup WASM / esbuild WASM overrides. `npm ls rollup esbuild` confirms the aliases. No security-policy change was made.

## Tests executed

| Check | Result |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS |
| ESLint with the TypeScript parser configured | PASS |
| Unit tests | 68 passed, 7 files |
| Integration monitoring tests | 10 passed |
| DOM benchmark assertions | 4 passed, 50 scenarios |
| Exact DOM extraction | 863/863, 100%; zero incorrect, missed, duplicate or ordering events |
| DOM latency | 43.02 ms average for 100 messages over 50 runs |
| Vite production extension build | PASS; validated MV3 and every declared entry point/icon/OCR asset |
| Playwright extension tests | 9 passed in 22.2 seconds; zero skipped, failed or flaky |
| Launcher syntax and dry run | PASS |
| Launcher real Chrome startup | PASS; verified dedicated profile process |
| Panel at 420 px width | PASS; document width 420 px, no horizontal page overflow; screenshot inspected |
| npm dependency audit | Zero reported vulnerabilities |

The nine browser cases cover actual extension loading and runtime messaging; selected-conversation extraction; observer updates; five identical messages; periodic recovery after observed-list replacement; thread changes and stale navigation DOM; inactive-tab routing; real local Tesseract worker/WASM/language initialization under CSP; editable manual copy; synthetic Vietnamese speech events with fake microphone hardware; and microphone denial.

The native browser reported SpeechRecognition and `getUserMedia` APIs present. Recognition events in the speech-flow test are deliberately synthetic. No real microphone recording, cloud speech service, Facebook login, real Messenger DOM, or native docked Side Panel interaction is claimed as tested.

The original tests were retained. Fixture repairs put `isFinal` on each SpeechRecognition result, make layout stubs configurable, give headings layout, and avoid duplicate-ID selector behavior. Benchmark coverage increased from 35 to 50 scenarios without lowering thresholds. Additional regressions cover replayed speech finals, stopping before `onstart`, late events, stable message IDs with virtualized slots, Vietnamese accent edits, and revisiting a conversation.

## Artifacts and remaining checks

- Build: `C:\Users\hantu\.codex\messenger\echo-assistant\dist`
- Dedicated profile: `C:\Users\hantu\AppData\Local\EchoAssistant\ChromeProfile`
- Logs: `.artifacts/validation/*.log`
- Browser results: `test-results/browser-results.json`
- Synthetic draft screenshot: `.artifacts/validation/synthetic-draft.png`
- Narrow panel screenshot: `.artifacts/validation/panel-420px.png`
- Packaged extension: `release/echo-assistant-0.1.0-20261024.zip` (17,665,492 bytes)
- Previous production builds: `.artifacts/previous-dist-*`

Remaining manual gates: installation into branded Chrome; toolbar/native Side Panel operation; manual Facebook login and actual Messenger adapter validation; live Vietnamese microphone/service availability; virtualization ambiguity when stable IDs are absent. OCR initialization passed, but OCR accuracy benchmarks and advanced UI polishing were intentionally deferred.

The repository has no commits (`main` has no HEAD), and no Git author name/email is configured. Project source/configuration/tests and the new documentation are untracked. Commit author details have been requested; no identity has been invented and no commit has been created. Dependencies, profiles, build outputs and local test artifacts are excluded from Git. Use `git status --short` for the current tree state.
