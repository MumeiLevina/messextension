# Messenger new-message-only acceptance check

Use only conversations you approve for inspection. Log in manually. Do not share passwords, cookies, tokens, private API responses, or private message text with diagnostics. Echo Assistant must never send a message automatically.

## Install the exact current build

1. Open `chrome://extensions` in the same Chrome profile/window used for the test conversation.
2. Confirm Echo Assistant's unpacked source is `C:\Users\hantu\.codex\messenger\echo-assistant\dist`; click Reload. If it is not installed, use Developer mode → Load unpacked and select that folder manually.
3. Reload Messenger. Open an approved conversation with existing text messages and scroll to the bottom.
4. Open Echo Assistant from its toolbar icon. Diagnostics must report adapter **2.2.1**, content script ready, the expected conversation identity and a recognized container.

The browser tool cannot open Chrome's internal extension-management page because of its URL policy, and the native Windows UI helper was unavailable during the takeover. These steps require the user; no remote-debugging port is added to an authenticated profile.

## Pass/fail checklist

| Action | Required evidence |
| --- | --- |
| Click Start with old text present | Baseline established = yes; baseline count reflects parsed old messages; new emitted = 0; Conversation output empty. |
| Receive one incoming message manually | Exactly one new message appears, with correct text/direction; baseline messages stay absent. |
| Send one outgoing message manually | Exactly one further new message appears. Sending is performed by you in Messenger. |
| Manually send identical text several times | Every real new message appears once; periodic scans do not duplicate it. |
| Manually send three outgoing messages rapidly | Exactly three output items appear. Sent/Delivered/Seen changes and rerenders must not turn them into six or nine items. Delivery labels must not be appended to message payloads, and the timestamp must not repeat sender/message text. |
| Wait at least two reconciliation cycles | Output remains stable; scan timestamps advance at approximately five-second intervals. |
| Scroll upward and load older messages | Backfill/historical suppression counters rise; no old rows enter Conversation. |
| Return to the bottom and receive another message | New arrival appears once if the newest known anchor remains identifiable. |
| Switch to another approved conversation | Prior output clears; the first readable window becomes a fresh silent baseline; old messages in this thread do not appear. |
| Switch back | A fresh baseline is created again; earlier tracked messages do not replay. |
| Pause, then manually receive a message and resume | Session start and baseline remain unchanged; only the provable appended suffix is emitted on resume. |
| Stop and Start again | Output clears; a new session baselines all messages now present, including previously tracked ones. Only a later arrival appears. |
| Clear the displayed output | Known history remains known; the next reconciliation must not replay cleared messages. |
| Stop and mutate/receive afterward | No extraction occurs while stopped; displayed tracked messages remain empty. |

## Interpreting diagnostics

- **Baseline count** counts the initial readable snapshot for the currently selected thread.
- **Known count** includes baseline, backfill, new messages and conservatively suppressed ambiguous rows.
- **New emitted count** is cumulative for the current thread/session; clearing the view does not turn known messages into new ones.
- **Historical suppressed** includes the initial baseline and later suppressed history; **backfill suppressed** is the later-history subset.
- **Duplicate suppressed** counts repeated observations, so it grows on unchanged scans.
- **Tail anchor established** indicates whether the policy has reached a known bottom frontier. If Start occurred in older history, scroll down to establish it.
- **Unanchored suppressed** means the entire DOM window changed without a reliable shared identity or full timestamp. Those rows are intentionally not called new. The current bottom becomes a conservative anchor for future arrivals.
- **Parsed count** includes old and new readable DOM rows. It is expected to exceed the panel's received/rendered tracked-message count.
- **Delivered count** is credited only after an actual panel acknowledgement, and rendered count is measured from Conversation DOM nodes.

Only full date/time values with a timezone from a rendered `<time datetime>` can prove arrival time in a disjoint window. A label such as `10:30` is insufficient. In a newly navigated empty thread, the first readable window is treated as baseline to avoid hydration history being reported as new; this may suppress the first arrival if the thread was genuinely empty.

## Live verification record

The selected live Messenger DOM was inspected on 25 October 2026 without saving message text or personal screenshots. The user reported that the preceding reader extracted and displayed messages. **The new-message-only checklist above is pending manual confirmation.** Report only pass/fail, adapter version and numeric counters; do not paste private message content.

After the live checklist passes, update `STATUS.md` and `VALIDATION.md` with the performed cases and remaining exceptions. Automated synthetic success alone does not establish complete real Messenger compatibility.
# TTS acceptance — extension 0.2.0

After reloading the unpacked extension and Messenger, keep the Side Panel open. These are manual checks; automated TTS tests simulate the audio boundary and do not prove audible Vietnamese output.

1. Choose a Vietnamese voice, press **Đọc thử**, and confirm clear audio. Check the network warning if choosing a voice marked **mạng**.
2. Start monitoring at the conversation bottom, then enable **Bật TTS**. Existing displayed messages must remain silent apart from the short synthetic activation sentence.
3. Have an approved other participant send a new message. It should be spoken once. Send a message yourself manually: it must not be spoken.
4. Have the other participant send three separate identical messages. All three should be spoken once in order. Wait through several five-second scans: none should repeat.
5. Try a long message; all its segments should be spoken in order. Change speed and verify the next segments use it.
6. Press **Dừng đọc** during playback: current and queued speech must stop, and TTS must turn off. Re-enable: messages already tracked must not replay.
7. Check Pause, Stop, switching between approved threads and closing the panel cancel pending speech. Reopen: TTS must default off; enabling must not replay the backlog.

