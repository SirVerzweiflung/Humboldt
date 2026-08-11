# Design — Landing page, PWA, wake locks, and a streamlined deployment pipeline

Date: 2026-08-11
Status: approved
Covers: CLAUDE.md §13 build order, step 9 — minus visual polish, which the operator will do
separately while testing with real players.

## Goal

Close the last functional gaps before the app is usable at a real event by someone who has forgotten
the details:

1. A role chooser at `/` so a visitor picks Host / Player / Board without typing a path.
2. An installable PWA, with the install affordance on that chooser.
3. Screen wake locks on all three play surfaces, with a visible status chip so the pre-event
   checklist can actually verify them.
4. A server setup and deployment pipeline that is three commands, not ten manual steps.

Non-goals: visual polish, results export, freezing `answers.distance` in the DB, removing the unused
`dummy_pings` table, quiz import. These stay open.

## Constraints carried in

- Strict five-colour palette plus white text (CLAUDE.md §15). Dark text is always `gunmetal`.
- The repo is public. Nothing secret may land in it; every secret is prompted for at setup time and
  written outside the checkout (or into the gitignored `apps/web/.env`).
- `VITE_*` values are inlined at build time, so any change to them requires a rebuild, not a
  restart.
- Vite's `publicDir` is repo-root `public/`, not `apps/web/public/`.
- The SPA fallback answers unknown paths with `index.html` and HTTP 200, so status codes alone
  cannot prove an asset exists.
- Supabase migrations deploy by pushing to `main`; there is no local database.
- The upload service refuses to start without `UPLOAD_TOKEN`.

---

## 1. Landing page and the auth boundary

### Problem

`main.tsx` wraps the entire router in `<AuthGate>`, so the Turnstile captcha runs before anything
renders, including a page that needs no Supabase session. `/` merely redirects to `/board`.

### Design

Move `<BrowserRouter>` outside `<AuthGate>` and gate each role route individually.

```
/        Landing    ungated — no Supabase call, no captcha
/play    gated      AuthGate → Play
/host    gated      AuthGate → Host
/board   gated      AuthGate → Board
/quiz    gated      AuthGate → QuizPage
```

A small `<Gated>` wrapper keeps `main.tsx` readable. `AuthGate` itself is unchanged.

`routes/landing/Landing.tsx`: `gunmetal` background, the app title, and three large links —
**Host** (`bg-pacific`), **Player** (`bg-palm`), **Board** (`bg-white/20`), each with a one-line
description. `/quiz` is deliberately absent; it is reached from the Host screen only.

The install affordance (section 2) renders at the bottom of this page.

### Consequences

- The QR deep link `/play?room=CODE` is untouched.
- The captcha now appears when a role is chosen rather than on arrival.
- The landing route is not lazy-loaded — it is tiny and it is the first paint.

---

## 2. PWA

### Files

| Path | Purpose |
|---|---|
| `public/manifest.webmanifest` | `name` "Map Quiz", `short_name` "MapQuiz", `start_url` `/`, `scope` `/`, `display` `standalone`, `theme_color` and `background_color` `#424242`, four icon entries |
| `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-180.png` | generated, committed |
| `tools/icons/build.mjs` | generator |
| `public/sw.js` | service worker |
| `apps/web/index.html` | head tags |
| `apps/web/src/lib/pwa.ts` | `useInstallPrompt()` and SW registration |

### Icon generator

`tools/icons/build.mjs` writes PNGs with Node's built-in `zlib` only — no image dependency, matching
the zero-dependency style of `server/upload`. It renders a **white letter "H" on a `pacific`
(`#5296a5`) field**, supersampled for smooth edges. The maskable variant insets the glyph to ~60 % of
the canvas so Android's mask cannot clip it.

Run with `node tools/icons/build.mjs`. Output is committed, so neither the server install nor CI ever
runs it.

### Service worker

Chrome will not fire `beforeinstallprompt` unless a service worker with a `fetch` handler is
registered. CLAUDE.md §11.6 warns that an aggressive service-worker cache is a quiz-night hazard, so
this worker **caches nothing**:

- `install` → `skipWaiting()`
- `activate` → `clients.claim()` and delete any cache this app may have created previously
- `fetch` → pass through to the network, no `respondWith` interception of navigations

It therefore cannot serve a stale shell. It is registered only when `import.meta.env.PROD`, so
`pnpm dev` never installs one.

Caddy must serve `/sw.js` and `/manifest.webmanifest` with `Cache-Control: no-cache` (section 4).

### Install hook

`useInstallPrompt()` returns:

```ts
{
  canInstall: boolean;      // a captured beforeinstallprompt event is pending
  promptInstall: () => Promise<void>;
  isIOS: boolean;
  isStandalone: boolean;    // display-mode: standalone, or navigator.standalone on iOS
}
```

Landing renders, in priority order:

1. `isStandalone` → nothing.
2. `canInstall` → an **Install app** button calling `promptInstall()`.
3. `isIOS` → the text hint "Add to Home Screen: tap Share, then *Add to Home Screen*."
4. Otherwise → nothing.

---

## 3. Wake lock and status chip

### `lib/wakeLock.ts`

```ts
type WakeState = 'held' | 'unsupported' | 'denied';
function useWakeLock(active: boolean): WakeState;
```

- Requests `navigator.wakeLock.request('screen')` when `active` becomes true.
- Re-acquires on `visibilitychange` → `visible` while `active` — mandatory, because the OS releases
  the sentinel every time the page hides.
- Releases and clears the sentinel when `active` goes false or on unmount.
- Every call is wrapped in `try/catch`; a rejection yields `'denied'` and no thrown error. Absent
  `navigator.wakeLock` yields `'unsupported'`.

### Connection state

`useRoom()` currently discards the `subscribe()` status callback. It gains a `connection` field:

```ts
type Connection = 'connected' | 'reconnecting' | 'offline';
```

- `offline` whenever `navigator.onLine` is false.
- `connected` when the channel status is `SUBSCRIBED`.
- `reconnecting` otherwise (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`, or not yet subscribed).

Resync behaviour is unchanged; this only surfaces state that was already there.

### `shared/StatusChip.tsx`

```tsx
<StatusChip connection={snap.connection} wake={wake} />
```

Both props optional, so a screen without a room can show the wake state alone. Rendering, strictly
palette:

| State | Render |
|---|---|
| connected | `● live`, `bg-white/20` |
| reconnecting | `● reconnecting`, `bg-wheat text-gunmetal` |
| offline | `● offline`, `bg-pink text-gunmetal` |
| wake held | `▣ awake` |
| wake denied/unsupported | `▢ screen may dim`, muted |

### Wiring (CLAUDE.md §11.1)

| Screen | `active` |
|---|---|
| Host | `true` for the whole session, lobby through ended |
| Board | `true` for the whole session |
| Player | `phase === 'answering'` only, to save phone battery |

Chip placement: Host header, Board corner (inside the 5 % overscan-safe inset), Play header.

---

## 4. Deployment pipeline

### Shape

```
deploy/humboldt-upload.service.tpl    systemd unit template
deploy/humboldt.caddyfile.tpl         Caddy site snippet template
scripts/setup-server.sh               idempotent one-time-ish install
scripts/deploy.sh                     build + atomic release swap
scripts/doctor.sh                     verification, one line per check
```

Templates use `__PLACEHOLDER__` tokens substituted by `setup-server.sh`. Existing `scripts/start.sh`
and `stop.sh` remain the local-development path and are not touched.

### Reverse-proxy contract

The application serves plain HTTP on `127.0.0.1:<port>`, default `8080`, configurable with
`--port`. TLS, the public hostname, and the tunnel are the operator's concern and out of scope for
these scripts. `cloudflared` is not installed or configured by anything in this repo; the README
states the contract in one line.

### `setup-server.sh`

Flags: `--port N`, `--app-dir PATH`, `--upload-dir PATH`, `--user NAME`, `--skip-packages`,
`--skip-caddy`, `--skip-user`, `--non-interactive`, `--help`.

It **probes before acting** and prints `already present — skipping` for each of: Node ≥ 20, pnpm,
Caddy, the service user, each directory, an existing `UPLOAD_TOKEN`, an existing systemd unit. Re-running
it is safe and is the intended way to change the port or rotate a key.

It prompts only for values it cannot derive — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_TURNSTILE_SITE_KEY` — showing the existing value as the default when one is already present.
`--non-interactive` takes the same values from the environment and fails loudly if any is missing.
`UPLOAD_TOKEN` is generated with `openssl rand -hex 32` on first run and preserved thereafter.

Writes:

- `apps/web/.env` (owner: service user; gitignored)
- `/etc/humboldt/upload.env` (`root:<user>`, mode `0640`)
- `/etc/systemd/system/humboldt-upload.service` from the template
- `/etc/caddy/conf.d/humboldt.caddyfile` from the template

**Caddy integration is additive.** Rather than replacing `/etc/caddy/Caddyfile`, it writes a snippet
into `conf.d/` and appends `import conf.d/*.caddyfile` to the main file only if that line is absent,
so a box already serving other sites is not stomped. `--skip-caddy` suppresses all of this for an
operator who fronts the app with nginx or something else.

Ends by printing the reverse-proxy contract line and the next command to run.

### `deploy.sh`

1. Optional `--pull`: `git pull --ff-only`.
2. `pnpm install --frozen-lockfile`, then `pnpm build`.
3. Copy `apps/web/dist/` to `releases/<UTC timestamp>/`.
4. `ln -s` to a temporary name, then `mv -T` onto `current` — an atomic rename, so no player ever
   loads a half-written app.
5. Prune all but the newest five releases.
6. Restart `humboldt-upload` only when `server/upload/` changed in the pulled commits.

Reports the release path and reminds that database migrations deploy separately by pushing to
`main`.

### `doctor.sh`

Ordered checks, each one `PASS`/`FAIL` on a single line, non-zero exit if any fails:

1. `apps/web/.env` contains all four `VITE_*` values, none empty.
2. **The `UPLOAD_TOKEN` in `/etc/humboldt/upload.env` appears verbatim in the live release's JS
   bundle.** This catches a token rotated in one place only — the single most likely upload failure.
3. `systemctl is-active humboldt-upload`.
4. `caddy validate` on the merged config, and `systemctl is-active caddy` (skipped with
   `--skip-caddy`).
5. `GET http://127.0.0.1:<port>/board` returns 200 and the body contains `<div id="root">`.
6. **`GET /geo/manifest.json` body's first non-whitespace character is `{`.** A status-code-only check
   is worthless here: the SPA fallback returns 200 with `index.html` for a missing asset.
7. `POST /api/upload` with no token returns **401** — proving the service is reachable *and* still
   token-gated.
8. Supabase REST reachable with the anon key, and one known RPC resolves rather than reporting
   "Could not find the function".
9. `current` symlink resolves to an existing directory containing `index.html`, `assets/`, and
   `geo/`.

### Caddy snippet

```caddyfile
:__PORT__ {
	bind 127.0.0.1

	handle_path /uploads/* {
		root * __UPLOAD_DIR__
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	handle /api/upload* {
		reverse_proxy 127.0.0.1:__UPLOAD_PORT__
	}

	handle {
		root * __CURRENT__
		encode zstd gzip

		@immutable path /assets/* /geo/*
		header @immutable Cache-Control "public, max-age=31536000, immutable"
		@nocache path /index.html /sw.js /manifest.webmanifest
		header @nocache Cache-Control "no-cache"

		try_files {path} /index.html
		file_server
	}
}
```

`/uploads/*` is matched before the SPA root, so images are always read from the live upload
directory and a stale copy inside a release can never shadow a fresh upload.

---

## 5. Documentation

- **README** restructured to: what you need (accounts and keys) → `sudo ./scripts/setup-server.sh` →
  `./scripts/deploy.sh` → `./scripts/doctor.sh` → updating → troubleshooting → pre-event checklist.
  The long manual walkthrough survives as an appendix for when a script fails. The `cloudflared`
  section shrinks to the contract line.
- **CLAUDE.md**, updated in the same commit as the code (the project's own rule):
  - §2 repo shape gains `deploy/`, `tools/icons/`, `src/routes/landing/`, and the new `lib` and
    `shared` modules.
  - §10.3 records the Caddy-snippet approach, the configurable port, and that the tunnel is out of
    scope for the repo's scripts.
  - §11.1 marks wake locks as built and names the hook.
  - §11.6 records that the PWA exists and states the no-cache service-worker policy.
  - §13 step 9 marked done except polish.

---

## 6. Testing and verification

The repo has no test harness today and adding one is out of scope here. Verification is therefore:

- `pnpm build` (`tsc -b && vite build`) must pass — this is the only automated gate for the frontend.
- `bash -n` on all three scripts, plus a `--help` run of each.
- `scripts/doctor.sh` is itself the runtime test for a deployed box.

Explicitly cannot be verified from this environment and must be tested by the operator: the install
prompt on a real Android and a real iPhone, wake-lock behaviour on a real tablet, and the full
setup script on a real Debian host. Any completion report must separate what was verified from what
was not.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Service worker causes a stale shell | It caches nothing and claims clients immediately; `/sw.js` is `no-cache`; dev never registers it |
| Moving `AuthGate` breaks an existing route | Each role route is individually wrapped; `AuthGate` itself is unmodified |
| `setup-server.sh` damages an existing Caddy install | Additive snippet plus a guarded `import`; never rewrites the main Caddyfile; `--skip-caddy` opt-out |
| Hand-rolled PNG encoder produces invalid files | Output verified by decoding with the browser and by checking the PNG signature and IHDR in the script's own self-check |
| Secrets leaking into a public repo | Nothing is written into the checkout except the gitignored `.env`; the token lives in `/etc` at `0640` |
