# Humboldt

A moderated, **host-driven map quiz** for a live event. The moderator asks "Where is Rome?";
participants tap a point on a near-empty map (or on a picture); the moderator reveals the submitted
pins one at a time on a big screen, drops the real solution, and awards points by hand.

Open `/` on any device and pick a role:

| Route | Device | Role |
|---|---|---|
| `/` | anything | Role chooser. Also where the app offers to install itself. |
| `/play` | Phone (portrait) | Join by room code + nickname, place one pin, submit. |
| `/host` | Tablet (landscape) | Control surface: attach a quiz, open/close answering, reveal pins, drop the solution, award points. |
| `/board` | Laptop → TV/beamer | Read-only projection: question, answer count, revealed pins, distances, leaderboard. |
| `/quiz` | anything | Quiz editor, reached from `/host`. Quizzes live in the DB under a long secret **quizcode**. |

[`CLAUDE.md`](CLAUDE.md) is the canonical architecture document. This README is the operator's
guide.

> This repository is public, but it is not a turnkey product — it is one person's quiz app, and it
> assumes you will supply your own Supabase project, your own domain and your own tunnel. What it
> does guarantee is that **you can rebuild the whole thing from these instructions after forgetting
> every detail.**

---

## Local development

Requires **Node 20+** and **pnpm 10**.

```bash
git clone https://github.com/SirVerzweiflung/Humboldt.git
cd Humboldt
pnpm install
cp apps/web/.env.example apps/web/.env    # fill it in — see "Environment" below
./scripts/start.sh                        # Vite :5173 + upload service :8787, detached
./scripts/stop.sh
```

Open <http://localhost:5173/>. `start.sh` binds Vite to `0.0.0.0`, so phones on the same LAN reach
it at `http://<your-lan-ip>:5173/`.

For local dev, use Cloudflare's always-pass Turnstile test site key `1x00000000000000000000AA` and
any random string for `VITE_UPLOAD_TOKEN` — `start.sh` copies it into the upload service's
`UPLOAD_TOKEN` so both halves always match.

---

## Server install

### What you need first

1. **A Supabase project** (free tier is fine). Note the project ref.
   - Apply the migrations in [`supabase/migrations/`](supabase/migrations/): connect the repo under
     **Project Settings → Integrations → GitHub** and enable "Deploy to production", after which
     every push to `main` applies new migrations. Or once, from a dev machine:
     `npx supabase link --project-ref <REF> && npx supabase db push`.
   - **Auth → Providers**: enable **Anonymous sign-ins**.
   - **Auth → Attack Protection**: enable CAPTCHA with provider **Cloudflare Turnstile** and paste
     the Turnstile *secret* key.
   - **Settings → API**: copy the **Project URL** and the **`anon` `public`** key.
   The `service_role` key is never used by this project. Keep it off the box entirely.
2. **A Cloudflare Turnstile widget.** Add your public hostname to its hostname list. The *site* key
   goes on the server; the *secret* key goes in Supabase, above.
3. **A Debian box** (12 or 13) and some way to expose it — a Cloudflare Tunnel, nginx, whatever you
   already run.

### Three commands

```bash
git clone https://github.com/SirVerzweiflung/Humboldt.git
cd Humboldt

sudo ./scripts/setup-server.sh     # packages, user, dirs, secrets, systemd, Caddy
./scripts/deploy.sh                # build and publish a release
./scripts/doctor.sh                # verify the whole stack
```

`setup-server.sh` asks for the three values it cannot derive (Supabase URL, Supabase anon key,
Turnstile site key), generates the upload token itself, and prints `present — skipping` for anything
already installed. **Re-running it is the intended way** to change the port or update a key.

`doctor.sh` prints one `PASS`/`FAIL` line per check and exits non-zero if any failed. Run it after
every deploy and as the first item on the pre-quiz checklist.

### Exposing it

The app serves **plain HTTP on `127.0.0.1:8080`** (change with `--port`). TLS, DNS and tunnelling are
deliberately outside these scripts — point whatever you already run at that address.

For a Cloudflare Tunnel that means an ingress rule like:

```yaml
ingress:
  - hostname: quiz.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

TLS terminates at Cloudflare's edge, which also satisfies the secure-context requirement for the
Wake Lock API and the service worker. Realtime traffic goes browser → Supabase directly and never
rides the tunnel, so tunnel restarts cannot desync a game.

### What the scripts install

```
/srv/humboldt/repo/            the checkout; builds happen here
/srv/humboldt/releases/<ts>/   one directory per deploy
/srv/humboldt/current  ────→   symlink to the live release (swapped atomically)
/var/lib/humboldt/uploads/     quiz images
/etc/humboldt/upload.env       UPLOAD_TOKEN etc. (root:humboldt, 0640)
/etc/systemd/system/humboldt-upload.service
/etc/caddy/conf.d/humboldt.caddyfile
```

Caddy integration is **additive**: the script drops a snippet into `conf.d/` and adds an `import`
line to the main Caddyfile only if it is missing, so a box already serving other sites is not
disturbed. Use `--skip-caddy` if you front the app with something else; the script then prints what
your web server has to do.

The built map assets (`public/geo/`, content-hashed TopoJSON) are committed, so a server install
never runs the Natural Earth pipeline. Regenerate them only if you change presets — see
[`tools/geo/MAP_CREATION.md`](tools/geo/MAP_CREATION.md).

### Script options

```
setup-server.sh  --port N  --upload-port N  --app-dir PATH  --upload-dir PATH  --user NAME
                 --skip-packages  --skip-caddy  --skip-user  --non-interactive
deploy.sh        --pull  --app-dir PATH  --keep N
doctor.sh        --port N  --app-dir PATH  --env-file PATH  --skip-caddy
```

`--non-interactive` reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
`VITE_TURNSTILE_SITE_KEY` from the environment and fails loudly if one is missing.

---

## Updating

```bash
cd /srv/humboldt/repo
./scripts/deploy.sh --pull
./scripts/doctor.sh
```

Each build lands in a new release directory and `current` is repointed with a rename, so there is no
instant where a player can load a half-written app. Rolling back is the same swap aimed at an older
directory in `releases/`; `deploy.sh` keeps the last five.

**Database changes deploy separately** — migrations apply when you push to `main`. Never edit a
migration that has already been applied; add a new numbered one. Deploy lag is roughly 10–60 s, and
`doctor.sh` will tell you whether an RPC actually landed.

---

## Environment

Client, `apps/web/.env`, gitignored, **inlined at build time**:

| Var | Source | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL | yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` | yes |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile → widget → Site Key | yes |
| `VITE_UPLOAD_TOKEN` | generated by `setup-server.sh`; must equal the server's `UPLOAD_TOKEN` | yes |

Server, `/etc/humboldt/upload.env`, **read at runtime**:

| Var | Default | Meaning |
|---|---|---|
| `UPLOAD_TOKEN` | none — the service refuses to start without it | shared secret with the client |
| `UPLOAD_PORT` | `8787` | listen port |
| `UPLOAD_DIR` | `<repo>/public/uploads` | where images are written |

Because the client half is baked into the bundle, **changing any `VITE_` value requires a redeploy,
not a restart.** `VITE_UPLOAD_TOKEN` necessarily ships to the browser: it is a spam gate that stops
the public origin being used to fill your disk, not authentication. Only vars prefixed `VITE_` reach
the bundle — that prefix is exactly what would leak a secret, so never apply it to one.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/geo/*.topo.json` "loads" but `JSON.parse` fails | The SPA fallback answered with `index.html` and a **200**. Check the body, not the status — `doctor.sh` does exactly this. |
| Blank page, console: "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY" | `.env` was empty or filled in *after* the build. Redeploy — these are inlined at build time. |
| Turnstile never passes | The widget's hostname list omits your domain, or Supabase Auth has a different/blank Turnstile secret. |
| Image upload returns 401 | `VITE_UPLOAD_TOKEN` in the built bundle no longer matches `/etc/humboldt/upload.env`. `doctor.sh` check 2 catches this. Redeploy after changing either. |
| Image upload returns 502 | `journalctl -u humboldt-upload -n 50`. |
| Uploaded image 404s on the board | Caddy's `handle_path /uploads/*` block is missing or points at the wrong directory. It must serve the live upload dir, never the release. |
| No **Install app** button | Chrome needs a registered service worker, HTTPS and a manifest. Dev builds register no worker by design. iOS never shows a button — use Share → Add to Home Screen. |
| Chip shows `may dim` | The OS refused the wake lock (power saver, low battery) or the browser has no Wake Lock API. Set the device's auto-lock to Never as a fallback. |
| Everything errored overnight | The Supabase project auto-paused after 7 idle days. Restore it from the dashboard. |
| `pnpm install` fails on build scripts | Needs pnpm 10 with `pnpm.onlyBuiltDependencies: ["esbuild"]` (already in `package.json`). |
| Host tablet locked and the room looks stuck | Expected. The DB holds the truth; unlocking triggers a resync. If the tab is gone, open `/host` anywhere and rejoin by room code. |

Logs: `journalctl -u humboldt-upload -f`, `journalctl -u caddy -f`.

---

## Pre-event checklist

1. Restore the Supabase project if it has paused (7-day rule).
2. `./scripts/doctor.sh` — expect all checks to pass.
3. Open the Board, go fullscreen, confirm the room code and QR sit inside a 5 % safe inset (some TVs
   crop the edges over HDMI) and that the status chip reads **live / awake**.
4. Set the host tablet to never auto-lock; confirm its chip also reads **awake**.
5. Have the quizcode ready; create the room, attach the quiz, step through the questions once.
6. Confirm one phone can join, submit, and see a reveal.

---

## Licence

MIT — see [`LICENSE`](LICENSE). Map data from [Natural Earth](https://www.naturalearthdata.com/)
(public domain).
