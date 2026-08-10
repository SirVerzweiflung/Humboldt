---
name: project-map-quiz
description: What the Humboldt repo is — a host-driven live map/image quiz; canonical doc + build status
metadata: 
  node_type: memory
  type: project
  originSessionId: dbd8c410-b7d7-4542-881b-bd83b4d4d633
---

Repo `Humboldt` (remote `git@github.com:SirVerzweiflung/Humboldt.git`, branch `main`) = a moderated,
**host-driven live map quiz** ("Where is Rome?" → players tap a point on a near-empty map or an
uploaded image; host reveals pins one by one, drops the real solution, awards points by hand). Working
title "Map Quiz". Party game for a known group, not a security-critical app.

Three React routes in one Vite app (`apps/web`): **/play** (phone), **/host** (tablet), **/board**
(TV), plus **/quiz** (the editor). One Supabase project (Postgres + Realtime + anon Auth + RLS; NO
Supabase Storage — see [[architecture-decisions]]). Supabase project ref `hmnynsajduvwhgslaiow`.

**CLAUDE.md in the repo is the canonical architecture doc** — always read it; it's kept in sync with
every architectural change in the same commit. Don't duplicate it here; this memory holds the
cross-session context, decisions rationale, and traps that aren't obvious from the code.

Build progress (as of 2026-08): scaffold ✓ · realtime sync ✓ (dummy_pings, now unused) · Turnstile
captcha gate ✓ · quiz editor ✓ · player join/name flow ✓ · **full game logic ✓** (lobby → answering
→ revealing → ended). Migrations 0001–0009 deployed.

Deferred / next: richer round-transition polish; drop the now-unused `dummy_pings` table; freeze
`answers.distance` in DB for export; JSON/CSV results export; import path for quizzes. See
[[architecture-decisions]], [[map-quiz-gotchas]], [[deploy-verify-workflow]].
