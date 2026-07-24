-- Migration 0007: players (CLAUDE.md §3, revised).
-- Identity is the NAME within a room, not the device. Joining a room with a name
-- that already exists returns that same player row — so a dead phone can be
-- continued from another device by re-typing the name. No passwords: the group
-- knows each other (accepted, §3 "party game not a bank"). Only the host can
-- remove a player (kick), which is what deletes a score.

create table public.players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms on delete cascade,
  nickname   text not null,
  device_id  uuid,                          -- last auth.uid() that claimed this name (info only)
  joined_at  timestamptz not null default now()
);

-- Name identity, case-insensitive, unique per room. Expression index → used by
-- join_room's ON CONFLICT.
create unique index players_room_nick_idx on public.players (room_id, lower(nickname));

alter table public.players enable row level security;

-- Roster is public within the app (lobby, board, leaderboard). Writes go through
-- the SECURITY DEFINER RPCs below (join_room, and later a host kick), so no direct
-- insert/update/delete policies exist.
create policy players_select_all on public.players for select using (true);

alter publication supabase_realtime add table public.players;

-- Join (or continue as) a player by name. Idempotent: same name+room → same row.
create or replace function public.join_room(p_code text, p_nickname text)
returns public.players
language plpgsql security definer set search_path = public as $$
declare
  r    rooms%rowtype;
  nick text := btrim(p_nickname);
  pl   players%rowtype;
begin
  if nick = '' then raise exception 'empty nickname'; end if;
  if length(nick) > 40 then raise exception 'nickname too long'; end if;

  select * into r from rooms where code = upper(p_code);
  if not found then raise exception 'no such room'; end if;

  insert into players (room_id, nickname, device_id)
    values (r.id, nick, auth.uid())
    on conflict (room_id, lower(nickname))
    do update set device_id = auth.uid()
    returning * into pl;

  return pl;
end;
$$;

grant execute on function public.join_room(text, text) to anon, authenticated;
