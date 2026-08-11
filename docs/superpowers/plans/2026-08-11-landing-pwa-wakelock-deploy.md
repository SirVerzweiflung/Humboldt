# Landing Page, PWA, Wake Locks and Deployment Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close CLAUDE.md §13 step 9 minus visual polish — a role chooser at `/`, an installable PWA, screen wake locks with a visible status chip, and a three-command Debian setup/deploy/verify pipeline.

**Architecture:** Four independent slices over the existing single Vite app. The frontend slices add small focused modules (`lib/wakeLock.ts`, `lib/pwa.ts`, `shared/StatusChip.tsx`, `routes/landing/`) and restructure the auth boundary in `main.tsx` so `/` renders ungated. The ops slice adds `deploy/` templates plus three shell scripts that probe before acting, leaving TLS and tunnelling to the operator.

**Tech Stack:** React 18 + TypeScript + Vite 5, Tailwind, Supabase JS, Node 22 (zero-dep scripts), bash, systemd, Caddy.

**Source spec:** `docs/superpowers/specs/2026-08-11-landing-pwa-wakelock-deploy-design.md`

## Global Constraints

- **Colour:** only the five palette tokens (`wheat #ebd1ad`, `palm #93914d`, `gunmetal #424242`, `pacific #5296a5`, `pink #f8a0cb`) plus white **text**. Dark text is always `gunmetal`. No off-palette Tailwind classes (`slate-*`, `red-*`) and no raw hex outside palette definitions. Error surfaces are `bg-pink text-gunmetal`.
- **TypeScript `strict: true`.** No `any`.
- **`SurfacePoint` is the only representation of a point.** Not touched by this plan.
- **Public repo.** No secret may be written into the checkout. Secrets go to `/etc/humboldt/upload.env` (`0640`) or the gitignored `apps/web/.env`.
- **`VITE_*` values are inlined at build time** — changing them requires a rebuild, never a restart.
- **Vite `publicDir` is repo-root `public/`**, not `apps/web/public/`. New static assets go in `public/`.
- **The SPA fallback returns 200 + `index.html` for missing paths.** Any asset check must inspect the body, never the status code alone.
- **No test harness exists.** Verification per task = `pnpm build` passing, `bash -n` for scripts, plus the named manual check. Do not claim a manual check passed if it was not run.
- **Reverse-proxy contract:** the app serves plain HTTP on `127.0.0.1:<port>` (default `8080`). TLS/tunnel are out of scope for repo scripts.
- Commit after every task. End commit messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `apps/web/src/lib/wakeLock.ts` | `useWakeLock(active)` — acquire/release/re-acquire the screen sentinel | 1 |
| `apps/web/src/shared/StatusChip.tsx` | Render connection + wake state, palette-only | 1 |
| `apps/web/src/lib/game.ts` | *(modify)* expose `connection` from `useRoom` | 2 |
| `apps/web/src/routes/{host,board,play}/*.tsx` | *(modify)* mount chip + wake lock | 2 |
| `tools/icons/build.mjs` | Zero-dep PNG generator (letter mark) | 3 |
| `public/icons/*.png` | Generated, committed icons | 3 |
| `public/manifest.webmanifest` | PWA manifest | 4 |
| `public/sw.js` | Passthrough service worker, caches nothing | 4 |
| `apps/web/index.html` | *(modify)* manifest/theme/apple head tags | 4 |
| `apps/web/src/lib/pwa.ts` | `useInstallPrompt()` + prod-only SW registration | 4 |
| `apps/web/src/routes/landing/Landing.tsx` | Role chooser + install affordance | 5 |
| `apps/web/src/main.tsx` | *(modify)* router outside AuthGate; per-route gating | 5 |
| `deploy/humboldt-upload.service.tpl` | systemd unit template | 6 |
| `deploy/humboldt.caddyfile.tpl` | Caddy site snippet template | 6 |
| `scripts/setup-server.sh` | Idempotent install; probes and skips | 6 |
| `scripts/deploy.sh` | Build + atomic release swap | 7 |
| `scripts/doctor.sh` | Nine ordered pass/fail checks | 7 |
| `README.md`, `CLAUDE.md` | Docs synced in the same commit as code | 8 |

---

### Task 1: Wake lock hook and status chip

**Files:**
- Create: `apps/web/src/lib/wakeLock.ts`
- Create: `apps/web/src/shared/StatusChip.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WakeState = 'held' | 'unsupported' | 'denied'`
  - `function useWakeLock(active: boolean): WakeState`
  - `type Connection = 'connected' | 'reconnecting' | 'offline'`
  - `function StatusChip(props: { connection?: Connection; wake?: WakeState }): JSX.Element`

`Connection` is declared in `StatusChip.tsx` and re-exported from `lib/game.ts` in Task 2 so both consumers share one definition.

- [ ] **Step 1: Write `lib/wakeLock.ts`**

The OS releases the sentinel every time the page hides, so the `visibilitychange` re-acquire is mandatory, not an optimisation. Every call is wrapped — a rejection must never surface as an error.

```ts
import { useEffect, useState } from "react";

export type WakeState = "held" | "unsupported" | "denied";

// Screen Wake Lock (CLAUDE.md §11.1). Held only while `active`. The OS releases
// the sentinel whenever the page is hidden, so we re-acquire on visibilitychange.
export function useWakeLock(active: boolean): WakeState {
  const [state, setState] = useState<WakeState>(
    typeof navigator !== "undefined" && "wakeLock" in navigator ? "denied" : "unsupported",
  );

  useEffect(() => {
    if (!("wakeLock" in navigator)) { setState("unsupported"); return; }
    if (!active) { setState("denied"); return; }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        sentinel.addEventListener("release", () => { sentinel = null; setState("denied"); });
        if (cancelled) { await sentinel.release().catch(() => {}); sentinel = null; return; }
        setState("held");
      } catch {
        setState("denied"); // low battery, power saver, or refused by the OS
      }
    };

    const onVis = () => { if (document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVis);
    void acquire();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);

  return state;
}
```

- [ ] **Step 2: Write `shared/StatusChip.tsx`**

Both props optional so a roomless screen can show wake state alone. Strict palette: `wheat` for the reconnecting state, `pink` for offline, both with `text-gunmetal`.

```tsx
export type Connection = "connected" | "reconnecting" | "offline";
export type { WakeState } from "../lib/wakeLock";
```

Chip renders `● live` / `● reconnecting` / `● offline` and `▣ awake` / `▢ screen may dim`.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build`
Expected: PASS. `tsc -b` resolves `WakeLockSentinel` from TypeScript's DOM lib; if it does not, add `"dom"` to `apps/web/tsconfig.json` `lib` rather than declaring `any`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/wakeLock.ts apps/web/src/shared/StatusChip.tsx
git commit -m "feat: add wake lock hook and status chip"
```

---

### Task 2: Surface connection state and wire the chips

**Files:**
- Modify: `apps/web/src/lib/game.ts` (the `useRoom` hook, ~line 94-131)
- Modify: `apps/web/src/routes/host/Host.tsx`
- Modify: `apps/web/src/routes/board/Board.tsx`
- Modify: `apps/web/src/routes/play/Play.tsx`

**Interfaces:**
- Consumes: `useWakeLock`, `StatusChip`, `Connection` from Task 1.
- Produces: `useRoom(code)` now returns `{ snap, missing, resync, connection }`.

- [ ] **Step 1: Add connection tracking to `useRoom`**

`useRoom` currently discards the `subscribe()` status. Capture it. Rules: `offline` whenever `navigator.onLine` is false; `connected` on `SUBSCRIBED`; `reconnecting` otherwise. Resync behaviour must not change — this only surfaces state that already existed.

- [ ] **Step 2: Wire Host**

`HostRoom` holds the lock for the whole session: `const wake = useWakeLock(true);`. Render `<StatusChip connection={connection} wake={wake} />` in the `HostGame` header and on the lobby/ended screens.

- [ ] **Step 3: Wire Board**

Same, `useWakeLock(true)`, chip placed inside the 5 % overscan-safe inset (CLAUDE.md §11.5).

- [ ] **Step 4: Wire Play**

Battery-conscious per §11.1: `const wake = useWakeLock(snap?.room.phase === "answering");`

- [ ] **Step 5: Verify**

Run: `pnpm build`
Expected: PASS.
Manual (operator): open `/board`, confirm the chip reads `live` and `awake`; disable Wi-Fi and confirm it flips to `offline` on `pink`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/game.ts apps/web/src/routes
git commit -m "feat: hold screen wake locks and show connection status"
```

---

### Task 3: Icon generator and generated icons

**Files:**
- Create: `tools/icons/build.mjs`
- Create: `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-180.png`

**Interfaces:**
- Consumes: nothing.
- Produces: the four PNG paths, referenced by Task 4's manifest and head tags.

- [ ] **Step 1: Write the generator**

Zero dependencies — Node's built-in `zlib` only, matching `server/upload`'s style. Structure:

1. Build an RGBA pixel buffer: `pacific` `#5296a5` field, white letter **H** drawn from three rectangles (two stems, one crossbar), supersampled 4× and box-filtered for smooth edges.
2. Encode: PNG signature, `IHDR` (8-bit RGBA, colour type 6), `IDAT` (`zlib.deflateSync` over scanlines each prefixed with filter byte 0), `IEND`. CRC32 per chunk.
3. Maskable variant insets the glyph to ~60 % of the canvas so Android's mask cannot clip it.
4. Self-check before writing: assert the 8-byte signature and that the first chunk type is `IHDR`.

- [ ] **Step 2: Run it**

Run: `node tools/icons/build.mjs`
Expected: writes four files and prints each path with its byte size.

- [ ] **Step 3: Verify the PNGs are valid**

Run: `file public/icons/*.png`
Expected: each reported as `PNG image data`, with the correct dimensions (192x192, 512x512, 512x512, 180x180).

- [ ] **Step 4: Commit**

```bash
git add tools/icons/build.mjs public/icons
git commit -m "feat: add zero-dependency app icon generator"
```

---

### Task 4: Manifest, service worker, head tags, install hook

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Create: `apps/web/src/lib/pwa.ts`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: icon paths from Task 3.
- Produces: `useInstallPrompt(): { canInstall: boolean; promptInstall: () => Promise<void>; isIOS: boolean; isStandalone: boolean }`

- [ ] **Step 1: Write the manifest**

```json
{
  "name": "Map Quiz",
  "short_name": "MapQuiz",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#424242",
  "theme_color": "#424242",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Write `public/sw.js`**

Caches nothing — it exists only because Chrome requires a registered worker with a `fetch` handler before it will fire `beforeinstallprompt`. It must never be able to serve a stale shell.

```js
// Installability-only service worker (CLAUDE.md §11.6). Caches NOTHING: a stale
// app shell on quiz night is worse than a slow first load.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", () => {});
```

- [ ] **Step 3: Write `lib/pwa.ts`**

Captures `beforeinstallprompt` (preventing the mini-infobar), registers `/sw.js` only when `import.meta.env.PROD`, and detects iOS and standalone display mode. Type the event locally — TypeScript's DOM lib has no `BeforeInstallPromptEvent`.

- [ ] **Step 4: Add head tags to `index.html`**

Manifest link, `<meta name="theme-color" content="#424242">`, `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`. Keep the existing viewport line untouched — it already carries `viewport-fit=cover` and `user-scalable=no`.

- [ ] **Step 5: Verify**

Run: `pnpm build && ls apps/web/dist/manifest.webmanifest apps/web/dist/sw.js apps/web/dist/icons`
Expected: all present in the build output (proves `publicDir` picked them up).

- [ ] **Step 6: Commit**

```bash
git add public/manifest.webmanifest public/sw.js apps/web/src/lib/pwa.ts apps/web/index.html
git commit -m "feat: add PWA manifest, no-cache service worker and install hook"
```

---

### Task 5: Landing page and auth boundary

**Files:**
- Create: `apps/web/src/routes/landing/Landing.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `useInstallPrompt` from Task 4.
- Produces: route `/` rendering `Landing`; `/play`, `/host`, `/board`, `/quiz` each individually wrapped in `AuthGate`.

- [ ] **Step 1: Write `Landing.tsx`**

`gunmetal` background. Title, then three role links: **Host** → `/host` (`bg-pacific`), **Player** → `/play` (`bg-palm`), **Board** → `/board` (`bg-white/20`), each with a one-line description. `/quiz` is deliberately absent — it is reached from the Host screen only.

Install affordance at the bottom, priority order: `isStandalone` → render nothing; `canInstall` → an **Install app** button; `isIOS` → the text hint "Add to Home Screen: tap Share, then Add to Home Screen"; otherwise nothing.

- [ ] **Step 2: Restructure `main.tsx`**

Move `<BrowserRouter>` outside `<AuthGate>` and wrap each role route with a local `<Gated>` helper. `AuthGate` itself must not be modified. `Landing` is imported eagerly, not lazily — it is the first paint and it is tiny.

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: PASS.
Manual (operator): `./scripts/start.sh`, open `/` — the three buttons must appear with **no Turnstile widget**; clicking Host shows the captcha once, then the host screen. `/play?room=CODE` must still deep-link.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/landing apps/web/src/main.tsx
git commit -m "feat: add role chooser landing page at /"
```

---

### Task 6: Deploy templates and setup script

**Files:**
- Create: `deploy/humboldt-upload.service.tpl`
- Create: `deploy/humboldt.caddyfile.tpl`
- Create: `scripts/setup-server.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `/etc/humboldt/upload.env`, `/etc/systemd/system/humboldt-upload.service`, `/etc/caddy/conf.d/humboldt.caddyfile`, `apps/web/.env`, and the directory layout `deploy.sh`/`doctor.sh` assume.

- [ ] **Step 1: Write the systemd template**

Placeholders `__USER__`, `__APP_DIR__`, `__UPLOAD_DIR__`. Includes the hardening block (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `ReadWritePaths=__UPLOAD_DIR__`).

- [ ] **Step 2: Write the Caddy snippet template**

Placeholders `__PORT__`, `__UPLOAD_PORT__`, `__UPLOAD_DIR__`, `__CURRENT__`. Exactly as specified in the design doc §4, including `/uploads/*` matched before the SPA root and the `@nocache` matcher covering `/index.html`, `/sw.js`, `/manifest.webmanifest`.

- [ ] **Step 3: Write `setup-server.sh`**

`set -euo pipefail`. Flags: `--port N` (default 8080), `--upload-port N` (default 8787), `--app-dir`, `--upload-dir`, `--user`, `--skip-packages`, `--skip-caddy`, `--skip-user`, `--non-interactive`, `--help`.

Behaviour: **probe before acting.** For each of Node ≥ 20, pnpm, Caddy, the service user, each directory, an existing `UPLOAD_TOKEN`, and an existing unit file, print either `installing…` or `already present — skipping`.

Prompt only for `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, offering any existing value as the default. `--non-interactive` reads the same names from the environment and fails loudly if one is missing. Generate `UPLOAD_TOKEN` with `openssl rand -hex 32` on first run only; preserve it thereafter so a re-run never silently breaks uploads.

Caddy integration is **additive**: write the snippet to `/etc/caddy/conf.d/humboldt.caddyfile` and append `import conf.d/*.caddyfile` to `/etc/caddy/Caddyfile` only if that line is absent. Never rewrite the main Caddyfile.

Finish by printing the reverse-proxy contract and the next command:

```
Humboldt serves plain HTTP on http://127.0.0.1:8080
Point your tunnel or reverse proxy at that address; TLS is terminated upstream.
Next: ./scripts/deploy.sh
```

- [ ] **Step 4: Verify**

Run: `bash -n scripts/setup-server.sh && ./scripts/setup-server.sh --help`
Expected: no syntax errors; help text lists every flag.
Manual (operator, on the real box): a full run, then an immediate second run that reports everything as already present and leaves `UPLOAD_TOKEN` unchanged.

- [ ] **Step 5: Commit**

```bash
git add deploy scripts/setup-server.sh
git commit -m "feat: add idempotent Debian server setup script and deploy templates"
```

---

### Task 7: Deploy and doctor scripts

**Files:**
- Create: `scripts/deploy.sh`
- Create: `scripts/doctor.sh`

**Interfaces:**
- Consumes: the layout and config files produced by Task 6.
- Produces: nothing consumed by later tasks; Task 8 documents both.

- [ ] **Step 1: Write `deploy.sh`**

`set -euo pipefail`. Flags: `--pull`, `--app-dir`, `--keep N` (default 5), `--help`.

Sequence: optional `git pull --ff-only` → `pnpm install --frozen-lockfile` → `pnpm build` → copy `apps/web/dist/` into `releases/<UTC timestamp>/` → `ln -s` to a temp name then `mv -T` onto `current` (atomic rename, so no player loads a half-written app) → prune all but the newest `--keep` releases → restart `humboldt-upload` only if `server/upload/` changed in the pulled range.

Print the release path and a reminder that database migrations deploy separately by pushing to `main`.

- [ ] **Step 2: Write `doctor.sh`**

`set -uo pipefail` (not `-e` — every check must run even after a failure). One `PASS`/`FAIL` line per check, non-zero exit if any failed. The nine checks, in order:

1. `apps/web/.env` has all four `VITE_*` values, none empty.
2. The `UPLOAD_TOKEN` from `/etc/humboldt/upload.env` appears verbatim in the live release's JS bundle — catches a token rotated in only one place.
3. `systemctl is-active humboldt-upload`.
4. `caddy validate` and `systemctl is-active caddy` (skipped with `--skip-caddy`).
5. `GET /board` → 200 **and** body contains `<div id="root">`.
6. `GET /geo/manifest.json` → first non-whitespace body character is `{`. A status check alone is worthless: the SPA fallback returns 200 with `index.html` for a missing asset.
7. `POST /api/upload` with no token → **401**, proving the service is reachable *and* still token-gated.
8. Supabase REST reachable with the anon key, and a known RPC resolves rather than reporting "Could not find the function".
9. `current` resolves to a directory containing `index.html`, `assets/`, and `geo/`.

- [ ] **Step 3: Verify**

Run: `bash -n scripts/deploy.sh scripts/doctor.sh && ./scripts/deploy.sh --help && ./scripts/doctor.sh --help`
Expected: no syntax errors; both print help.
Manual (operator, on the real box): `./scripts/deploy.sh` then `./scripts/doctor.sh` — expect nine PASS lines.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy.sh scripts/doctor.sh
git commit -m "feat: add atomic deploy and health-check scripts"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Restructure the README**

New order: what this is → local development → **what you need before installing** (Supabase project + migrations, anonymous sign-ins, Turnstile keys) → **install in three commands** → updating → environment reference → troubleshooting → pre-event checklist → licence. The long manual walkthrough is retained as an appendix headed "Manual install (what the script does)". The `cloudflared` section collapses to the one-line reverse-proxy contract.

- [ ] **Step 2: Sync CLAUDE.md**

Per the project's own rule, in the same commit as the code:
- §2 repo shape: add `deploy/`, `tools/icons/`, `src/routes/landing/`, `lib/wakeLock.ts`, `lib/pwa.ts`, `shared/StatusChip.tsx`, `public/manifest.webmanifest`, `public/sw.js`, `public/icons/`, `scripts/{setup-server,deploy,doctor}.sh`.
- §10.3: Caddy-snippet approach, configurable port, tunnel out of scope for repo scripts; resolve the `OPEN` on deployment method in favour of the scripts.
- §11.1: wake locks built; name `useWakeLock` and the per-screen policy.
- §11.6: PWA exists; state the caches-nothing service-worker policy.
- §13 step 9: mark done except visual polish.

- [ ] **Step 3: Verify**

Manual: re-read both documents for stale claims — especially any surviving reference to `/` redirecting to `/board`, to `AuthGate` wrapping the whole router, or to replacing `/etc/caddy/Caddyfile`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document the landing page, PWA and scripted deployment"
```

---

## Self-Review

**Spec coverage:** §1 landing/auth boundary → Task 5. §2 PWA (manifest, icons, generator, SW, head, hook) → Tasks 3–4. §3 wake lock, connection, chip, wiring → Tasks 1–2. §4 templates, setup, deploy, doctor, Caddy snippet → Tasks 6–7. §5 docs → Task 8. §6 verification → folded into each task's verify step. §7 risks → mitigations appear in the tasks that carry them. No gaps.

**Placeholder scan:** No TBDs. The two places that say "as specified in the design doc" (Caddy snippet, manifest) point at content reproduced verbatim in this plan or the spec, not at absent content.

**Type consistency:** `WakeState`, `Connection`, `useWakeLock`, `StatusChip`, `useInstallPrompt` are used with identical names and shapes in Tasks 1, 2, 4 and 5. `useRoom`'s return type gains exactly one field, `connection`, declared in Task 2 and consumed only there.
