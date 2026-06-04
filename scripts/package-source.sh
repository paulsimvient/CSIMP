#!/usr/bin/env bash
# Create a clean source archive suitable for Linux/macOS extraction and npm ci.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="${1:-coda2-source}"
OUT="${NAME}.tar.gz"

tar \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='__MACOSX' \
  --exclude='._*' \
  --exclude='.DS_Store' \
  --exclude='*.tar.gz' \
  --exclude='*.zip' \
  --exclude='Archive.zip' \
  -czf "$OUT" \
  .

echo "Created ${OUT}"
