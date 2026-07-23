#!/usr/bin/env bash
# Start the Vite dev server detached. All three routes (/play /host /board) are
# served from this one server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PID_FILE="$ROOT/.devserver.pid"
LOG_FILE="$ROOT/.devserver.log"
PORT=5173

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Dev server already running (pid $(cat "$PID_FILE"))."
  exit 0
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Installing deps (first run)..."
  pnpm install
fi

echo "Starting Vite dev server on port $PORT..."
# setsid → new process group/session so stop.sh can kill vite + all its children
# (pnpm spawns a shell which spawns vite; a plain kill leaves vite orphaned).
setsid pnpm dev >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

# Give Vite a moment to bind, then show URLs.
sleep 2
echo "Started (pid $(cat "$PID_FILE")). Logs: $LOG_FILE"
echo
echo "  Player : http://localhost:$PORT/play"
echo "  Host   : http://localhost:$PORT/host"
echo "  Board  : http://localhost:$PORT/board"
echo
echo "On a phone/tablet on the same network, use this machine's LAN IP instead of localhost."
