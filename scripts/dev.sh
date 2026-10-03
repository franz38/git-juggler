#!/usr/bin/env bash
# Runs the backend and frontend dev servers together, both hot-reloading.
# See README.md's "Dev mode" section for the equivalent manual steps.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT=8788
OPEN_BROWSER=1

usage() {
  echo "Usage: $0 [path-to-scan] [--port PORT] [--no-open]" >&2
  echo "  path-to-scan    optional: directory whose first-level children get scanned for git repos." >&2
  echo "                  Only used to seed the config on first run; scan paths are otherwise" >&2
  echo "                  managed in the app (welcome wizard / Settings)." >&2
  echo "  --port PORT     backend port (default: 8788)." >&2
  echo "  --no-open       don't open the app in a browser automatically." >&2
}

SCAN_PATH=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --port)
      BACKEND_PORT="${2:?--port requires a value}"
      shift 2
      ;;
    --no-open)
      OPEN_BROWSER=0
      shift
      ;;
    -*)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [ -n "$SCAN_PATH" ]; then
        echo "Only one path-to-scan can be given" >&2
        usage
        exit 1
      fi
      SCAN_PATH="$1"
      shift
      ;;
  esac
done

# The venv layout differs between POSIX (.venv/bin) and Windows (.venv/Scripts).
if [ -x "$ROOT_DIR/.venv/bin/python" ]; then
  VENV_BIN="$ROOT_DIR/.venv/bin"
elif [ -x "$ROOT_DIR/.venv/Scripts/python.exe" ]; then
  VENV_BIN="$ROOT_DIR/.venv/Scripts"
else
  VENV_BIN=""
fi

if [ -z "$VENV_BIN" ]; then
  echo "No .venv found -- creating one and installing git-juggler..."
  if command -v python3 >/dev/null 2>&1; then
    python3 -m venv "$ROOT_DIR/.venv"
  else
    python -m venv "$ROOT_DIR/.venv"
  fi
  if [ -x "$ROOT_DIR/.venv/bin/python" ]; then
    VENV_BIN="$ROOT_DIR/.venv/bin"
  else
    VENV_BIN="$ROOT_DIR/.venv/Scripts"
  fi
  "$VENV_BIN/pip" install -e "$ROOT_DIR"
fi

GIT_JUGGLER="$VENV_BIN/git-juggler"
[ -x "$GIT_JUGGLER" ] || GIT_JUGGLER="$VENV_BIN/git-juggler.exe"

# On Windows, Node is sometimes installed without being added to PATH (seen
# on this machine even from a plain PowerShell session) -- fall back to the
# common install locations rather than failing on "npm: command not found".
if ! command -v npm >/dev/null 2>&1; then
  for node_dir in "/c/Program Files/nodejs" "/c/Program Files (x86)/nodejs"; do
    if [ -x "$node_dir/npm.cmd" ] || [ -x "$node_dir/npm" ]; then
      export PATH="$node_dir:$PATH"
      break
    fi
  done
fi

if [ ! -d "$ROOT_DIR/src/frontend/node_modules" ]; then
  echo "No frontend node_modules found -- running npm install..."
  (cd "$ROOT_DIR/src/frontend" && npm install)
fi

BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  echo ""
  echo "Stopping dev servers..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && wait "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && wait "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ -n "$SCAN_PATH" ]; then
  echo "Starting backend (--reload) on port $BACKEND_PORT, scanning $SCAN_PATH ..."
  "$GIT_JUGGLER" "$SCAN_PATH" --reload --port "$BACKEND_PORT" --no-open &
else
  echo "Starting backend (--reload) on port $BACKEND_PORT (scan paths from config) ..."
  "$GIT_JUGGLER" --reload --port "$BACKEND_PORT" --no-open &
fi
BACKEND_PID=$!

echo "Starting frontend dev server..."
(cd "$ROOT_DIR/src/frontend" && GIT_JUGGLER_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" npm run dev) &
FRONTEND_PID=$!

if [ "$OPEN_BROWSER" = "1" ]; then
  (sleep 1 && "$VENV_BIN/python" -m webbrowser http://localhost:5173) >/dev/null 2>&1 &
fi

echo ""
echo "Backend:  http://127.0.0.1:$BACKEND_PORT"
echo "Frontend: http://localhost:5173  <- open this"
echo ""
echo "Press Ctrl+C to stop both."

wait
