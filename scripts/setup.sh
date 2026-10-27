#!/usr/bin/env bash
# Echo Assistant — setup script (Windows / Git Bash).
#
# Prepares the environment, installs dependencies, builds the extension and
# validates the output. It never deletes or overwrites an existing Chrome
# profile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colours (disabled when not a TTY).
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BLUE=''; NC=''
fi

info()  { printf "%b[INFO]%b %s\n" "$BLUE" "$NC" "$*"; }
ok()    { printf "%b[ OK ]%b %s\n" "$GREEN" "$NC" "$*"; }
warn()  { printf "%b[WARN]%b %s\n" "$YELLOW" "$NC" "$*"; }
fail()  { printf "%b[FAIL]%b %s\n" "$RED" "$NC" "$*" >&2; exit 1; }

REQUIRED_NODE_MAJOR=22
PROFILE_DIR_DEFAULT="${ECHO_PROFILE_DIR:-$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$HOME")/EchoAssistant/ChromeProfile}"

echo "=============================================="
echo "  Echo Assistant — thiết lập"
echo "=============================================="

# --- 1. Operating system ------------------------------------------------
info "Hệ điều hành: $(uname -a)"
if [ "$(uname -s)" != "MINGW"* ] && [ "$(uname -s)" != "MSYS"* ] && [ "$(uname -s)" != "CYGWIN"* ]; then
  warn "Tập tin này được thiết kế cho Windows + Git Bash."
fi

# --- 2. Bash version ----------------------------------------------------
BASH_OK=1
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then BASH_OK=0; fi
if [ "$BASH_OK" -eq 1 ]; then ok "Bash ${BASH_VERSION}"; else fail "Cần Bash 4.0 trở lên (đang có ${BASH_VERSION})."; fi

# --- 3. Git -------------------------------------------------------------
if command -v git >/dev/null 2>&1; then
  ok "Git $(git --version | awk '{print $3}')"
else
  fail "Không tìm thấy Git. Hãy cài Git for Windows: https://git-scm.com/download/win"
fi

# --- 4. Node.js / npm ---------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  fail "Không tìm thấy Node.js. Hãy cài Node.js ${REQUIRED_NODE_MAJOR}+: https://nodejs.org"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  fail "Cần Node.js ${REQUIRED_NODE_MAJOR} trở lên (đang có $(node -v))."
fi
ok "Node.js $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  fail "Không tìm thấy npm. Hãy cài lại Node.js kèm npm."
fi
ok "npm $(npm -v)"

# --- 5. Chrome ----------------------------------------------------------
CHROME_PATH=""
for candidate in \
  "/c/Program Files/Google/Chrome/Application/chrome.exe" \
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
  "${LOCALAPPDATA:-}/Google/Chrome/Application/chrome.exe"; do
  if [ -f "$candidate" ]; then CHROME_PATH="$candidate"; break; fi
done
if [ -n "$CHROME_PATH" ]; then
  ok "Google Chrome: $CHROME_PATH"
else
  warn "Không tìm thấy Google Chrome trên máy. Hãy cài tại https://www.google.com/chrome/"
fi

# --- 6. Disk space ------------------------------------------------------
if command -v df >/dev/null 2>&1; then
  FREE_KB="$(df -Pk "$(cygpath -u "$ROOT_DIR" 2>/dev/null || echo "$ROOT_DIR")" | awk 'NR==2 {print $4}')"
  FREE_GB=$((FREE_KB / 1024 / 1024))
  if [ "$FREE_GB" -lt 2 ]; then
    fail "Cần ít nhất 2 GB trống (đang còn ${FREE_GB} GB)."
  fi
  ok "Dung lượng trống: ${FREE_GB} GB"
fi

# --- 7. Dependencies ----------------------------------------------------
cd "$ROOT_DIR"
if [ -f package-lock.json ]; then
  info "Cài đặt phụ thuộc (npm ci)…"
  npm ci || fail "npm ci thất bại."
else
  info "Cài đặt phụ thuộc (npm install)…"
  npm install || fail "npm install thất bại."
fi
ok "Phụ thuộc đã cài."

# --- 8. Build -----------------------------------------------------------
info "Build tiện ích…"
npm run build || fail "Build thất bại."

# --- 9. Validate build output ------------------------------------------
DIST="$ROOT_DIR/dist"
[ -f "$DIST/manifest.json" ] || fail "Thiếu dist/manifest.json — build không tạo ra thư mục dist."
[ -f "$DIST/sidepanel.html" ] || fail "Thiếu dist/sidepanel.html."
[ -f "$DIST/background.js" ]   || fail "Thiếu dist/background.js."
[ -f "$DIST/content.js" ]      || fail "Thiếu dist/content.js."
node -e "JSON.parse(require('fs').readFileSync('$DIST/manifest.json','utf8')); console.log('manifest.json hợp lệ')" \
  || fail "manifest.json không hợp lệ."
ok "Build hợp lệ tại: $DIST"

# --- 10. Browser profile ------------------------------------------------
mkdir -p "$PROFILE_DIR_DEFAULT"
ok "Thư mục hồ sơ Chrome riêng: $PROFILE_DIR_DEFAULT"
info "Hồ sơ này nằm ngoài kho mã nguồn và được tái sử dụng giữa các phiên."

# --- 11. Manual steps ---------------------------------------------------
cat <<'EOF'

==============================================
  Thiết lập hoàn tất
==============================================

Cài tiện ích (làm một lần):

  1. Mở Chrome, vào địa chỉ: chrome://extensions
  2. Bật "Developer mode" (Chế độ dành cho nhà phát triển) ở góc trên bên phải
  3. Bấm "Load unpacked" (Tải tiện ích đã giải nén)
  4. Chọn thư mục:  <đường dẫn tới repo>/dist

Sau đó chạy:  ./scripts/start.sh

Lưu ý: Chrome có thể tắt tiện ích sau khi trình duyệt khởi động lại — chỉ cần tải lại.
EOF
