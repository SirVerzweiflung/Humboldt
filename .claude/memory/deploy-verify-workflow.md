---
name: deploy-verify-workflow
description: "How DB migrations deploy and how to verify them for the map quiz (push→Supabase, poll RPC)"
metadata: 
  node_type: memory
  type: project
  originSessionId: dbd8c410-b7d7-4542-881b-bd83b4d4d633
---

Deploy loop for [[project-map-quiz]]:

- **The server pipeline is three scripts** (added 2026-08-15): `scripts/setup-server.sh` (idempotent
  Debian install — probes and prints "present — skipping"; prompts only for Supabase URL/anon key +
  Turnstile site key; generates and then PRESERVES `UPLOAD_TOKEN`), `scripts/deploy.sh` (build →
  `releases/<ts>` → `ln`+`mv -T` atomic swap, keeps 5), `scripts/doctor.sh` (9 PASS/FAIL checks,
  runs all of them even after a failure). Templates in `deploy/`. **Contract: plain HTTP on
  `127.0.0.1:<port>`, default 8080** — TLS/DNS/tunnel are deliberately NOT in any repo script.
  Caddy is integrated additively (snippet in `conf.d/` + guarded `import`), never by rewriting the
  main Caddyfile.
- **`doctor.sh` encodes the two traps that actually bite**: it greps the *live bundle* for the
  server's `UPLOAD_TOKEN` (client half is inlined at build time — rotating one side alone breaks
  uploads silently), and it checks the *body* of `/geo/manifest.json`, not its status.

- **Migrations deploy via GitHub integration**: push to `main` → Supabase applies
  `supabase/migrations/*`. There is no local Supabase running; SQL isn't testable locally. So write
  the migration, commit + push, then **poll to confirm it landed before telling the user it's fixed.**
- **Poll pattern** (curl the anon REST/RPC with keys from `apps/web/.env`): call a new RPC with a bogus
  arg and watch the error flip from "Could not find the function / does not exist" (not deployed) to a
  domain error like "no such room" (deployed). For a new column:
  `GET /rest/v1/rooms?select=<col>&limit=1` → 200 vs "column does not exist". Deploy lag ~10–60s.
- Frontend: build with `pnpm build` (tsc + vite) to typecheck before pushing; `scripts/start.sh` /
  `stop.sh` for a local dev smoke (routes should 200, but remember the SPA-fallback false-positive
  trap in [[map-quiz-gotchas]]).
- Only `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_UPLOAD_TOKEN` are in the
  client `.env` (gitignored). Never the service role key. Migrations edit-once: add a NEW migration
  rather than editing a deployed one.
- **I cannot drive the browser / multi-device realtime flow** — always state clearly what was
  verified (build, serve-200, RPC-deployed) vs what needs the user's own end-to-end test.
