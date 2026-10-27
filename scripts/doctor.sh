#!/usr/bin/env bash
# Echo Assistant — environment diagnostic.
#
# Reports the toolchain, the build state and the extension manifest.
# It prints no sensitive information (no paths to cookies, no tokens).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BLUE=''; NC=''
fi
pass() { printf "  %b%-22s%b %s\n" "$GREEN" "$1" "$NC" "$2"; }
warn() { printf "  %b%-22s%b %s\n" "$YELLOW" "$1" "$NC" "$2"; }
fail() { printf "  %b%-22s%b %s\n" "$RED" "$1" "$NC" "$2"; }
head2() { printf "\n%b%s%b\n" "$BLUE" "$1" "$NC"; }

echo "=============================================="
echo "  Echo Assistant — chẩn đoán môi trường"
echo "=============================================="

head2 "Hệ thống"
printf "  %-22s %s\n" "Nền tảng" "$(uname -s -r -m)"
printf "  %-22s %s\n" "Bash" "$BASH_VERSION"
printf "  %-22s %s\n" "Đường dẫn dự án" "$(cygpath -w "$ROOT_DIR" 2>/dev/null || echo "$ROOT_DIR")"

head2 "Công cụ"
if command -v node >/dev/null 2>&1; then pass "Node.js" "$(node -v)"; else fail "Node.js" "không tìm thấy"; fi
if command -v npm  >/dev/null 2>&1; then pass "npm" "$(npm -v)"; else fail "npm" "không tìm thấy"; fi
if command -v git  >/dev/null 2>&1; then pass "Git" "$(git --version | awk '{print $3}')"; else fail "Git" "không tìm thấy"; fi

CHROME_PATH=""
for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" \
         "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
         "${LOCALAPPDATA:-}/Google/Chrome/Application/chrome.exe"; do
  [ -f "$c" ] && CHROME_PATH="$c" && break
done
if [ -n "$CHROME_PATH" ]; then
  VERSION="$("$CHROME_PATH" --version 2>/dev/null | head -1 || echo '')"
  pass "Google Chrome" "${VERSION:-$(basename "$CHROME_PATH")}"
else
  fail "Google Chrome" "không tìm thấy"
fi

head2 "Phụ thuộc"
if [ -d "$ROOT_DIR/node_modules" ]; then
  pass "node_modules" "đã cài đặt"
else
  fail "node_modules" "chưa cài — chạy ./scripts/setup.sh"
fi

head2 "Bản build"
DIST="$ROOT_DIR/dist"
if [ -f "$DIST/manifest.json" ]; then
  pass "dist/manifest.json" "có"
  if node -e "JSON.parse(require('fs').readFileSync('$DIST/manifest.json','utf8'))" 2>/dev/null; then
    pass "manifest hợp lệ" "JSON parse OK"
  else
    fail "manifest hợp lệ" "JSON không hợp lệ"
  fi
  for f in sidepanel.html background.js content.js; do
    if [ -f "$DIST/$f" ]; then pass "dist/$f" "có"; else fail "dist/$f" "thiếu"; fi
  done
  if [ -f "$DIST/manifest.json" ]; then
    MV="$(node -p "JSON.parse(require('fs').readFileSync('$DIST/manifest.json','utf8')).manifest_version" 2>/dev/null || echo '?')"
    pass "manifest_version" "$MV"
  fi
else
  fail "dist/manifest.json" "chưa build — chạy npm run build"
fi

head2 "Trình chạy kiểm thử"
if [ -d "$ROOT_DIR/node_modules/vitest" ]; then pass "Vitest" "đã cài"; else fail "Vitest" "chưa cài"; fi
if [ -d "$ROOT_DIR/node_modules/@playwright/test" ]; then pass "Playwright" "đã cài"; else warn "Playwright" "chưa cài (tùy chọn)"; fi
if command -v npx >/dev/null 2>&1; then
  if npx playwright --version >/dev/null 2>&1; then pass "Playwright CLI" "sẵn sàng"; else warn "Playwright CLI" "cần npx playwright install"; fi
fi

head2 "Hồ sơ Chrome riêng"
PROFILE_DIR="${ECHO_PROFILE_DIR:-$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$HOME")/EchoAssistant/ChromeProfile}"
if [ -d "$PROFILE_DIR" ]; then
  pass "Thư mục hồ sơ" "$(cygpath -w "$PROFILE_DIR" 2>/dev/null || echo "$PROFILE_DIR")"
else
  warn "Thư mồ hồ sơ" "chưa tạo — sẽ tạo ở lần chạy start.sh"
fi

echo ""
echo "Không có thông tin nhạy cảm nào được in ra ở trên."
echo "=============================================="
