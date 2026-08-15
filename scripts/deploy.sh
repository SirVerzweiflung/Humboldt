#!/usr/bin/env bash
# Build the SPA and publish it as a new release, swapping it in atomically.
#
# The atomic swap is the whole point: `cp` onto a live directory gives players a
# window in which they load a half-written app. Instead each build lands in its
# own timestamped directory and `current` is repointed with a rename.
#
#   ./scripts/deploy.sh            # build this checkout and publish it
#   ./scripts/deploy.sh --pull     # git pull first
#
# Database migrations do NOT deploy here — they apply when you push to main
# (CLAUDE.md §10.2).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP_DIR="$(dirname "$ROOT")"   # default: the parent of the checkout, e.g. /srv/humboldt
PULL=0
KEEP=5

usage() {
  cat <<EOF
Usage: $0 [options]

  --pull          git pull --ff-only before building
  --app-dir PATH  where releases/ and current live (default: $APP_DIR)
  --keep N        releases to retain                (default: $KEEP)
  -h, --help      this text
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull) PULL=1; shift ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$ROOT"
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

[[ -f apps/web/.env ]] || {
  echo "apps/web/.env is missing — run scripts/setup-server.sh first." >&2
  exit 1
}

# ── pull ────────────────────────────────────────────────────────────────────
UPLOAD_CHANGED=0
if [[ $PULL -eq 1 ]]; then
  step "Pull"
  BEFORE="$(git rev-parse HEAD)"
  git pull --ff-only
  AFTER="$(git rev-parse HEAD)"
  if [[ "$BEFORE" != "$AFTER" ]] && ! git diff --quiet "$BEFORE" "$AFTER" -- server/upload; then
    UPLOAD_CHANGED=1
  fi
fi

# ── build ───────────────────────────────────────────────────────────────────
step "Build"
# VITE_* values are inlined here, not read at runtime — that is why a config
# change needs a redeploy rather than a restart.
pnpm install --frozen-lockfile
pnpm build

[[ -f apps/web/dist/index.html ]] || { echo "build produced no dist/index.html" >&2; exit 1; }

# ── publish ─────────────────────────────────────────────────────────────────
step "Publish"
REL="$APP_DIR/releases/$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$REL"
cp -a apps/web/dist/. "$REL/"

# Two steps, because `ln -sfn` unlinks before it relinks and so has a window
# where `current` does not exist. `mv -T` is a single rename() and has none.
ln -s "$REL" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
echo "   current → $REL"

# ── prune ───────────────────────────────────────────────────────────────────
LIVE="$(readlink -f "$APP_DIR/current")"
mapfile -t OLD < <(find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n "+$((KEEP + 1))")
for d in "${OLD[@]:-}"; do
  [[ -n "$d" && "$(readlink -f "$d")" != "$LIVE" ]] || continue
  rm -rf "$d"
  echo "   pruned $d"
done

# ── upload service ──────────────────────────────────────────────────────────
if [[ $UPLOAD_CHANGED -eq 1 ]]; then
  step "Upload service"
  echo "   server/upload changed — restarting"
  sudo systemctl restart humboldt-upload || systemctl restart humboldt-upload
fi

step "Done"
cat <<EOF
   Released: $REL
   Verify:   ./scripts/doctor.sh

   Reminder: database migrations deploy separately, by pushing to main.
EOF
