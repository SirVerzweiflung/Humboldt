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
  include the test origin (localhost).
