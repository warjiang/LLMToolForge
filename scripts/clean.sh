#!/usr/bin/env bash
# Clean build artifacts and (optionally) deps + generated agent workspaces.
#
# Usage:
#   scripts/clean.sh            # dist + src-tauri/target
#   scripts/clean.sh --deps     # also node_modules
#   scripts/clean.sh --sessions # also ~/.llmtoolforge/sessions agent artifacts
#   scripts/clean.sh --all      # everything above
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deps=false
sessions=false

for arg in "$@"; do
  case "$arg" in
    --deps) deps=true ;;
    --sessions) sessions=true ;;
    --all) deps=true; sessions=true ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

zap() {
  if [ -e "$1" ]; then
    echo "removing $1"
    rm -rf "$1"
  else
    echo "skip (absent) $1"
  fi
}

zap "$root/dist"
zap "$root/src-tauri/target"
$deps && zap "$root/node_modules"
$sessions && zap "$HOME/.llmtoolforge/sessions"

echo "clean done"
