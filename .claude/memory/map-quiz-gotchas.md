---
name: map-quiz-gotchas
description: "Concrete bugs/traps hit building the map quiz and their fixes (Supabase, Vite, MapLibre, RLS)"
metadata: 
  node_type: memory
  type: project
  originSessionId: dbd8c410-b7d7-4542-881b-bd83b4d4d633
---

Traps already hit on [[project-map-quiz]] — check these first when something breaks:

- **`gen_random_bytes` does not exist.** pgcrypto isn't on the RPC `search_path` on Supabase. Derive
  random codes from `gen_random_uuid()` instead (migration 0005). `gen_random_uuid()` itself is fine.
- **Vite `publicDir` must be repo-root `public/`.** Geo TopoJSON (`tools/geo` output) + uploads live
  in `/public`, but app root is `apps/web`, so default served `apps/web/public`. Symptom: `/geo/*`
  returned HTTP 200 that was actually the SPA `index.html` fallback (false positive) → `JSON.parse`
  fails. Set `publicDir: "../../public"` in `apps/web/vite.config.ts`; uploads write there too.
- **Postgrest errors are plain objects** → `String(e)` renders `[object Object]`. Use
  `lib/errMsg.ts` (`e.message ?? e.hint ?? JSON.stringify`). Wired into all route error paths.
- **MapLibre marker zoom drift.** A marker element containing dot+label anchored at center puts the
  dot off the lng/lat by a fixed pixel offset → varies geographically with zoom. Fix: marker element
  is the **dot only, no label** (label was removed at user request); nickname on `title`/hover.
- **Board leaked cross-round pins.** Filtering answers by `revealed_at` alone showed earlier rounds'
  revealed answers on the current map. Always also filter `round_id === current round`.
- **`rooms.source_quiz_id` was missing** — written by `attach_quiz` but never added to the table
  (migration 0009 adds it). Watch for schema columns referenced in RPCs but absent from `create table`.
- **pnpm 10 blocks build scripts.** Needed `pnpm.onlyBuiltDependencies: ["esbuild"]` in root
  package.json or Vite won't run.
- **Dev start/stop uses `setsid` process group.** `pnpm dev` spawns a shell→vite grandchild; a plain
  `kill` orphans vite. `scripts/start.sh` `setsid`s the group (vite + the upload service on :8787),
  `stop.sh` kills the whole group by negative PID.
- **Anon sign-in is CAPTCHA-gated** (Cloudflare Turnstile in Supabase Auth). `<AuthGate>` shows the
  widget on first visit only; needs `VITE_TURNSTILE_SITE_KEY` and the widget's hostname list to
  include the test origin (localhost). `AuthGate` now wraps each ROLE route individually, not the
  whole router — `/` must stay ungated or you get a captcha before choosing a role.
- **`GET /rest/v1/` returns 401 to the anon key** — Supabase disables the PostgREST OpenAPI root for
  anon, so it is useless as a liveness probe. Test reachability by calling a real RPC instead and
  reading the body: `PGRST202`/"Could not find the function" = not deployed, a domain error like
  "no such room" = deployed and reachable. (Probe with a room code that cannot exist, e.g. six
  dashes — room codes are alphanumeric, so it can only raise, never mutate.)
- **A health check must never carry its own default target.** First real deploy (2026-08-15) ran on
  port 20261; `doctor.sh` probed its hardcoded default 8080 and reported three confident FAILs about
  an address nobody served — and I misdiagnosed it as a broken Caddy import before checking that the
  ports matched. Port/bind/app-dir now live in `/etc/humboldt/site.env`, written by
  `setup-server.sh`, read by `doctor.sh`. **When a health check disagrees with reality, suspect the
  check's assumptions about WHERE it is looking before theorising about the service.**
- **`caddy validate` is worthless as a health check** — a Caddyfile that imports nothing validates
  perfectly and serves no site. Use `caddy adapt --config … | grep -F ':<port>"'`.
- **Loopback-only bind locks out the tunnel and every phone.** The tunnel frequently runs on a
  *different* host and targets this box's LAN IP, so `bind 127.0.0.1` breaks everything while all
  127.0.0.1 health checks still pass. Default is now `--bind 0.0.0.0`, and `doctor.sh` tests the LAN
  address explicitly.
- **Chrome will not fire `beforeinstallprompt` without a registered service worker** that has a
  `fetch` handler. `public/sw.js` exists only for that; it caches NOTHING (§11.6 forbids an
  aggressive cache) and is registered in prod builds only.
