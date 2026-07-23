-- First migration: the rooms table (CLAUDE.md §3).
-- Just enough real schema for the GitHub -> Supabase integration to apply on push.
-- RLS, other tables (rounds, players, answers, ...) come in later migrations.

create table if not exists public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,          -- 6 chars, unambiguous alphabet (no O/0/I/1)
  host_id           uuid not null,                 -- auth.uid() of the current host device
  host_claim_code   text not null,                 -- short code to (re)claim host (§9)
  phase             text not null default 'lobby', -- lobby|prompt|answering|revealing|scoring|ended
  current_round_idx int  not null default -1,
  reveal_seq        int  not null default 0,       -- bumped on every reveal action (§5)
  protocol_version  int  not null,
  quiz_title        text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 days'
);
