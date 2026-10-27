#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
mkdir -p .artifacts/validation
OVERALL=0
stage() {
  local name="$1"; shift
  printf '\nRunning %s\n' "$name"
  if "$@" 2>&1 | tee ".artifacts/validation/$name.log"; then
    printf 'PASS %s\n' "$name"
  else
    printf 'FAIL %s\n' "$name"
    OVERALL=1
  fi
}
stage typecheck npm run typecheck
stage lint npm run lint
stage unit npm run test:unit
stage integration npm run test:integration
stage benchmarks npm run bench
stage build npm run build
stage browser npm run test:browser
exit "$OVERALL"
