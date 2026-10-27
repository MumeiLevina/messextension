#!/usr/bin/env bash
# Windows / Git Bash. Opens only Echo Assistant's dedicated profile.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
command -v node >/dev/null || { echo "Node.js is required." >&2; exit 1; }
command -v cygpath >/dev/null || { echo "Run this script in Windows Git Bash." >&2; exit 1; }
LOCAL_BASE="$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")"
PROFILE_DIR="$(cygpath -u "${ECHO_PROFILE_DIR:-$LOCAL_BASE/EchoAssistant/ChromeProfile}")"
PROFILE_NATIVE="$(cygpath -w "$PROFILE_DIR")"
DIST="$ROOT_DIR/dist"
if [ ! -f "$DIST/manifest.json" ]; then npm run build; fi
node scripts/validate-build.mjs "$DIST"
CHROME_PATH="${ECHO_CHROME_PATH:-}"
if [ -n "$CHROME_PATH" ]; then CHROME_PATH="$(cygpath -u "$CHROME_PATH")"; fi
if [ -z "$CHROME_PATH" ]; then
  for candidate in "/c/Program Files/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" "$LOCAL_BASE/Google/Chrome/Application/chrome.exe"; do
    if [ -f "$candidate" ]; then CHROME_PATH="$candidate"; break; fi
  done
fi
if [ -z "$CHROME_PATH" ] || [ ! -f "$CHROME_PATH" ]; then
  echo "Chrome not found. Set ECHO_CHROME_PATH to chrome.exe." >&2
  exit 1
fi
ARGS=("--user-data-dir=$PROFILE_NATIVE" --no-first-run --no-default-browser-check --new-window chrome://extensions https://www.facebook.com/messages)
if [ "${1:-}" = --dry-run ]; then
  printf 'Chrome command: '; printf '%q ' "$CHROME_PATH" "${ARGS[@]}"; printf '\n'
  exit 0
fi
mkdir -p "$PROFILE_DIR" "$ROOT_DIR/.artifacts"
nohup "$CHROME_PATH" "${ARGS[@]}" >"$ROOT_DIR/.artifacts/chrome-launch.log" 2>&1 </dev/null &
sleep 2
export ECHO_PROFILE_NATIVE="$PROFILE_NATIVE"
if ! powershell.exe -NoProfile -NonInteractive -Command '$match = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "chrome.exe" -and $_.CommandLine -and $_.CommandLine.Contains($env:ECHO_PROFILE_NATIVE) }; if (-not $match) { exit 1 }' >/dev/null 2>&1; then
  echo "Could not verify the dedicated Chrome process. See .artifacts/chrome-launch.log." >&2
  exit 1
fi
printf 'Chrome verified. Dedicated profile: %s\n' "$PROFILE_NATIVE"
printf 'Load unpacked directory: %s\n' "$(cygpath -w "$DIST")"
cat <<'HELP'
In chrome://extensions: enable Developer mode, click Load unpacked, select dist.
Return to Messenger and reload it after installing/reloading the extension.
Log in manually. Choose a conversation, click the Echo Assistant icon, then Start.
After each rebuild, click Reload for Echo Assistant and reload Messenger.
Chrome security protections are unchanged; no extension sideload flags are used.
HELP
