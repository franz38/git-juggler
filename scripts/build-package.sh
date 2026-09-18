#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIST="$ROOT_DIR/frontend/dist"
PACKAGED_DIST="$ROOT_DIR/backend/git_juggler/frontend_dist"

cd "$ROOT_DIR/frontend"
npm ci
npm run build

rm -rf "$PACKAGED_DIST"
mkdir -p "$PACKAGED_DIST"
cp -R "$FRONTEND_DIST"/. "$PACKAGED_DIST"/

cd "$ROOT_DIR/backend"
python -m build
