#!/usr/bin/env bash
# Sync a release version into package.json and src-tauri/tauri.conf.json.
# The app version follows the git tag (e.g. tag v1.2.3 -> version 1.2.3).
#
# Usage:
#   scripts/set-version.sh 1.2.3
#   scripts/set-version.sh v1.2.3   # leading "v" is stripped automatically
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

raw="${1:-}"
if [ -z "$raw" ]; then
  echo "usage: set-version.sh <version|vX.Y.Z>" >&2
  exit 1
fi

# Strip a leading "v" so tags like v1.2.3 map to 1.2.3.
version="${raw#v}"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+.0-9A-Za-z]*)?$ ]]; then
  echo "error: '$raw' is not a valid semver version" >&2
  exit 1
fi

echo "Setting version to $version"

node -e '
  const fs = require("fs");
  const v = process.argv[1];
  for (const f of ["package.json", "src-tauri/tauri.conf.json"]) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    j.version = v;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    console.log("updated", f);
  }
' "$version" 

# Keep Cargo version aligned too (Cargo.toml is authoritative for the binary).
if grep -q '^version = ' "$root/src-tauri/Cargo.toml"; then
  perl -0pi -e 's/^version = "[^"]*"/version = "'"$version"'"/m' "$root/src-tauri/Cargo.toml"
  echo "updated src-tauri/Cargo.toml"
fi
