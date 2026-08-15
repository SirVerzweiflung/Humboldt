#!/usr/bin/env bash
# One-time (but safely repeatable) server install for Humboldt on Debian.
#
# Everything here PROBES BEFORE ACTING: anything already present is reported and
# skipped, so re-running after a reboot, a port change or a key rotation is the
# normal way to use this, not a risk.
#
# What it does NOT do, on purpose:
#   - no TLS, no tunnel, no DNS. The app serves plain HTTP on 127.0.0.1:<port>
#     and you point whatever you already run (cloudflared, nginx, …) at it.
#   - no database work. Migrations deploy by pushing to main (CLAUDE.md §10.2).
#
#   sudo ./scripts/setup-server.sh
#   sudo ./scripts/setup-server.sh --port 9090 --skip-caddy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── defaults ────────────────────────────────────────────────────────────────
PORT=8080
# All interfaces by default: the tunnel or reverse proxy that fronts this app
# often runs on a DIFFERENT machine, and loopback-only silently locks it out —
# along with every phone on the LAN during a pre-event test.
BIND=0.0.0.0
UPLOAD_PORT=8787
APP_DIR=/srv/humboldt
UPLOAD_DIR=/var/lib/humboldt/uploads
SERVICE_USER=humboldt
SKIP_PACKAGES=0
SKIP_CADDY=0
SKIP_USER=0
NON_INTERACTIVE=0

ENV_FILE=/etc/humboldt/upload.env
SITE_ENV=/etc/humboldt/site.env
UNIT_FILE=/etc/systemd/system/humboldt-upload.service
CADDY_SNIPPET=/etc/caddy/conf.d/humboldt.caddyfile
CADDY_MAIN=/etc/caddy/Caddyfile

usage() {
  cat <<EOF
Usage: sudo $0 [options]

  --port N            HTTP port the site listens on                (default: $PORT)
  --bind ADDR         interface to listen on; 0.0.0.0 = all        (default: $BIND)
                      use 127.0.0.1 only if your tunnel runs on THIS machine
  --upload-port N     port for the image upload service          (default: $UPLOAD_PORT)
  --app-dir PATH      checkout + releases live here              (default: $APP_DIR)
  --upload-dir PATH   uploaded images live here                  (default: $UPLOAD_DIR)
  --user NAME         system user that runs the service          (default: $SERVICE_USER)
  --skip-packages     do not install Node / pnpm / Caddy
  --skip-caddy        do not touch Caddy at all (you front the app yourself)
  --skip-user         do not create the system user
  --non-interactive   take VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
                      VITE_TURNSTILE_SITE_KEY from the environment; fail if unset
  -h, --help          this text

Re-running is safe: existing values, tokens and files are kept.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --upload-port) UPLOAD_PORT="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --upload-dir) UPLOAD_DIR="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --skip-packages) SKIP_PACKAGES=1; shift ;;
    --skip-caddy) SKIP_CADDY=1; shift ;;
    --skip-user) SKIP_USER=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ── output helpers ──────────────────────────────────────────────────────────
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
does()  { printf '   installing  %s\n' "$*"; }
skip()  { printf '   present     %s — skipping\n' "$*"; }
note()  { printf '   %s\n' "$*"; }
die()   { printf '\n\033[1mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run this with sudo — it writes to /etc and creates a system user."

# ── packages ────────────────────────────────────────────────────────────────
step "Packages"
if [[ $SKIP_PACKAGES -eq 1 ]]; then
  note "--skip-packages given"
else
  apt-get update -qq

  for p in curl git ca-certificates gnupg openssl; do
    if dpkg -s "$p" >/dev/null 2>&1; then skip "$p"; else does "$p"; apt-get install -y -qq "$p"; fi
  done

  # Debian's own nodejs is usually too old for Vite 5, which wants >= 20.
  node_major=0
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'process.versions.node.split(".")[0]')"
  fi
  if [[ "$node_major" -ge 20 ]]; then
    skip "node $(node -v)"
  else
    does "Node 22 (found: ${node_major:-none}, need >= 20)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  fi

  # pnpm 10: the repo's package.json relies on pnpm.onlyBuiltDependencies.
  if command -v pnpm >/dev/null 2>&1; then
    skip "pnpm $(pnpm -v)"
  else
    does "pnpm 10"
    npm install -g --silent pnpm@10
  fi

  if [[ $SKIP_CADDY -eq 1 ]]; then
    note "--skip-caddy given, not installing Caddy"
  elif command -v caddy >/dev/null 2>&1; then
    skip "caddy $(caddy version | head -1)"
  else
    does "caddy"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  fi
fi

# ── user and directories ────────────────────────────────────────────────────
step "User and directories"
if [[ $SKIP_USER -eq 1 ]]; then
  note "--skip-user given"
elif id -u "$SERVICE_USER" >/dev/null 2>&1; then
  skip "user $SERVICE_USER"
else
  does "user $SERVICE_USER"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

for d in "$APP_DIR" "$APP_DIR/releases" "$UPLOAD_DIR" /etc/humboldt; do
  if [[ -d "$d" ]]; then skip "$d"; else does "$d"; mkdir -p "$d"; fi
done
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR" "$UPLOAD_DIR"

# ── the checkout ────────────────────────────────────────────────────────────
step "Checkout"
REPO_DIR="$APP_DIR/repo"
if [[ -d "$REPO_DIR/.git" ]]; then
  skip "$REPO_DIR"
elif [[ "$ROOT" != "$REPO_DIR" ]]; then
  does "copy of this checkout → $REPO_DIR"
  mkdir -p "$REPO_DIR"
  # Preserve the git metadata so deploy.sh --pull works later.
  cp -a "$ROOT/." "$REPO_DIR/"
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$REPO_DIR"
else
  skip "$REPO_DIR (running from it)"
fi

# ── secrets and client env ──────────────────────────────────────────────────
step "Configuration"
WEB_ENV="$REPO_DIR/apps/web/.env"

# Read an existing value out of a KEY=value file, so a re-run offers it as the
# default instead of forcing the operator to dig the key out again.
read_env() { [[ -f "$2" ]] && sed -n "s/^$1=//p" "$2" | head -1 || true; }

ask() { # ask VAR_NAME "prompt" existing_value
  local var="$1" prompt="$2" existing="$3" answer=""
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    answer="${!var:-$existing}"
    [[ -n "$answer" ]] || die "--non-interactive: $var is not set in the environment"
  elif [[ -n "$existing" ]]; then
    read -r -p "   $prompt [keep current] " answer || true
    answer="${answer:-$existing}"
  else
    while [[ -z "$answer" ]]; do read -r -p "   $prompt " answer || true; done
  fi
  printf '%s' "$answer"
}

SUPA_URL="$(ask VITE_SUPABASE_URL      'Supabase project URL (https://<ref>.supabase.co):' "$(read_env VITE_SUPABASE_URL "$WEB_ENV")")"
SUPA_ANON="$(ask VITE_SUPABASE_ANON_KEY 'Supabase anon public key:'                        "$(read_env VITE_SUPABASE_ANON_KEY "$WEB_ENV")")"
TURNSTILE="$(ask VITE_TURNSTILE_SITE_KEY 'Cloudflare Turnstile SITE key:'                  "$(read_env VITE_TURNSTILE_SITE_KEY "$WEB_ENV")")"

# The upload token is generated once and then preserved forever: rotating it
# silently would break image uploads until the next rebuild, because the client
# half is inlined into the bundle at build time.
UPLOAD_TOKEN="$(read_env UPLOAD_TOKEN "$ENV_FILE")"
if [[ -n "$UPLOAD_TOKEN" ]]; then
  skip "UPLOAD_TOKEN (keeping the existing one)"
else
  does "UPLOAD_TOKEN"
  UPLOAD_TOKEN="$(openssl rand -hex 32)"
fi

does "$WEB_ENV"
cat >"$WEB_ENV" <<EOF
# Written by scripts/setup-server.sh. Gitignored. These are inlined into the
# bundle at BUILD time, so changing them means re-running ./scripts/deploy.sh.
VITE_SUPABASE_URL=$SUPA_URL
VITE_SUPABASE_ANON_KEY=$SUPA_ANON
VITE_TURNSTILE_SITE_KEY=$TURNSTILE
VITE_UPLOAD_TOKEN=$UPLOAD_TOKEN
EOF
chown "$SERVICE_USER":"$SERVICE_USER" "$WEB_ENV"
chmod 640 "$WEB_ENV"

# Where the site is served. Persisted so doctor.sh and later re-runs never have
# to be told again — a health check with its own default port will happily test
# the wrong address and report PASS about nothing.
does "$SITE_ENV"
cat >"$SITE_ENV" <<EOF
# Written by scripts/setup-server.sh. Read by scripts/doctor.sh.
SITE_PORT=$PORT
SITE_BIND=$BIND
SITE_APP_DIR=$APP_DIR
EOF
chmod 644 "$SITE_ENV"

does "$ENV_FILE"
cat >"$ENV_FILE" <<EOF
# Written by scripts/setup-server.sh. UPLOAD_TOKEN must equal VITE_UPLOAD_TOKEN
# in apps/web/.env — scripts/doctor.sh checks exactly that.
UPLOAD_TOKEN=$UPLOAD_TOKEN
UPLOAD_PORT=$UPLOAD_PORT
UPLOAD_DIR=$UPLOAD_DIR
EOF
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# ── systemd ─────────────────────────────────────────────────────────────────
step "Upload service"
does "$UNIT_FILE"
sed -e "s|__USER__|$SERVICE_USER|g" \
    -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__UPLOAD_DIR__|$UPLOAD_DIR|g" \
    "$ROOT/deploy/humboldt-upload.service.tpl" >"$UNIT_FILE"
systemctl daemon-reload
systemctl enable --now humboldt-upload >/dev/null 2>&1 || true
systemctl restart humboldt-upload
if systemctl is-active --quiet humboldt-upload; then
  note "humboldt-upload is active on :$UPLOAD_PORT"
else
  die "humboldt-upload failed to start — journalctl -u humboldt-upload -n 30"
fi

# ── caddy ───────────────────────────────────────────────────────────────────
step "Caddy"
if [[ $SKIP_CADDY -eq 1 ]]; then
  note "--skip-caddy given. Serve $APP_DIR/current yourself, proxy /api/upload"
  note "to 127.0.0.1:$UPLOAD_PORT, and serve /uploads from $UPLOAD_DIR."
else
  mkdir -p "$(dirname "$CADDY_SNIPPET")"
  does "$CADDY_SNIPPET"
  # 0.0.0.0 means "every interface", which in Caddy is expressed by omitting the
  # bind directive entirely rather than by naming the wildcard.
  if [[ "$BIND" == "0.0.0.0" || -z "$BIND" ]]; then
    BIND_SED='/__BIND_LINE__/d'
  else
    BIND_SED="s|__BIND_LINE__|bind $BIND|"
  fi
  sed -e "s|__PORT__|$PORT|g" \
      -e "s|__UPLOAD_PORT__|$UPLOAD_PORT|g" \
      -e "s|__UPLOAD_DIR__|$UPLOAD_DIR|g" \
      -e "s|__CURRENT__|$APP_DIR/current|g" \
      -e "$BIND_SED" \
      "$ROOT/deploy/humboldt.caddyfile.tpl" >"$CADDY_SNIPPET"

  # Additive on purpose: this box may already serve other sites, and silently
  # replacing the main Caddyfile would take them down.
  #
  # CONSTRAINT The import path must be ABSOLUTE. Caddy resolves a relative
  # import glob against the caddy process's working directory — not against the
  # Caddyfile's own directory — and Debian's unit sets no WorkingDirectory. A
  # glob that matches nothing is then silently ignored: no error, no warning,
  # `caddy validate` still passes, and the site simply never loads.
  CADDY_IMPORT="import $(dirname "$CADDY_SNIPPET")/*.caddyfile"
  touch "$CADDY_MAIN"

  # Repair the relative line written by earlier versions of this script.
  if grep -q '^import conf\.d/\*\.caddyfile$' "$CADDY_MAIN"; then
    does "repairing relative import line in $CADDY_MAIN (it matched no files)"
    sed -i "s|^import conf\.d/\*\.caddyfile$|$CADDY_IMPORT|" "$CADDY_MAIN"
  fi

  if grep -qF "$CADDY_IMPORT" "$CADDY_MAIN"; then
    skip "import line in $CADDY_MAIN"
  else
    does "import line in $CADDY_MAIN"
    printf '\n# Added by Humboldt scripts/setup-server.sh\n%s\n' "$CADDY_IMPORT" >>"$CADDY_MAIN"
  fi

  # Adapt, don't just validate: validate passes on a config that imports
  # nothing. Only the adapted output proves the site is really there.
  if ! caddy adapt --config "$CADDY_MAIN" 2>/dev/null | grep -qF ":$PORT\""; then
    caddy validate --config "$CADDY_MAIN" || true
    die "Caddy config has no site on :$PORT — is $CADDY_SNIPPET imported by $CADDY_MAIN?"
  fi
  note "caddy config contains the site on :$PORT"
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
fi

# ── done ────────────────────────────────────────────────────────────────────
step "Done"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ "$BIND" == "0.0.0.0" || -z "$BIND" ]]; then
  cat <<EOF
   Humboldt serves plain HTTP on port $PORT, on every interface:
     http://127.0.0.1:$PORT          (this machine)
     http://${LAN_IP:-<lan-ip>}:$PORT          (LAN — phones, and a tunnel on another host)

   Point your tunnel or reverse proxy at whichever of those it can reach.
   TLS is terminated there, not here — this is plain HTTP on your LAN.
EOF
else
  cat <<EOF
   Humboldt serves plain HTTP on http://$BIND:$PORT only.
   Anything not on this machine — including a tunnel running elsewhere — cannot
   reach it. Re-run with --bind 0.0.0.0 if that is not what you want.
EOF
fi
cat <<EOF

   Next:
     cd $REPO_DIR
     sudo -u $SERVICE_USER ./scripts/deploy.sh     # build + publish a release
     ./scripts/doctor.sh                           # verify (reads $SITE_ENV)
EOF
