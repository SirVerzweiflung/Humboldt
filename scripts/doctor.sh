#!/usr/bin/env bash
# Health check for a deployed Humboldt box. Run it after setup and after every
# deploy, and as the first item on the pre-quiz checklist.
#
# Every check runs even if an earlier one fails — a single FAIL line is far more
# useful next to the eight that passed. Exit code is non-zero if anything failed.
#
#   ./scripts/doctor.sh
#   ./scripts/doctor.sh --port 9090 --skip-caddy
#
# Deliberately NOT using `set -e`: it would stop at the first failure.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE=/etc/humboldt/upload.env
SITE_ENV=/etc/humboldt/site.env
SKIP_CADDY=0

# Defaults come from what setup-server.sh actually deployed, NOT from a constant
# in this file. A health check that invents its own port tests an address nobody
# is serving and reports failures about nothing — which is exactly what happened
# on the first real deploy, where the site was on 20261 and this script probed
# 8080.
site_value() { [[ -f "$SITE_ENV" ]] && sed -n "s/^$1=//p" "$SITE_ENV" | head -1 || true; }
PORT="$(site_value SITE_PORT)"; PORT="${PORT:-8080}"
BIND="$(site_value SITE_BIND)"; BIND="${BIND:-0.0.0.0}"
APP_DIR="$(site_value SITE_APP_DIR)"; APP_DIR="${APP_DIR:-$(dirname "$ROOT")}"

usage() {
  cat <<EOF
Usage: $0 [options]

  --port N        port the site is served on   (default: $PORT, from $SITE_ENV)
  --app-dir PATH  where current/ lives         (default: $APP_DIR)
  --env-file PATH upload service env file      (default: $ENV_FILE)
  --skip-caddy    skip the Caddy checks
  -h, --help      this text

Port, bind address and app dir are read from $SITE_ENV, which
setup-server.sh writes, so they cannot drift from the real deployment.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --skip-caddy) SKIP_CADDY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

BASE="http://127.0.0.1:$PORT"
WEB_ENV="$ROOT/apps/web/.env"
CURRENT="$APP_DIR/current"
FAILED=0

pass() { printf '  \033[1mPASS\033[0m  %s\n' "$*"; }
fail() { printf '  \033[1mFAIL\033[0m  %s\n' "$*"; FAILED=$((FAILED + 1)); }
skip() { printf '  ....  %s\n' "$*"; }

read_env() { [[ -f "$2" ]] && sed -n "s/^$1=//p" "$2" | head -1 || true; }

echo "Humboldt doctor — $BASE (bind $BIND), releases in $APP_DIR"
echo

# 1 ── client env completeness
missing=""
for k in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_TURNSTILE_SITE_KEY VITE_UPLOAD_TOKEN; do
  [[ -n "$(read_env "$k" "$WEB_ENV")" ]] || missing="$missing $k"
done
if [[ -z "$missing" ]]; then pass "apps/web/.env has all four VITE_ values"
else fail "apps/web/.env missing:$missing"; fi

# 2 ── the token in the LIVE BUNDLE matches the server's
# This is the one that bites: the client half is inlined at build time, so
# rotating the token in only one place leaves uploads failing with a 401 until
# somebody rebuilds.
srv_token="$(read_env UPLOAD_TOKEN "$ENV_FILE")"
if [[ -z "$srv_token" ]]; then
  fail "no UPLOAD_TOKEN in $ENV_FILE"
elif [[ ! -d "$CURRENT/assets" ]]; then
  fail "no live release at $CURRENT — run ./scripts/deploy.sh"
elif grep -rqF "$srv_token" "$CURRENT/assets"; then
  pass "upload token in the live bundle matches $ENV_FILE"
else
  fail "upload token MISMATCH: $ENV_FILE differs from the built bundle — rebuild with ./scripts/deploy.sh"
fi

# 3 ── upload service
if systemctl is-active --quiet humboldt-upload; then pass "humboldt-upload is active"
else fail "humboldt-upload is not active — journalctl -u humboldt-upload -n 30"; fi

# 4 ── caddy
if [[ $SKIP_CADDY -eq 1 ]]; then
  skip "Caddy checks skipped"
else
  if systemctl is-active --quiet caddy; then pass "caddy is active"
  else fail "caddy is not active"; fi

  # `caddy validate` is NOT sufficient and gives a dangerously reassuring PASS:
  # a Caddyfile whose import glob matches nothing validates perfectly and serves
  # no site at all. Only the ADAPTED config proves our site is really loaded.
  adapted="$(caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null)"
  if [[ -z "$adapted" ]]; then
    fail "could not adapt /etc/caddy/Caddyfile — invalid config, or unreadable as this user (try sudo)"
  elif grep -qF ":$PORT\"" <<<"$adapted"; then
    pass "caddy config has the Humboldt site on :$PORT"
  else
    fail "caddy has NO site on :$PORT — is the import in /etc/caddy/Caddyfile an ABSOLUTE path? A relative import glob silently matches nothing."
  fi
fi

# 5 ── the app shell
body="$(curl -fsS --max-time 5 "$BASE/board" 2>/dev/null)"
if [[ -n "$body" && "$body" == *'<div id="root">'* ]]; then pass "GET /board serves the app shell"
else fail "GET /board did not return the app shell"; fi

# 6 ── map assets
# A status check is worthless here: the SPA fallback answers a MISSING file with
# 200 and index.html, so we look at the body. This exact trap has bitten before.
geo="$(curl -fsS --max-time 5 "$BASE/geo/manifest.json" 2>/dev/null)"
if [[ "$(printf '%s' "$geo" | tr -d '[:space:]' | cut -c1)" == "{" ]]; then
  pass "GET /geo/manifest.json is real JSON"
else
  fail "GET /geo/manifest.json returned HTML (SPA fallback) — is geo/ in the release?"
fi

# 7 ── upload endpoint reachable AND still token-gated
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST \
        -H 'Content-Type: image/webp' --data-binary '' "$BASE/api/upload?quiz=doctor" 2>/dev/null)"
case "$code" in
  401) pass "POST /api/upload rejects an unauthenticated write (401)" ;;
  000) fail "POST /api/upload unreachable — is Caddy proxying to the upload service?" ;;
  200) fail "POST /api/upload accepted an UNAUTHENTICATED write — the token gate is off" ;;
  *)   fail "POST /api/upload returned $code, expected 401" ;;
esac

# 8 ── supabase
supa_url="$(read_env VITE_SUPABASE_URL "$WEB_ENV")"
supa_key="$(read_env VITE_SUPABASE_ANON_KEY "$WEB_ENV")"
if [[ -z "$supa_url" || -z "$supa_key" ]]; then
  fail "cannot reach Supabase: URL or anon key missing from apps/web/.env"
else
  # One probe covers both reachability and migration state. Note that
  # /rest/v1/ itself answers 401 to the anon key by design, so it is useless as
  # a liveness check — calling a real RPC is the honest test.
  #
  # The argument is six dashes: room codes are alphanumeric, so this can never
  # match a real room. The call can only raise, never mutate.
  rpc="$(curl -s --max-time 8 -X POST \
         -H "apikey: $supa_key" -H "Content-Type: application/json" \
         -d '{"p_room_code":"------"}' "$supa_url/rest/v1/rpc/start_quiz" 2>/dev/null)"
  if [[ -z "$rpc" ]]; then
    fail "Supabase unreachable — project paused? (free tier pauses after 7 idle days)"
  elif [[ "$rpc" == *"PGRST202"* || "$rpc" == *"Could not find the function"* ]]; then
    fail "RPC start_quiz is not deployed — push migrations to main, wait ~30s, retry"
  elif [[ "$rpc" == *"no such room"* ]]; then
    # The function ran and rejected the argument: deployed and reachable.
    pass "Supabase reachable and RPC start_quiz is deployed"
  else
    fail "unexpected Supabase response: ${rpc:0:160}"
  fi
fi

# 9 ── the release itself
if [[ ! -L "$CURRENT" ]]; then
  fail "$CURRENT is not a symlink — run ./scripts/deploy.sh"
else
  target="$(readlink -f "$CURRENT")"
  ok=1
  for f in index.html assets geo; do [[ -e "$target/$f" ]] || ok=0; done
  if [[ $ok -eq 1 ]]; then pass "release $target has index.html, assets/ and geo/"
  else fail "release $target is incomplete (want index.html, assets/, geo/)"; fi
fi

# 10 ── reachable from anywhere but this machine?
# Every check above talks to 127.0.0.1, so they all pass on a loopback-only bind
# while no phone and no off-box tunnel can reach the app at all. Say so plainly.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ "$BIND" == "0.0.0.0" || -z "$BIND" ]]; then
  if [[ -n "$LAN_IP" ]] && curl -fsS --max-time 5 -o /dev/null "http://$LAN_IP:$PORT/board" 2>/dev/null; then
    pass "reachable off-box at http://$LAN_IP:$PORT"
  elif [[ -n "$LAN_IP" ]]; then
    fail "http://$LAN_IP:$PORT is not reachable — firewall on $PORT?"
  else
    skip "no LAN address detected; cannot test off-box reachability"
  fi
else
  fail "bound to $BIND only — no phone and no off-box tunnel can reach this. Re-run setup-server.sh with --bind 0.0.0.0"
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "All checks passed."
  [[ -n "$LAN_IP" ]] && echo "Players: http://$LAN_IP:$PORT/   ·   Board: http://$LAN_IP:$PORT/board"
else
  echo "$FAILED check(s) failed."
fi
exit $((FAILED > 0))
