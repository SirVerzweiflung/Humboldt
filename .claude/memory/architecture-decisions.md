---
name: architecture-decisions
description: "Key design decisions made for the map quiz and WHY (identity, uploads, RPCs, phases, colors)"
metadata: 
  node_type: memory
  type: project
  originSessionId: dbd8c410-b7d7-4542-881b-bd83b4d4d633
---

Decisions taken with the user for [[project-map-quiz]] (rationale that CLAUDE.md states but doesn't
always justify):

- **Name = player identity**, not device. `join_room(code, name)` upserts by `(room_id,
  lower(nickname))`; re-typing a name on any device continues the same player/score. **Why:** dead
  phone recovery; no passwords in a known group. `players.device_id` = last device (anti-grief).
- **Anti-grief by device supersession.** In-room device watches its own player row; if `device_id`
  stops being its `auth.uid()` → self-eject ("someone joined as <name>"); rejoining reclaims. Host
  kick = row deleted → "removed". Last-writer-wins, not real auth.
- **Plain host takeover.** Any device can `/host` + enter room code → becomes host (`rooms` UPDATE RLS
  `using(true) with check host_id=auth.uid()`). Trusted-group tradeoff.
- **Images self-hosted, NOT Supabase Storage** — to save Supabase egress (images served to ~20 phones
  each round; Cloudflare edge-caches our origin). `server/upload/` zero-dep Node service, token-gated
  (`VITE_UPLOAD_TOKEN`↔`UPLOAD_TOKEN`); client downscales to WebP first; `surface_ref` stores a
  relative `/uploads/...` URL.
- **Quizzes are DB-backed, loaded by a long secret quizcode** (~120-bit), replacing file upload. The
  `quiz_*` tables are **RLS deny-all**; ALL access via SECURITY DEFINER RPCs keyed by the quizcode
  (`quiz_create/load/save`). JSON export only, no import. **Why:** solutions are secret, but editing
  must work from any device with the code → code-gated RPCs, not owner-uid.
- **Room = snapshot of a quiz.** `attach_quiz(room, quizcode)` copies quiz_questions/solutions into
  `rounds` + `round_solutions`. Editing a quiz never mutates a played room.
- **Phase enum collapsed** to `lobby | answering | revealing | ended`. Start opens answering
  immediately (no separate prompt step); scoring happens inside revealing (reveal each pin in ANY
  order, reveal solution anytime, award ±1). `next_round` advances; after last → ended.
- **All game state changes are SECURITY DEFINER RPCs that bump `rooms.reveal_seq`.** Clients use one
  `useRoom(code)` hook = subscribe to rooms/players/answers/score_events/rounds + **reconcile via a
  full fetch** on every event (Postgres Changes has no replay). Answers written only via
  `submit_answer` (device ≠ player identity).
- **Distance computed client-side** (`lib/distance.ts`: haversine km / image px+%), not frozen in DB
  yet. Host has solution live (RLS host-only) → live "closest-first" ordering; board computes after
  solution revealed. Board list ALWAYS score-ordered, ties by join order, scores always visible.
- **Per-player marker colours = documented exception to the strict 5-colour palette**
  ([[color-palette-rule]]): `lib/colors.ts` categorical set, assigned by join order, stable per quiz.
  Only place off-palette colour is allowed. Solution pin = white diamond (palette-pure).
