#!/usr/bin/env bash
set -euo pipefail

COMPANY_ID=""
REPO_PATH=""
PASSTHROUGH=()

while [ $# -gt 0 ]; do
  case "$1" in
    --company-id|-C) COMPANY_ID="$2"; shift 2 ;;
    --path) REPO_PATH="$2"; shift 2 ;;
    --api-base|--data-dir) PASSTHROUGH+=("$1" "$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$COMPANY_ID" ] || { echo "--company-id is required" >&2; exit 2; }
[ -n "$REPO_PATH" ] || { echo "--path is required" >&2; exit 2; }

ABS="$(cd "$REPO_PATH" && pwd)"
[ -d "$ABS/.git" ] || { echo "No .git directory under $ABS" >&2; exit 1; }

PAYLOAD="{\"path\":\"$ABS\"}"
ARGS=(plugin local-folder:set paperclip-git-graph repo -C "$COMPANY_ID" --payload-json "$PAYLOAD")

if command -v paperclipai >/dev/null 2>&1; then
  paperclipai "${ARGS[@]}" "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
else
  npx --yes paperclipai "${ARGS[@]}" "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
fi

echo "Bound repo folder for company $COMPANY_ID to $ABS."
