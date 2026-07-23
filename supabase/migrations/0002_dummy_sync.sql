-- Migration 0002: RLS on rooms + a throwaway dummy_pings table for the realtime
-- sync scaffold. Everything about dummy_pings is temporary and meant to be dropped
-- once real gameplay lands (§13). rooms RLS here is the real, keep-forever policy set
-- (the light version described in CLAUDE.md §3).

-- ── rooms: enable RLS + policies ─────────────────────────────────────────
alter table public.rooms enable row level security;

-- Anyone (incl. anon) can look a room up — needed to join by code.
create policy rooms_select_all
  on public.rooms for select
  using (true);

-- Only the owning device may create / mutate a room.
create policy rooms_insert_own
  on public.rooms for insert
  with check (host_id = auth.uid());

create policy rooms_update_own
  on public.rooms for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- ===== DUMMY SYNC TEST START =====
-- Throwaway. Delete this whole block (and the table) when real answers land.
create table public.dummy_pings (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms on delete cascade,
  player_id  uuid not null,
  counter    int  not null,
  created_at timestamptz not null default now()
);

create index dummy_pings_room_idx on public.dummy_pings (room_id, created_at);

alter table public.dummy_pings enable row level security;

-- Anyone in the room can read the pings (host list, and any future board view).
create policy dummy_pings_select_all
  on public.dummy_pings for select
  using (true);

-- A device may only insert pings authored by itself.
create policy dummy_pings_insert_own
  on public.dummy_pings for insert
  with check (player_id = auth.uid());

-- Realtime: emit Postgres Changes for this table so the host can subscribe.
alter publication supabase_realtime add table public.dummy_pings;
-- ===== DUMMY SYNC TEST END =====
-- ═══════════════════════════════════════════════════════════════════════════
