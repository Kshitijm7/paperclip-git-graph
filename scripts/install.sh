#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/Kshitijm7/paperclip-git-graph"
TARGET_DIR="$(cd .. && pwd)/paperclip-git-graph"
PASSTHROUGH=()

while [ $# -gt 0 ]; do
  case "$1" in
    --target-dir) TARGET_DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
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

if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" pull --ff-only
else
  git clone "$REPO" "$TARGET_DIR"
fi

cd "$TARGET_DIR"
npm install --no-audit --no-fund
npm run build
paperclip plugin install "$TARGET_DIR"

echo "Installed. Bind a repository with scripts/bind-repo.sh --company-id <id> --path <abs path>."
