#!/usr/bin/env bash
set -euo pipefail
VERSION="v1.1.0"
ARCHIVE="alphacode-linux-x86_64.tar.gz"
BASE="https://github.com/dragonked2/alphacode/releases/download/${VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p .runtime
curl -fsSL "$BASE/$ARCHIVE" -o "$TMP/$ARCHIVE"
curl -fsSL "$BASE/alphacode-linux-x86_64.sha256" -o "$TMP/checksum.txt"
(cd "$TMP" && sha256sum -c checksum.txt)
mkdir -p "$TMP/unpack"
tar -xzf "$TMP/$ARCHIVE" -C "$TMP/unpack"
BIN_PATH="$(find "$TMP/unpack" -type f -name alphacode -print -quit)"
if [ -z "$BIN_PATH" ]; then echo "AlphaCode binary not found in official archive" >&2; exit 1; fi
install -m 0755 "$BIN_PATH" .runtime/alphacode
.runtime/alphacode --version
