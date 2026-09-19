#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIST="$ROOT_DIR/src/frontend/dist"
PACKAGED_DIST="$ROOT_DIR/src/backend/git_juggler/frontend_dist"
PYTHON="$ROOT_DIR/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

cd "$ROOT_DIR/src/frontend"
npm ci
npm run build

rm -rf "$PACKAGED_DIST"
mkdir -p "$PACKAGED_DIST"
cp -R "$FRONTEND_DIST"/. "$PACKAGED_DIST"/

cd "$ROOT_DIR"
"$PYTHON" -m build
