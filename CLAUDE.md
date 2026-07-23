# Project Context — Map Quiz (working title)

> Shared context for Claude Code and for humans. It describes **intended** architecture.
> `OPEN` = undecided. `CONSTRAINT` = platform behaviour we cannot change.
> If you change an architectural decision, change it here in the same commit.

---

## 1. What this is

A moderated, **host-driven** map quiz for a live event. The moderator asks "Where is Rome?";
participants tap a point on a near-empty map (or on a picture); the moderator then reveals the
submitted pins one at a time on a big screen, optionally drops the real solution, and awards points
by hand.

**A quiz is a one-time event.** There is no quiz library, no accounts, no persistent content
catalogue. The host uploads a quiz file into a freshly created room, the room is played once, and
the results are exported at the end.

Three simultaneous browser clients, all React, all talking to one Supabase project:

| Client | Device | Role |
|---|---|---|
| **Player** | Phone (portrait) | Join by code, nickname, place one pin, submit. Sees own answer, then whatever the host reveals. |
| **Host** | Tablet / iPad (landscape) | The control surface. Uploads the quiz, opens/closes answering, **sees answers arrive live**, reveals them one by one, drops the solution, awards points, advances rounds. |
| **Board** | Laptop browser → TV/beamer | Read-only projection. Question, "n of m answered", revealed pins + distances, solution, leaderboard. Zero interaction. |

### The round loop (this drives everything else)

```
lobby
  │  host: start round
  ▼
prompt      – question text on Board; host reads it aloud; no submissions accepted yet
  │  host: open answers
  ▼
answering   – players place and submit exactly one pin; host watches the count climb
  │  host: lock (or all players submitted)
  ▼
revealing   – host taps a player → that pin appears on the Board.
  │           host may drop the real solution at ANY point in this phase
  │           (before, between, or after individual reveals).
  │           Distance is shown for every pin that is revealed AND has a solution to compare to.
  │  host: done revealing
  ▼
scoring     – host awards points manually per player. No auto-calculation.
  │  host: next round ──▶ prompt (same lobby, same players, scores persist)
  │  host: finish
  ▼
ended       – final leaderboard on Board, JSON/CSV export on Host
```

Everything is host-triggered. There are no automatic timers on the critical path. A countdown is
optional per round and purely cosmetic (`OPEN`).

### Explicitly out of scope

- **No live pin-drag streaming.** Only the final submitted answer is transmitted. This removes the
  chattiest part of the design and most of the realtime message budget.
- **No automatic scoring.** Distance is *displayed*, never converted to points by the app.
  (Leaving the door open: distance is stored, so an auto-scoring mode can be added later without a
  migration.)
- **No question bank / quiz editing UI** for now. Quizzes arrive as a file.

---

## 2. Stack

- **React 18 + TypeScript + Vite** for all three clients.
- **Supabase** (single free project) — Postgres, Realtime, anonymous Auth, RLS, Storage.
- **MapLibre GL JS** for geographic surfaces (§6).
- **Custom pan/zoom component** for image surfaces (§7).
- **@turf/turf** for great-circle distance.
- **zod** for validating the uploaded quiz file and every realtime payload.
- **Tailwind** vs CSS modules — `OPEN`, pick one.
- Client state: a **single reducer over server truth**, not scattered `useState`. Zustand or
  context+reducer, `OPEN`.

### Repo shape

One repo, one Vite app, three routes — not three deployments.

`[now]` = scaffolded and on disk today. `[planned]` = intended, created when the feature that
needs it lands (§13 build order). Don't create `[planned]` dirs empty; add them with their first
real file.

```
/
├── CLAUDE.md                  ← this file                                  [now]
├── package.json               ← root, pnpm workspaces, start/stop scripts  [now]
├── pnpm-workspace.yaml        ← globs apps/* (packages/* added when needed) [now]
├── .gitignore                 ← node_modules, dist, .env*, .devserver.*    [now]
├── scripts/
│   ├── start.sh               ← detached vite dev server (setsid group)    [now]
│   └── stop.sh                ← kills the whole process group              [now]
├── apps/web/
│   ├── index.html                                                          [now]
│   ├── vite.config.ts         ← host:true (LAN), port 5173                 [now]
│   ├── tailwind.config.js · postcss.config.js · tsconfig.json             [now]
│   ├── .env                   ← VITE_SUPABASE_* (gitignored, see §10.4)    [planned]
│   ├── .env.example           ← committed template of the above           [planned]
│   └── src/
│       ├── main.tsx           ← router: / → /board, /play /host /board    [now]
│       ├── index.css          ← tailwind directives + touch resets        [now]
│       ├── shared/            ← in-app shared React components (RoleBadge) [now]
│       │                        promote to packages/ui only if a 2nd app appears
│       └── routes/{play,host,board}/                                      [now]
├── packages/                  ← added incrementally; NOT scaffolded yet    [planned]
│   ├── protocol/              ← shared types, PROTOCOL_VERSION, quiz zod schema
│   ├── supabase/              ← typed client, generated DB types, channel helpers
│   ├── surface/               ← <QuizSurface>: geo + image renderers behind one interface
│   └── ui/                    ← only if shared/ needs to cross app boundaries
├── supabase/
│   ├── config.toml            ← project_id = project ref (§10.2)           [now]
│   ├── migrations/            ← deployed by the GitHub integration (§10)   [now: 0001 rooms]
│   └── seed.sql                                                            [planned]
└── public/geo/                ← TopoJSON/GeoJSON layer assets (§6.3)       [planned]
```

**Deliberate deviations from the original sketch:**
- `packages/*` is deferred. With one app, shared code lives in `apps/web/src/shared/`; a workspace
  package earns its keep only when a second consumer exists. `pnpm-workspace.yaml` globs `apps/*`
  only for now — widen to `packages/*` when the first package lands.
- `scripts/` (start/stop) is new and belongs in the shape; it's the servable-site entry point.
- `packages/supabase` (typed client) stays `[planned]`: until it exists, the app reads
  `import.meta.env.VITE_SUPABASE_*` directly (§10.4).

**Why one app:** shared types can't drift, one build, one deploy, and no **version skew** between a
phone running yesterday's bundle and a TV running today's.

Skew is still possible (a tab left open across a deploy). Mitigate with a `PROTOCOL_VERSION`
constant written into `rooms.protocol_version` at creation and compared on join → mismatch prompts a
reload. Route-level `React.lazy` so the phone never downloads Board-only or Host-only code.

---

## 3. Data model

A room is a **row, not a process**. There is no server-side game loop anywhere.

```sql
-- ── rooms ────────────────────────────────────────────────────────────────
rooms
  id                 uuid pk
  code               text unique not null      -- 6 chars, unambiguous alphabet (no O/0/I/1)
  host_id            uuid not null             -- auth.uid() of the current host device
  host_claim_code    text not null             -- short code that lets a device (re)claim host (§9)
  phase              text not null default 'lobby'
                     -- lobby|prompt|answering|revealing|scoring|ended
  current_round_idx  int  not null default -1
  reveal_seq         int  not null default 0   -- bumped on EVERY reveal action (§5)
  protocol_version   int  not null
  quiz_title         text
  created_at         timestamptz default now()
  expires_at         timestamptz default now() + interval '30 days'

-- ── content, written once at quiz upload ─────────────────────────────────
rounds                              -- PUBLIC: readable by everyone in the room
  id            uuid pk
  room_id       uuid references rooms on delete cascade
  idx           int not null
  prompt        text not null
  surface_kind  text not null       -- 'geo' | 'image'
  surface_ref   text not null       -- geo: map preset id  |  image: storage object path
  surface_meta  jsonb not null      -- see §6.4 / §7.2
  opened_at     timestamptz
  closed_at     timestamptz
  solution_revealed_at timestamptz
  revealed_solution    jsonb        -- NULL until the host drops it; then a copy of the secret
  unique (room_id, idx)

round_solutions                     -- SECRET: host-only. Separate table = simple RLS.
  round_id  uuid pk references rounds on delete cascade
  room_id   uuid not null
  solution  jsonb not null          -- geo: {lat,lng} | image: {x,y} normalised 0..1
  label     text                    -- "Rome", "the third window from the left"

-- ── people ───────────────────────────────────────────────────────────────
players
  id          uuid pk               -- == auth.uid() (anonymous auth)
  room_id     uuid references rooms on delete cascade
  nickname    text not null
  joined_at   timestamptz default now()
  unique (room_id, lower(nickname))

-- ── play ─────────────────────────────────────────────────────────────────
answers
  id            uuid pk
  room_id       uuid not null
  round_id      uuid references rounds on delete cascade
  player_id     uuid references players
  position      jsonb not null      -- geo: {lat,lng} | image: {x,y} normalised 0..1
  submitted_at  timestamptz default now()
  revealed_at   timestamptz         -- NULL until the host reveals this specific answer
  reveal_order  int                 -- 1,2,3… in the order the host revealed them
  distance      jsonb               -- frozen at reveal time, see §8. e.g.
                                    --   {"km": 412.7} | {"px": 318, "pct_diag": 7.4}
  unique (round_id, player_id)

score_events                        -- append-only; manual awards. Undo = insert the negation.
  id         uuid pk
  room_id    uuid not null
  round_id   uuid                   -- nullable: allows off-round bonus/penalty
  player_id  uuid not null
  delta      int not null
  reason     text
  created_at timestamptz default now()
  created_by uuid not null          -- host_id at the time
```

**Scores are derived**, never a mutable column:

```sql
create view player_scores as
  select p.id as player_id, p.room_id, coalesce(sum(e.delta),0)::int as score
  from players p left join score_events e on e.player_id = p.id
  group by p.id, p.room_id;
```

Append-only scoring is deliberate. Manual point-giving means mistakes; "insert -3, reason
'mis-typed'" is an audit trail, and the leaderboard recomputes for free.

### RLS — the short version

Security here is deliberately light (`CONSTRAINT`: this is a party game, not a bank). Exactly two
things are actually protected:

1. **The solution must not leak before reveal.** `round_solutions` is readable **only** by
   `rooms.host_id`. Players and the Board never query it; they read `rounds.revealed_solution`,
   which is `NULL` until the host publishes it.
2. **Answers must not leak before reveal.** `answers` select policy:
   `player_id = auth.uid()` **OR** `revealed_at is not null` **OR** requester is the room's
   `host_id`. That single policy gives the host their live incoming-answer view for free.

Everything else is convenience-grade:

- `answers` insert: `player_id = auth.uid()` and the round's room is in phase `answering` and
  `closed_at is null`. Enforce "one pin per player" with the unique constraint, and allow
  `update` of an unrevealed own answer if we want "change your mind" (`OPEN` — I'd allow it).
- `rooms`, `rounds`, `round_solutions`, `score_events` writes: `host_id = auth.uid()` only.
- `players` insert: `id = auth.uid()`.
- Auth: `supabase.auth.signInAnonymously()`, session persisted in `localStorage` so a reload or a
  locked screen rejoins as the same person rather than creating a duplicate player.

No `SECURITY DEFINER` scoring function is needed any more — points are manual and distance is
display-only. That deletes an entire class of complexity from the original design.

---

## 4. The quiz file

The host prepares a quiz beforehand and uploads it into a room.

```jsonc
{
  "format": "mapquiz-quiz",
  "version": 1,
  "title": "Pub Quiz, July 2026",
  "rounds": [
    {
      "prompt": "Where is Rome?",
      "surface": {
        "kind": "geo",
        "preset": "europe",            // see §6.4
        "detail": "50m",
        "layers": ["coastline", "admin0_borders", "lakes"],
        "bbox": [-11, 34, 32, 60]      // optional starting view
      },
      "solution": { "lat": 41.9028, "lng": 12.4964, "label": "Rome" }
    },
    {
      "prompt": "Where on this photo is the cathedral?",
      "surface": {
        "kind": "image",
        "file": "images/skyline.jpg",  // relative path inside the upload
        "fit": "contain"
      },
      "solution": { "x": 0.4123, "y": 0.6710, "label": "Cathedral spire" }
    }
  ]
}
```

Upload UX on the Host tablet:

- Accept either a single `.json` (geo-only quizzes) or a `.zip` containing `quiz.json` + an
  `images/` folder. A zip is the least error-prone thing to hand a non-technical moderator.
- Validate with the zod schema in `packages/protocol` **before** writing anything, and show a
  human-readable error list ("round 3: solution.lat missing"). A quiz that half-uploads at 20:05 on
  quiz night is the worst possible failure.
- Images go to **Supabase Storage**, bucket `quiz-assets`, path `rooms/{room_id}/{uuid}.{ext}`.
  Rewrite `surface_ref` to the storage path. Use random UUID filenames so nobody guesses the next
  question's picture from a URL pattern.
  - Downscale client-side to max ~2000 px on the long edge and re-encode to WebP/JPEG before upload.
    Free tier gives 1 GB storage and 5 GB egress/month; 20 players × 20 images is fine at ~300 KB
    each, careless 8 MB phone photos are not.
  - Bucket is public-read with unguessable paths (`OPEN`: switch to signed URLs if that ever feels
    too loose — it's a one-line change).
- Then insert `rounds` + `round_solutions` in a single transaction and flip the room to `lobby`.
- Provide a **re-upload / replace quiz** action while still in `lobby`, and a
  **download template quiz** link so the host has a known-good starting file.

`OPEN`: a minimal in-app quiz builder (click the map, type the prompt, export JSON) is the obvious
follow-up, and it reuses `<QuizSurface>` entirely. Not needed for v1.

---

## 5. Realtime

Supabase Realtime gives three primitives. With pin-dragging removed, the design collapses to almost
entirely **Postgres Changes**, which is the reliable one.

| Primitive | Used for |
|---|---|
| **Postgres Changes** | Everything that matters: `rooms` (phase, reveal_seq), `players`, `answers`, `rounds`, `score_events` |
| **Presence** | Who is currently connected — the lobby list and a "disconnected" dot next to a name |
| **Broadcast** | **Not used.** If a purely cosmetic cue is ever needed (a drumroll sound), it can go here — but nothing that affects state. |

Message volume is now trivial: a few dozen events per round. The free tier's 2M messages/month is
not a consideration.

### Channel convention

One channel per room, `room:{CODE}`:

```ts
const channel = supabase
  .channel(`room:${code}`, { config: { presence: { key: playerId } } })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms',
      filter: `code=eq.${code}` }, onRoomChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'players',
      filter: `room_id=eq.${roomId}` }, onPlayersChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'answers',
      filter: `room_id=eq.${roomId}` }, onAnswersChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'score_events',
      filter: `room_id=eq.${roomId}` }, onScoreChange)
  .on('presence', { event: 'sync' }, onPresenceSync)
  .subscribe(onStatus);
```

Turn on **Realtime Authorization** (RLS on `realtime.messages`) so a stranger can't join a room
channel by guessing a 6-character code.

### The single most important rule

`CONSTRAINT` **Postgres Changes has no replay and no backfill.** Anything emitted while a client was
disconnected is gone forever. Therefore:

> **Never build local state by accumulating events. Always reconcile against a fetch.**

Every client implements exactly one function:

```ts
async function resync() {
  const snap = await fetchRoomSnapshot(code);   // room, rounds, current round,
  store.replaceState(snap);                     // players, visible answers, scores
}
```

…and calls it:

1. on mount,
2. **inside `subscribe()` whenever status becomes `SUBSCRIBED`** — covers first connect *and* every
   automatic reconnect,
3. on `visibilitychange` → `visible`,
4. on `window`'s `online` event,
5. on any event it doesn't fully understand.

Realtime events are *hints that something changed*. When in doubt, `resync()`. A redundant snapshot
query costs nothing; a missed reveal costs a broken quiz night.

### `reveal_seq` — why it exists

`CONSTRAINT` When the host sets `answers.revealed_at`, that row becomes newly visible to players and
the Board under RLS. Whether a *row that was previously invisible* reliably produces a delivered
UPDATE event is exactly the kind of edge case that fails at the worst time.

So the host bumps `rooms.reveal_seq` in the **same transaction** as every reveal action (an answer
reveal, or the solution reveal). The Board and players can always read `rooms`, so they always get
that UPDATE, and they respond by refetching the visible answer set for the current round. This
guarantees delivery without depending on RLS-filtered event semantics.

Same trick applies anywhere visibility changes rather than existence.

### Failure UX — build it early, not last

A persistent connection chip on all three screens, driven by channel status + `navigator.onLine`:
`connected` (silent) / `reconnecting…` (amber) / `offline` (red). On the phone, if a submit fails,
keep the pin in `localStorage` and retry on reconnect — but only if the round is still `answering`
server-side; otherwise say "too late" rather than silently dropping it.

---

## 6. Geographic surfaces

### 6.1 Renderer

**MapLibre GL JS** (`maplibre-gl`).

- Open-source Mapbox GL fork. **No API key, no usage limits.**
- WebGL rendering — this matters now that we want *more* than coastlines (§6.2); DOM/SVG renderers
  start to stutter on phones once you add admin-1 boundaries and rivers.
- **No basemap tile layer at all.** The style JSON is a background colour plus a handful of GeoJSON
  sources. We get the "shows next to nothing" look by never loading anything else, not by hiding it.
- `map.on('click', e => e.lngLat)` gives real lat/lng directly.

Alternatives if MapLibre becomes a problem: **Leaflet + `L.geoJSON`** (simpler, smaller, weaker with
dense geometry) or **d3-geo** (the only option if we ever want a non-Mercator projection —
Robinson, orthographic globe). Both must sit behind the same `<QuizSurface>` interface (§8).

### 6.2 Detail beyond the coastline

Detail is a **per-round, per-quiz choice** — it's the difficulty dial. `surface.layers` in the quiz
file selects from a fixed catalogue, all from Natural Earth:

| Layer key | Natural Earth source | Notes |
|---|---|---|
| `coastline` | `ne_*_coastline` | the baseline |
| `land` | `ne_*_land` | filled landmass instead of outline |
| `admin0_borders` | `ne_*_admin_0_boundary_lines_land` | country borders |
| `admin1` | `ne_*_admin_1_states_provinces_lines` | Bundesländer, départements, US states. **10m and 50m only.** |
| `rivers` | `ne_*_rivers_lake_centerlines` | has a `scalerank` field — filter it to control clutter |
| `lakes` | `ne_*_lakes` | |
| `islands` | `ne_10m_minor_islands` | |
| `urban` | `ne_10m_urban_areas` | city blobs without names — nice middle difficulty |
| `roads` / `railroads` | `ne_10m_roads`, `ne_10m_railroads` | 10m only; heavy, use sparingly |
| `graticule` | `ne_*_graticules_*` | lat/lng grid |
| `glaciers` | `ne_10m_glaciated_areas` | |

Everything is **label-free by design** — we never load `populated_places` names, because a label is
the answer.

`CONSTRAINT` Detail costs bytes. `ne_10m_admin_1_states_provinces` is multi-megabyte raw. The fix is
the pipeline in §6.3 (clip to the preset's bbox, simplify hard, TopoJSON), not "load it and hope".

`OPEN` — **escalation path if GeoJSON gets too heavy:** convert the detailed layers to a single
**PMTiles** file and point MapLibre at it over HTTP range requests. PMTiles is one static file, so it
serves fine from the Debian box / Cloudflare with no tile server. Only do this if a concrete layer
combination actually gets too big; plain TopoJSON covers world→country zoom comfortably.

### 6.3 Data source and asset pipeline

**[Natural Earth](https://www.naturalearthdata.com/)** — public domain, no attribution required
(we credit it anyway), published at 1:110m (world), 1:50m (continent), 1:10m (country/region).
`world-atlas` on npm is Natural Earth pre-converted to TopoJSON at 110m/50m — the quickest start.

Alternatives with caveats: **OSM extracts** via Geofabrik or `osm-boundaries` (finer and fresher;
ODbL, so attribution + share-alike). **GADM** is finer still but **non-commercial licence only** —
avoid. **Wikimedia blank SVGs** have no coordinates, so distances degrade to pixels — that's what
image mode is for, don't fake it with a map.

Pipeline, run offline and committed:

1. Download the Natural Earth shapefile for the layer + scale.
2. `mapshaper -clip bbox=… -simplify 5% visvalingam -filter-fields NAME -o format=topojson`
   Simplify aggressively; a quiz map wants *fewer* squiggles.
3. Output to `public/geo/{preset}/{layer}.{detail}.topo.json`.
4. Expand with `topojson-client` at runtime (TopoJSON is 5–10× smaller on the wire because it
   dedupes shared borders).
5. **Budget: ≤300 KB gzip per round's total layer set on the phone.** If over, simplify harder,
   drop to a coarser scale, or clip tighter.
6. Hash into the filename, serve `Cache-Control: public, max-age=31536000, immutable`, brotli on.

Never fetch map data from a third-party CDN at runtime. A CDN hiccup on quiz night kills the game.
Self-host everything (§10).

### 6.4 Presets

A "preset" bundles a bbox, a default detail scale, and a default layer set:
`world`, `europe`, `germany`, `alps`, … Defined in `packages/protocol/presets.ts` so the quiz file
can just say `"preset": "europe"`. `surface_meta` on the round stores the resolved layer list and
bbox, so a room stays reproducible even if presets change later.

---

## 7. Image surfaces

New first-class mode: the surface is a picture, and the pin is a point on that picture.

### 7.1 Renderer

Do **not** try to bend MapLibre into non-geographic coordinates. Write a small dedicated component
(~150 lines) in `packages/surface`:

- `<img>` (or `<canvas>`) inside a container, sized with `object-fit: contain`.
- Pan/zoom via a CSS `transform: translate() scale()` with pointer events (pointerdown/move/up
  handles mouse and touch uniformly); pinch via two active pointers.
- Click → normalised coords:
  ```ts
  const r = imgEl.getBoundingClientRect();          // the rendered image box, not the container
  const x = (e.clientX - r.left) / r.width;         // 0..1
  const y = (e.clientY - r.top)  / r.height;        // 0..1
  ```
  Reject clicks outside `[0,1]` (the letterboxed area).
- Same click-vs-drag guard as the map: a pointerup that moved >8 px is a pan, not a guess.

Drop-in alternative if we don't want to write it: **Leaflet with `L.CRS.Simple` + `L.imageOverlay`**
does image-as-map natively with pan/zoom for free. The cost is carrying a second map library in the
bundle. Decide once, note it here.

### 7.2 Coordinates and stored meta

`CONSTRAINT` **Store normalised `{x, y}` in 0..1, never raw pixels.** Screen size, DPR, and zoom all
differ between the phone that submitted and the TV that displays. Normalised coordinates are the
only representation that survives.

`surface_meta` for an image round records the intrinsic size so pixel distances are well-defined:

```jsonc
{ "natural_width": 4032, "natural_height": 3024, "fit": "contain" }
```

### 7.3 Distance on an image

Compute in normalised space, then present in whichever units make sense:

```ts
const dx = (a.x - s.x) * naturalWidth;
const dy = (a.y - s.y) * naturalHeight;
const px = Math.hypot(dx, dy);
const pctDiag = 100 * px / Math.hypot(naturalWidth, naturalHeight);
```

Show **both** "318 px" and "7.4 % of image" — the percentage is the honest, device-independent one
and is the better thing to put on the Board; pixels are the intuitive one for the host.

`OPEN` — optional real-world scale: let the quiz file supply
`"scale": { "px_per_unit": 12.4, "unit": "m" }` (or two calibration points plus a known distance),
and the Board can then say "38 m off" for floorplans, maps-as-images, or aerial photos. Cheap to add,
skip for v1.

---

## 8. The `<QuizSurface>` abstraction

One component, two backends. Nothing above it may know which is which.

```ts
type SurfacePoint =
  | { kind: 'geo';   lat: number; lng: number }
  | { kind: 'image'; x: number;   y: number };

<QuizSurface
  surface={round.surface}            // discriminated union, geo | image
  mode="answer" | "spectate"         // answer = one draggable-then-submittable pin
  myPin={SurfacePoint | null}
  revealedPins={{ player, point, order, distance }[]}
  solution={SurfacePoint | null}
  onPick={(p: SurfacePoint) => void}
/>
```

Distance is computed by one exported function that switches on `kind`:

- `geo` → `turf.distance([lng,lat],[lng,lat],{units:'kilometers'})` (haversine).
  **Note turf's lng-first argument order** — wrap it once here and never call turf elsewhere.
- `image` → §7.3.

**When distance is computed and stored:** the moment a given answer is revealed *and* a solution
exists. Because the host may drop the solution before, between, or after individual reveals, both
paths must fill it in:

- revealing an answer while `rounds.revealed_solution` is set → compute for that answer;
- revealing the solution → compute for **all already-revealed** answers in that round in one update.

Freeze the result into `answers.distance` rather than recomputing on every render, so the Board, the
Host recap, and the export can never disagree.

### Board rendering during `revealing`

- Revealed pins numbered in `reveal_order`, each with the player's nickname.
- Solution rendered distinctly (different shape/colour, not just a different hue — think colour-blind
  viewers and a badly-calibrated projector).
- A thin line from each revealed pin to the solution with the distance as a label, once both exist.
- Animate the arrival of each pin. This is the dramatic beat of the whole format; it's worth the
  effort.

---

## 9. Host device: locking, recovery, and authority

`CONSTRAINT` On iOS, when the screen locks or the browser is backgrounded, **JavaScript stops** —
not throttled, stopped — and WebSockets are dropped. Every browser on iOS uses WebKit, so this is
universal there. Android Chrome freezes and eventually discards background tabs too.

This is precisely why Supabase holds the truth instead of the host browser. A locked tablet is a
**non-event**: the DB keeps the state, the SDK reconnects on resume, `resync()` repairs the view.

Host recovery is deliberately low-security:

- The anonymous session lives in `localStorage`, so unlock → same tab → same `auth.uid()` → still
  host. This covers the common case with no user action at all.
- `rooms.host_claim_code` (4–6 chars, shown on the Host screen and in the room-created dialog) lets
  **any** device open `/host` and take over by typing it: it sets `rooms.host_id = auth.uid()`.
- Consequence, stated plainly: anyone who can see the host tablet can take over the room. That is an
  accepted trade-off for this project — the alternative costs more friction than the risk is worth.
  `CONSTRAINT` It does mean the claim code must not be shown on the **Board**.
- Only one host at a time. The previous host device, on its next write, gets an RLS failure → show
  "another device took over as host" rather than a raw error.
- The Board and players do not care who the host is; they only read room state.

---

## 10. Hosting and deployment

### 10.1 Supabase

Single free project, no staging project. Relevant free-tier numbers (mid-2026 — verify at
`supabase.com/pricing` before relying on them): 500 MB database, 1 GB Storage, 5 GB egress,
200 concurrent realtime connections, 2M realtime messages/month, 500k Edge Function invocations,
unlimited API requests, no backups.

- **Projects pause after 7 days of no database activity.** Accepted: the host will restore the
  project from the dashboard before an event. Put it on the pre-quiz checklist (§12) — restoring
  takes a couple of minutes and must not be discovered at 19:55.
- 200 concurrent connections is one per device; a party never comes close. Still close channels on
  `pagehide` so abandoned tabs don't linger.
- Housekeeping: a `delete from rooms where expires_at < now()` called on room creation keeps the
  500 MB and the 1 GB Storage bucket clear without any cron.

### 10.2 GitHub → Supabase

Works on the free plan (since April 2026): connect the repo under *Project Settings → Integrations →
Authorize GitHub*, enable "Deploy to production", and migrations in `supabase/migrations/` are applied
on push to `main`. Preview branches per PR still need Pro — not needed here.

Turn on "Require status checks to pass before merging" on `main` so a broken migration can't land.
Local loop: `supabase init` / `link` / `db diff -f <name>` / `start`.

### 10.3 Frontend on the Debian box behind a Cloudflare Tunnel

Target setup: **static SPA served by Caddy (or nginx) on Debian, exposed through `cloudflared`.**

- **TLS is handled at the Cloudflare edge**, so the public origin is HTTPS with no certbot and no
  open inbound ports. This satisfies the secure-context requirement for Wake Lock, service workers,
  and clipboard APIs — all of which we need. The tunnel's origin leg can be plain HTTP on
  `127.0.0.1`.
- `cloudflared` runs as a systemd service with a named tunnel and a `config.yml` ingress rule
  pointing at the local web server. Keep the tunnel credentials out of the repo.
- Realtime traffic goes **browser → Supabase directly**, never through the tunnel. So Cloudflare's
  WebSocket behaviour, tunnel restarts, and origin latency are all irrelevant to gameplay sync.
  Only static assets ride the tunnel.
- Web server config:
  - SPA fallback: `try_files $uri /index.html` (Caddy: `try_files {path} /index.html`).
  - Hashed assets → `Cache-Control: public, max-age=31536000, immutable`.
  - **`index.html` → `Cache-Control: no-cache`.** Cloudflare does not cache HTML by default, but be
    explicit; a stale shell after a deploy is a nasty, hard-to-diagnose failure.
  - brotli/gzip on — the TopoJSON layers compress extremely well.
  - Cloudflare will happily edge-cache the hashed `/geo/*` and `/assets/*` files. That's a win; make
    sure the filenames really are content-hashed so no purge is ever needed.
- **Deployment, with no inbound ports:** run a **self-hosted GitHub Actions runner** on the Debian
  box. It polls outbound, so nothing needs to be exposed. Workflow: checkout → `pnpm build` → build
  into a timestamped directory → atomically swap a symlink to it. Atomic swap matters: without it
  there's a window where a player loads a half-written app.
  - Alternatives if a self-hosted runner is unwanted: a `git pull && build` on a cron/systemd timer,
    or SSH from Actions through Cloudflare Access with a service token. `OPEN` — pick one.
- Put the app on a **short, memorable path**. Players type it on phones. Show a QR code on the Board
  in the lobby, plus the room code in large type.
- `OPEN`: separate hostnames or paths per role (`/play`, `/host`, `/board`) — paths are simpler and
  keep one origin, so one deploy and one storage/auth origin. Recommend paths.

### 10.4 Secrets and client env vars

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` may appear in the client bundle; they're public by design
and RLS is what protects the data. `SUPABASE_SERVICE_ROLE_KEY` never touches the frontend, a bundled
`.env`, or the repo — GitHub Actions secrets and (if ever used) Edge Functions only.

**How the client reads them (Vite).** Vite only exposes vars prefixed `VITE_` to the bundle, so the
two required client vars are:

| Var | Source (Supabase dashboard → Settings → API) | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` | yes |
| `VITE_SUPABASE_ANON_KEY` | Project API keys → `anon` `public` | yes |

- `CONSTRAINT` The `VITE_` prefix is mandatory — a var without it is invisible to `import.meta.env`
  at build time. Never name a client var `SUPABASE_SERVICE_ROLE_KEY` (or prefix it `VITE_`); the
  prefix is exactly what would leak it into the bundle.
- Live at `apps/web/.env` (loaded by Vite), **gitignored**. Commit `apps/web/.env.example` with the
  keys present and values blank as the canonical list of what a build needs.
- Read them in **one module only** (`packages/supabase` once it exists; until then a single
  `apps/web/src/lib/supabase.ts`), and **fail fast** at startup if either is missing — a blank
  `VITE_SUPABASE_URL` otherwise surfaces as a confusing runtime 404, not a clear "env not set".

  ```ts
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  ```

- These are **build-time** values: the CI/CD build (§10.3) must have them in its environment, since
  `import.meta.env` is inlined at build, not read at runtime on the box.

`.env.example` template:

```dotenv
# apps/web/.env — copy to .env and fill from Supabase → Settings → API. Never commit .env.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## 11. Screen and device requirements

### 11.1 Keep the screen on

**Screen Wake Lock API** — Chrome/Edge 84+, Firefox 126+, Safari 16.4+ (desktop and iOS). Installed
iOS home-screen web apps had a bug that broke it until iOS 18.4.

```ts
let sentinel: WakeLockSentinel | null = null;
async function acquire() {
  try { sentinel = await navigator.wakeLock.request('screen'); }
  catch { /* low battery / power saver / unsupported — degrade silently */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sentinel === null) acquire();
});
```

- Requires a secure context — satisfied by the Cloudflare Tunnel's HTTPS origin.
- **Released automatically whenever the page is hidden**, so the `visibilitychange` re-acquire is
  mandatory, not optional.
- Can be refused or revoked by the OS. Always `try/catch`; never build UX that assumes it's held.
- It prevents *auto*-dimming; it does not stop the power button.

Per screen: **Host** acquires for the whole session (plus: set the tablet's auto-lock to Never, and
consider Guided Access). **Board** acquires too, but OS power settings and screensaver-off matter
more. **Player** acquires during `prompt`/`answering`, releases afterwards to save battery.

### 11.2 Resume, don't persist

```ts
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  channel.socket.connect();   // no-op if connected
  resync();
});
window.addEventListener('online',  () => { channel.socket.connect(); resync(); });
window.addEventListener('offline', () => store.setConnection('offline'));
window.addEventListener('pageshow', e => { if (e.persisted) resync(); }); // bfcache
window.addEventListener('pagehide', cleanup);  // the only reliable teardown event on iOS
```

Don't bother with Service Workers as keep-alives, Web Push wakeups, or silent-audio hacks. None of
them work for this.

### 11.3 Touch and layout

- `overscroll-behavior: none` on `html, body` — kills pull-to-refresh, which an upward drag on a map
  or image triggers constantly.
- `touch-action: none` on the surface container (we handle all gestures ourselves);
  `touch-action: manipulation` elsewhere to drop the 300 ms double-tap delay.
- `user-select: none` and `-webkit-touch-callout: none` on the surface — stops the long-press
  copy/share bubble, which is especially annoying over an `<img>`. Also set `draggable={false}` on
  the image or iOS offers to drag it out.
- **`100dvh`, never `100vh`.**
- `viewport-fit=cover` + `env(safe-area-inset-*)` for notch and home indicator.
- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`
  — we want surface pinch-zoom, not page pinch-zoom.

### 11.4 Orientation

`CONSTRAINT` `screen.orientation.lock()` works only in fullscreen or an installed PWA and **not at
all on iOS Safari**. Don't depend on it. Make each route responsive and show a polite "please rotate"
overlay via a CSS media query where an orientation is genuinely unusable. Phone → portrait-first;
Host and Board → landscape-first.

### 11.5 Board specifics

- Fullscreen API behind a "Go fullscreen" button (needs a user gesture).
- `cursor: none` after ~3 s idle.
- 10-foot UI: ≥32 px base font at 1080p, high contrast, no thin weights.
- **Overscan**: some TVs crop 3–5 % of the edges over HDMI. Keep everything critical inside a 5 %
  inset — especially the room code and QR.
- Long uptime: clean up every interval, MapLibre instance, image object URL, and channel in effect
  teardown. A three-hour quiz will find the one you missed.

### 11.6 PWA (optional, mainly for the Host)

`display: standalone` gives the tablet a chrome-free moderator view, a home-screen icon, and more
durable storage for the anon session on iOS. Avoid an aggressive service-worker cache during
development — a stale shell on quiz night is worse than a slow first load.

---

## 12. Pre-quiz checklist (ship this as a page in the app)

1. Restore the Supabase project if it has paused (7-day rule).
2. Open the Board, go fullscreen, confirm the room code and QR are inside the safe area.
3. Set the tablet to never auto-lock; confirm the wake lock chip is green.
4. Upload the quiz; step through every round in a "dry run" mode that shows the surface without
   opening answering (`OPEN` — worth building, it catches broken images and bad bboxes).
5. Confirm one phone can join, submit, and see a reveal.

---

## 13. Build order

Each step de-risks the next.

1. Schema + RLS + anonymous auth. Prove from two browsers that a player cannot read
   `round_solutions` or another player's unrevealed answer.
2. Room creation, join-by-code, presence lobby across three real devices.
3. The full phase machine and reveal flow **with no surface at all** — just buttons, a phase label,
   and a list of fake answers. Then **lock the host tablet for 60 seconds and confirm everything
   repairs itself.** Do this before building any UI you'd be sad to throw away.
4. Quiz file schema + upload + validation.
5. `<QuizSurface>` geo backend with Natural Earth layers; click → lat/lng; reveal + distance.
6. `<QuizSurface>` image backend; upload to Storage; normalised coords; pixel/percent distance.
7. Manual scoring, leaderboard, export.
8. Board polish, wake locks, PWA, deployment pipeline, checklist page.

---

## 14. Conventions

- TypeScript `strict: true`; no `any` in `packages/protocol`.
- `supabase gen types typescript --linked > packages/supabase/src/database.types.ts`, committed, and
  regenerated in the same commit as the migration that changes the schema.
- Validate every realtime payload and the whole quiz file with zod at the boundary.
- `SurfacePoint` is the only representation of a point anywhere in the codebase. No loose
  `{lat,lng}` and no raw pixels outside the image renderer.
- All time is `timestamptz`, UTC, server-generated. Never `new Date()` for anything authoritative.
- Every host action that changes what is *visible* (not just what exists) bumps `rooms.reveal_seq`
  in the same transaction.
- Co-locate tests with source; Vitest.