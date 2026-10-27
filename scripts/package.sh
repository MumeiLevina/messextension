#!/usr/bin/env bash
# Echo Assistant — packaging script.
#
# Produces a distributable archive of the built extension. It never includes
# browser profiles, credentials, cookies or conversation data.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$ROOT_DIR/dist"
RELEASE="$ROOT_DIR/release"

cd "$ROOT_DIR"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
else
  GREEN=''; BLUE=''; RED=''; NC=''
fi
info() { printf "%b[INFO]%b %s\n" "$BLUE" "$NC" "$*"; }
ok()   { printf "%b[ OK ]%b %s\n" "$GREEN" "$NC" "$*"; }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$NC" "$*" >&2; exit 1; }

info "Build tiện ích…"
npm run build || fail "Build thất bại."

[ -f "$DIST/manifest.json" ] || fail "Thiếu dist/manifest.json."

# --- Safety scan ---------------------------------------------------------
info "Kiểm tra an toàn (không được chứa hồ sơ / thông tin đăng nhập)…"
FORBIDDEN=("ChromeProfile" "Cookies" "Login Data" "Web Data" "Local State" "Default/Preferences")
FOUND=0
for f in "${FORBIDDEN[@]}"; do
  if [ -e "$DIST/$f" ]; then
    printf "%b[FAIL]%b dist chứa mục bị cấm: %s\n" "$RED" "$NC" "$f"
    FOUND=1
  fi
done
if find "$DIST" -iname "*.sqlite*" -o -iname "Cookies*" 2>/dev/null | grep -q .; then
  printf "%b[FAIL]%b dist chứa tệp cơ sở dữ liệu trình duyệt\n" "$RED" "$NC"
  FOUND=1
fi
[ "$FOUND" -eq 0 ] || fail "Có thông tin hồ sơ trong bản build."
ok "Không có hồ sơ hay thông tin đăng nhập trong bản build."

# --- Archive -------------------------------------------------------------
mkdir -p "$RELEASE"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$RELEASE/echo-assistant-$STAMP.zip"

if command -v zip >/dev/null 2>&1; then
  (cd "$DIST" && zip -qr "$ARCHIVE" .) || fail "Không tạo được file zip."
else
  # Fallback: use PowerShell's Compress-Archive.
  info "Không có lệnh zip — dùng PowerShell Compress-Archive."
  WIN_DIST="$(cygpath -w "$DIST")"
  WIN_ARCHIVE="$(cygpath -w "$ARCHIVE")"
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path '$WIN_DIST\\*' -DestinationPath '$WIN_ARCHIVE' -Force" \
    || fail "Không tạo được file zip."
fi

[ -f "$ARCHIVE" ] || fail "Không tạo được file $ARCHIVE."
SIZE_KB=$(( $(wc -c < "$ARCHIVE") / 1024 ))
ok "Đã tạo gói phát hành: $ARCHIVE (${SIZE_KB} KB)"

# --- Copyable unpacked folder -------------------------------------------
UNPACKED="$RELEASE/echo-assistant-$STAMP-unpacked"
mkdir -p "$UNPACKED"
cp -r "$DIST/." "$UNPACKED/"
ok "Bản giải nén để cài: $UNPACKED"

cat <<EOF

==============================================
  Đóng gói hoàn tất
==============================================

Bản cài dùng ngay (nạp trong chrome://extensions):
  $UNPACKED

Gói phát hành:
  $ARCHIVE

Cài đặt: chrome://extensions → Developer mode → Load unpacked →
chọn thư mục trên.
EOF
