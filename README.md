# Echo Assistant — Windows / Chrome

An unpacked Manifest V3 extension for the selected, visible Facebook Messenger conversation. Monitoring is opt-in. Vietnamese dictation produces editable text; copying, pasting and sending remain manual.

## Read incoming messages aloud — extension 0.2.0

Keep the Side Panel open, start monitoring at the conversation bottom, then press **Bật TTS**. A short confirmation checks playback and activates audio from a user gesture. Only incoming tracked messages received after enabling TTS are queued. Messages already displayed, outgoing messages and unknown directions are skipped. Stable IDs prevent repeated snapshots and edits from being read again; separate identical messages are each read once.

The visible TTS controls remain available across panel tabs. Choose a voice and speed; **Đọc thử** plays a synthetic sentence. **Dừng đọc** cancels playback and turns automatic reading off. Pause, Stop, conversation/session changes and closing/reloading the panel cancel pending speech. Reopening the panel defaults to TTS off. Resume can read a provable new suffix detected during the pause, following the monitor's existing policy.

The implementation uses the browser's [SpeechSynthesis API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis), requires no API key or additional extension permission, and loads no new native dependency. Available voices depend on the machine/browser. Vietnamese is preferred, with local voices first. If no Vietnamese voice is listed, install one in Windows or select another available voice. Voices marked **mạng** may transmit spoken content to the browser's voice provider; the UI displays a warning. Audio quality and Vietnamese output must be checked using **Đọc thử** on the user's machine. Automated audio-boundary tests cannot verify sound from the speakers.

**Adapter 2.2.1 tracks new messages only.** Start silently records currently rendered messages as a historical baseline. They are known to the extension but are never included in the panel's tracked-message output or new-message count.

Outgoing delivery changes update the existing tracked message identified by its semantic message ID. They do not append another item. The adapter reads message payload anchors separately from sender headings, delivery labels and accessibility summaries; timestamps contain only time metadata. Three actual outgoing messages remain three items, including when their text is identical.

| Action | Behavior |
| --- | --- |
| Start | Create a fresh session and silent baseline; display zero historical messages. |
| New arrival | Display incoming/outgoing messages proven to follow the known tail, or carrying a full explicit timestamp after the baseline. |
| Scroll upward | Remember older backfill, suppress it, and preserve the newest known anchor. |
| Rerender | Match semantic IDs, actual DOM-node identities, then constrained one-to-one sequence context; do not replay known messages. |
| Switch conversation | Clear the previous output and silently baseline the selected thread, including when switching back. |
| Pause / Resume | Preserve the session. Resume catches a provable new suffix that arrived during the pause; it does not replay history. |
| Stop / Start again | End and clear the old session, then baseline every currently rendered message again. |
| Clear panel | Clear displayed tracked messages while retaining the baseline/deduplication ledger. |

Start at the bottom of the conversation for the strongest tracking behavior. Starting in older history creates a baseline but waits for a bottom anchor before treating undated unseen rows as new. A completely replaced window with no reliable shared anchor or absolute timestamp is suppressed conservatively. It can contain new messages that cannot be distinguished from old history; Diagnostics records that case instead of guessing. Time-of-day labels alone are never treated as proof of arrival time.

An authorized live Messenger DOM was inspected on 25 October 2026, and the user reported that the previous reader displayed messages. The **new-message-only behavior still requires the live acceptance check** in [docs/MESSENGER_DOM_QA.md](docs/MESSENGER_DOM_QA.md). Automated tests use synthetic fixtures and real extension messaging, not an authenticated Facebook session.

## Install and launch

The extension build directory on this machine is:

```text
C:\Users\hantu\.codex\messenger\echo-assistant\dist
```

In **Windows Git Bash**:

```bash
cd /c/Users/hantu/.codex/messenger/echo-assistant
bash scripts/start.sh
```

The launcher has been executed successfully. It verifies the dedicated Chrome process, opens `chrome://extensions` and Messenger, and uses this profile:

```text
C:\Users\hantu\AppData\Local\EchoAssistant\ChromeProfile
```

1. In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the exact `dist` directory above.
2. Return to Messenger and **reload the page after installation**. Log in manually.
3. Select a conversation, click the Echo Assistant toolbar icon to open the Side Panel, then choose **Bắt đầu theo dõi**.
4. After rebuilding, click the extension's **Reload** button in `chrome://extensions` and reload Messenger again.

The launcher supports `ECHO_CHROME_PATH` and `ECHO_PROFILE_DIR` overrides and a `--dry-run` option. It does not use Chrome's extension sideload flags or change endpoint security. `bash scripts/stop.sh` prints stop instructions without killing unrelated processes or deleting profiles.

## Build and verify

Node 24.21.0 and npm 11.19.0 are the tested environment. Install development dependencies too; local OCR language files are build inputs.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run bench
npm run build
npm run test:browser
# Or run every stage, recording logs:
bash scripts/test.sh
```

If Playwright Chromium is missing, run `npx playwright install chromium`. Automated extension tests use Playwright's bundled Chromium with a temporary profile; they do not use the dedicated, manually authenticated Chrome profile.

`npm run build` builds to a temporary directory, validates all MV3 entry points and local OCR assets, and only then publishes `dist`. The previous `dist` is retained under `.artifacts/previous-dist-*`. Failed builds leave the published build intact. `npm run validate:build` checks an existing build. Source remains in `extension/src`; there is no nested second project directory.

## Windows native-binding blocker

The original Vite 8.3.5 / Vitest 5.0.5 stack used Rolldown 1.2.15. The previous WASI install was absent. Installing the exact matching `@rolldown/binding-wasm32-wasi@1.2.15` allowed `NAPI_RS_FORCE_WASI=error` to load WASI, but both Vitest and Vite failed resolving Windows absolute config paths. Native config loading let Vitest start, but WASI import resolution still failed for existing source files.

The working alternative explicitly replaces **both** native toolchain components:

| Component | Locked version |
| --- | --- |
| Vite | 7.3.7 |
| Vitest | 4.1.12 |
| React Vite plugin | 5.2.0 |
| `rollup` npm override | `npm:@rollup/wasm-node@4.65.0` |
| `esbuild` npm override | `npm:esbuild-wasm@0.28.2` |

This is not a Vite-only downgrade. Both bundling/parsing and TypeScript/JSX transformation use WASM packages. No Defender, App Control, application allowlist or endpoint-protection setting was changed. The unsuccessful WASI package is not part of the final dependency graph.

References consulted: [Rolldown WASI fallback](https://www.rolldown.rs/guide/getting-started), [Vite config loaders](https://vite.dev/config/), and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).

## Runtime behavior and limits

- The content script is declared only for `https://www.facebook.com/messages*`. Host access is restricted to Facebook; there is no `<all_urls>` permission. Injection uses the manifest.
- The worker routes commands to the active Messenger tab in the panel's window. It does not fall back to an inactive Messenger tab. Switching tabs stops the tracked previous monitoring session.
- Mutation observation provides live updates; the default reconciliation interval is 5 seconds. Background/hidden documents are not extracted. Unsupported layouts clear displayed conversation data.
- Thread identity changes clear output before the new thread loads. An empty loading pane is not silently treated as an empty baseline; the first readable window is baselined. Query/hash changes and normal/E2EE route changes for the same thread preserve the current session. A genuinely empty thread selected at Start supports an empty baseline and its first later arrival.
- Historical baseline data stays in content-script memory. Only post-baseline output is sent to the panel. Semantic message IDs outrank DOM positions; live element tokens and ordered neighbor context support rerenders and legitimate repeated text. See the ambiguity limit above.
- Diagnostics report the session start/status, baseline and tail-anchor status, baseline/known/new counts, historical/duplicate/backfill/ambiguous suppressions, parser counts and timestamps, actual panel acknowledgements, and the number of Conversation DOM nodes rendered. Counts are computed from execution, not assumed from parser success.
- Stop clears retained conversation data. Recording has its own visible Stop/Cancel controls; leaving the Voice tab disposes recognition. Draft text remains editable in the panel and is not sent automatically.
- Speech capability detection does not start the microphone. Record first requests microphone access, releases the permission-probe stream, then starts `vi-VN` recognition. Chrome may send audio to Google. Presence of the API does not prove that the recognition service works.
- Tesseract's worker, core JavaScript/WASM, and `vie`/`eng` trained data are packaged under `dist/ocr`. The worker uses a local URL with `workerBlobURL: false`; the extension CSP allows self-hosted WASM and prohibits remote script loading. Browser tests initialize the real worker and both languages. OCR accuracy benchmarking and a user-facing screenshot/OCR workflow are not part of this release's completion claim.
- Automated panel tests open the actual `sidepanel.html` as an extension tab. Native Side Panel docking, toolbar opening, and microphone behavior in that docked panel require the manual check in branded Chrome.

## Manual Messenger checklist

- [ ] Install/reload the extension; log in manually and open a real conversation.
- [ ] Open the native Side Panel using the toolbar icon; verify the selected conversation name and adapter version 2.2.1.
- [ ] Start with old messages already present. Confirm baseline established, baseline count greater than zero, new count zero, and an empty Conversation output.
- [ ] Add/receive a message manually; confirm exactly one post-baseline message appears with correct Vietnamese accents, timestamp, emoji and direction, and reconciliation continues around 5 seconds. The extension never sends.
- [ ] Send several identical legitimate messages manually and confirm each appears once. Scroll away/back to exercise virtualization and check for duplicates or missing messages.
- [ ] Switch threads, including threads with similar names. Confirm tracked output clears, each thread receives a silent fresh baseline, and only later arrivals appear. Switch browser tabs and confirm controls do not follow an inactive tab.
- [ ] Try a hidden chat pane or changed/unsupported layout; verify a visible diagnostic and no unrelated sidebar text.
- [ ] Choose Voice, allow microphone access, speak Vietnamese, press Stop, insert into Draft, edit, copy, and paste manually. Confirm recording ends on Cancel and when leaving Voice. Try denied microphone access too.
- [ ] Check Diagnostics reports local OCR readiness and that Chrome's extension Errors view shows no worker, CSP or missing-asset failures.
- [ ] Press monitoring Stop and verify the transcript is cleared and new page messages no longer update it.
- [ ] Pause/Resume and confirm no history replay; Stop/Start and confirm a fresh baseline includes previously tracked messages without displaying them again.

Recorded execution details are in [VALIDATION.md](VALIDATION.md) and the current release decision is in [STATUS.md](STATUS.md). Latest logs/JSON are in `.artifacts/new-only-validation` and `test-results/browser-results.json`.
