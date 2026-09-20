#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASSTHROUGH=()

while [ $# -gt 0 ]; do
  case "$1" in
    --target-dir) TARGET_DIR="$2"; shift 2 ;;
    --api-base|--data-dir) PASSTHROUGH+=("$1" "$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

paperclip() {
  if command -v paperclipai >/dev/null 2>&1; then
    paperclipai "$@" "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
  else
    npx --yes paperclipai "$@" "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
  fi
}

cd "$TARGET_DIR"
git pull --ff-only
npm install --no-audit --no-fund
npm run build

# upgrade is the in-place path; older hosts only know install, so fall back to it
paperclip plugin upgrade paperclip-git-graph || paperclip plugin install "$TARGET_DIR"

echo "Updated paperclip-git-graph at $TARGET_DIR."
