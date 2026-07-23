#!/usr/bin/env bash
# Stop the detached Vite dev server started by scripts/start.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/.devserver.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No pid file; dev server not running (or started another way)."
  exit 0
fi

PID="$(cat "$PID_FILE")"

# start.sh used setsid, so PID leads its own process group. Kill the whole
# group (negative PID) to take down pnpm's shell and the vite child too.
if kill -0 "$PID" 2>/dev/null; then
  kill -- "-$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true
  sleep 1
  kill -9 -- "-$PID" 2>/dev/null || true
  echo "Stopped dev server (pgid $PID)."
else
  echo "Process $PID not running; cleaning up pid file."
fi

rm -f "$PID_FILE"
