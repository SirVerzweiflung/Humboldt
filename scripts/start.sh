#!/usr/bin/env bash
# Start the dev stack detached: the Vite dev server (all routes) + the self-hosted
# image upload service (server/upload). Both run under one process group so
# stop.sh can kill them together.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PID_FILE="$ROOT/.devserver.pid"
LOG_FILE="$ROOT/.devserver.log"
PORT=5173
UPLOAD_PORT=8787

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Dev server already running (pid $(cat "$PID_FILE"))."
  exit 0
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Installing deps (first run)..."
  pnpm install
fi

# The upload server shares its secret with the client. Read it from apps/web/.env
# (VITE_UPLOAD_TOKEN) so both sides always match in dev.
UPLOAD_TOKEN="$(grep -E '^VITE_UPLOAD_TOKEN=' apps/web/.env 2>/dev/null | cut -d= -f2- || true)"
if [[ -z "${UPLOAD_TOKEN}" ]]; then
  echo "WARNING: VITE_UPLOAD_TOKEN not set in apps/web/.env — image upload will not start."
fi

echo "Starting Vite (:$PORT) + upload service (:$UPLOAD_PORT)..."
# setsid → new process group; the leader (bash) execs pnpm dev after spawning the
# upload server, so both die on a single group kill in stop.sh.
UPLOAD_TOKEN="$UPLOAD_TOKEN" UPLOAD_PORT="$UPLOAD_PORT" \
  setsid bash -c '
    if [[ -n "${UPLOAD_TOKEN}" ]]; then node server/upload/index.mjs & fi
    exec pnpm dev
  ' >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

sleep 2
echo "Started (pgid $(cat "$PID_FILE")). Logs: $LOG_FILE"
echo
echo "  Host   : http://localhost:$PORT/host"
echo "  Quiz   : http://localhost:$PORT/quiz   (editor — reached from Host)"
echo "  Player : http://localhost:$PORT/play"
echo "  Board  : http://localhost:$PORT/board"
echo
echo "On a phone/tablet on the same network, use this machine's LAN IP instead of localhost."
