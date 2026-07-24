-- Migration 0008: the actual game (CLAUDE.md §3/§5/§8).
-- rounds/answers/round_solutions/score_events + game RPCs. All state changes go
-- through SECURITY DEFINER RPCs; every visibility-changing one bumps
-- rooms.reveal_seq so clients can reconcile off a single rooms subscription (§5).

-- ── tables ──────────────────────────────────────────────────────────────
create table public.rounds (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references public.rooms on delete cascade,
  idx                  int  not null,
  prompt               text not null default '',
  surface_kind         text not null,
  surface_ref          text not null default '',
  surface_meta         jsonb not null default '{}',
  opened_at            timestamptz,
  closed_at            timestamptz,
  solution_revealed_at timestamptz,
  revealed_solution    jsonb,                 -- null until host reveals; then a copy of the secret
  unique (room_id, idx)
);

create table public.round_solutions (         -- SECRET: host-only RLS
  round_id uuid primary key references public.rounds on delete cascade,
  room_id  uuid not null references public.rooms on delete cascade,
  solution jsonb,
  label    text
);

create table public.answers (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms on delete cascade,
  round_id     uuid not null references public.rounds on delete cascade,
  player_id    uuid not null references public.players on delete cascade,
  position     jsonb not null,
  submitted_at timestamptz not null default now(),
  revealed_at  timestamptz,                   -- null until host reveals this specific answer
  reveal_order int,                           -- order the host revealed them (host's choice)
  distance     jsonb,
  unique (round_id, player_id)
);

create table public.score_events (            -- append-only manual awards
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms on delete cascade,
  round_id   uuid references public.rounds on delete set null,
  player_id  uuid not null references public.players on delete cascade,
  delta      int not null,
  reason     text,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.rounds          enable row level security;
alter table public.round_solutions enable row level security;
alter table public.answers         enable row level security;
alter table public.score_events    enable row level security;

-- rounds: public content (question + map + revealed_solution). Writes via RPC.
create policy rounds_select_all on public.rounds for select using (true);

-- round_solutions: only the room's host may read the secret.
create policy round_solutions_host on public.round_solutions for select
  using (exists (select 1 from public.rooms r where r.id = round_solutions.room_id and r.host_id = auth.uid()));

-- answers: readable if revealed, OR you're the host, OR it's your own player
-- (current device). Writes via RPC only.
create policy answers_select on public.answers for select using (
  revealed_at is not null
  or exists (select 1 from public.rooms r   where r.id = answers.room_id   and r.host_id  = auth.uid())
  or exists (select 1 from public.players p where p.id = answers.player_id and p.device_id = auth.uid())
);

-- score_events: public (scores are summed client-side). Writes via RPC.
create policy score_events_select_all on public.score_events for select using (true);

-- ── realtime ────────────────────────────────────────────────────────────
-- rooms drives phase/round/reveal_seq sync; the rest deliver fine-grained events.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.rounds;
alter publication supabase_realtime add table public.answers;
alter publication supabase_realtime add table public.score_events;

-- ── helpers ──────────────────────────────────────────────────────────────
-- Raise unless the caller is the host of the given room; returns the room row.
create or replace function public._host_room(p_room_id uuid)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare rm public.rooms;
begin
  select * into rm from rooms where id = p_room_id;
  if not found then raise exception 'no such room'; end if;
  if rm.host_id is distinct from auth.uid() then raise exception 'not host'; end if;
  return rm;
end; $$;

create or replace function public._bump(p_room_id uuid)
returns void language sql security definer set search_path = public as $$
  update rooms set reveal_seq = reveal_seq + 1 where id = p_room_id;
$$;

-- ── RPCs ─────────────────────────────────────────────────────────────────
-- Snapshot a quiz into this room's rounds + solutions. Host only; once only.
create or replace function public.attach_quiz(p_room_code text, p_quizcode text)
returns int language plpgsql security definer set search_path = public as $$
declare rm rooms%rowtype; qz quizzes%rowtype; q record; new_round uuid; n int := 0;
begin
  select * into rm from rooms where code = upper(p_room_code);
  if not found then raise exception 'no such room'; end if;
  if rm.host_id is distinct from auth.uid() then raise exception 'not host'; end if;
  if exists (select 1 from rounds where room_id = rm.id) then raise exception 'quiz already attached'; end if;
  select * into qz from quizzes where quizcode = p_quizcode;
  if not found then raise exception 'no such quiz'; end if;

  for q in select * from quiz_questions where quiz_id = qz.id order by idx loop
    insert into rounds (room_id, idx, prompt, surface_kind, surface_ref, surface_meta)
      values (rm.id, q.idx, q.prompt, q.surface_kind, q.surface_ref, q.surface_meta)
      returning id into new_round;
    insert into round_solutions (round_id, room_id, solution, label)
      select new_round, rm.id, s.solution, s.label from quiz_solutions s where s.question_id = q.id;
    n := n + 1;
  end loop;

  update rooms set quiz_title = qz.title, source_quiz_id = qz.id where id = rm.id;
  return n;
end; $$;

create or replace function public.start_quiz(p_room_code text)
returns void language plpgsql security definer set search_path = public as $$
declare rm rooms%rowtype;
begin
  select * into rm from rooms where code = upper(p_room_code);
  perform _host_room(rm.id);
  if not exists (select 1 from rounds where room_id = rm.id) then raise exception 'no quiz attached'; end if;
  update rounds set opened_at = now() where room_id = rm.id and idx = 0;
  update rooms set phase = 'answering', current_round_idx = 0, reveal_seq = reveal_seq + 1 where id = rm.id;
end; $$;

create or replace function public.kick_player(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select room_id into rid from players where id = p_player_id;
  if rid is null then return; end if;
  perform _host_room(rid);
  delete from players where id = p_player_id;   -- cascades answers + score_events
  perform _bump(rid);
end; $$;

-- Player locks in an answer. Only the player's current device may submit.
create or replace function public.submit_answer(p_player_id uuid, p_position jsonb)
returns public.answers language plpgsql security definer set search_path = public as $$
declare pl players%rowtype; rm rooms%rowtype; rd rounds%rowtype; a answers%rowtype;
begin
  select * into pl from players where id = p_player_id;
  if not found then raise exception 'no such player'; end if;
  if pl.device_id is distinct from auth.uid() then raise exception 'not your player'; end if;
  select * into rm from rooms where id = pl.room_id;
  if rm.phase <> 'answering' then raise exception 'not accepting answers'; end if;
  select * into rd from rounds where room_id = rm.id and idx = rm.current_round_idx;
  if not found or rd.closed_at is not null then raise exception 'question closed'; end if;

  insert into answers (room_id, round_id, player_id, position)
    values (rm.id, rd.id, pl.id, p_position)
    returning * into a;   -- unique(round,player) → error if already locked
  perform _bump(rm.id);
  return a;
end; $$;

create or replace function public.unlock_answer(p_answer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select room_id into rid from answers where id = p_answer_id;
  if rid is null then return; end if;
  perform _host_room(rid);
  delete from answers where id = p_answer_id;
  perform _bump(rid);
end; $$;

create or replace function public.close_question(p_room_code text)
returns void language plpgsql security definer set search_path = public as $$
declare rm rooms%rowtype;
begin
  select * into rm from rooms where code = upper(p_room_code);
  perform _host_room(rm.id);
  update rounds set closed_at = now() where room_id = rm.id and idx = rm.current_round_idx;
  update rooms set phase = 'revealing', reveal_seq = reveal_seq + 1 where id = rm.id;
end; $$;

-- Reveal one specific player's answer (arbitrary order, host's choice).
create or replace function public.reveal_answer(p_answer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a answers%rowtype; nxt int;
begin
  select * into a from answers where id = p_answer_id;
  if not found then raise exception 'no such answer'; end if;
  perform _host_room(a.room_id);
  if a.revealed_at is not null then return; end if;
  select coalesce(max(reveal_order), 0) + 1 into nxt from answers where round_id = a.round_id;
  update answers set revealed_at = now(), reveal_order = nxt where id = a.id;
  perform _bump(a.room_id);
end; $$;

create or replace function public.reveal_solution(p_room_code text)
returns void language plpgsql security definer set search_path = public as $$
declare rm rooms%rowtype; rd rounds%rowtype;
begin
  select * into rm from rooms where code = upper(p_room_code);
  perform _host_room(rm.id);
  select * into rd from rounds where room_id = rm.id and idx = rm.current_round_idx;
  update rounds set revealed_solution = (select solution from round_solutions where round_id = rd.id),
                    solution_revealed_at = now()
    where id = rd.id;
  perform _bump(rm.id);
end; $$;

create or replace function public.award_point(p_player_id uuid, p_delta int, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl players%rowtype; rm rooms%rowtype; rd_id uuid;
begin
  select * into pl from players where id = p_player_id;
  if not found then raise exception 'no such player'; end if;
  select * into rm from rooms where id = pl.room_id;
  if rm.host_id is distinct from auth.uid() then raise exception 'not host'; end if;
  select id into rd_id from rounds where room_id = rm.id and idx = rm.current_round_idx;
  insert into score_events (room_id, round_id, player_id, delta, reason, created_by)
    values (rm.id, rd_id, pl.id, p_delta, p_reason, auth.uid());
  perform _bump(rm.id);
end; $$;

create or replace function public.next_round(p_room_code text)
returns void language plpgsql security definer set search_path = public as $$
declare rm rooms%rowtype; n int; nxt int;
begin
  select * into rm from rooms where code = upper(p_room_code);
  perform _host_room(rm.id);
  select count(*) into n from rounds where room_id = rm.id;
  nxt := rm.current_round_idx + 1;
  if nxt < n then
    update rounds set opened_at = now() where room_id = rm.id and idx = nxt;
    update rooms set phase = 'answering', current_round_idx = nxt, reveal_seq = reveal_seq + 1 where id = rm.id;
  else
    update rooms set phase = 'ended', reveal_seq = reveal_seq + 1 where id = rm.id;
  end if;
end; $$;

grant execute on function public.attach_quiz(text, text)     to anon, authenticated;
grant execute on function public.start_quiz(text)            to anon, authenticated;
grant execute on function public.kick_player(uuid)           to anon, authenticated;
grant execute on function public.submit_answer(uuid, jsonb)  to anon, authenticated;
grant execute on function public.unlock_answer(uuid)         to anon, authenticated;
grant execute on function public.close_question(text)        to anon, authenticated;
grant execute on function public.reveal_answer(uuid)         to anon, authenticated;
grant execute on function public.reveal_solution(text)       to anon, authenticated;
grant execute on function public.award_point(uuid, int, text) to anon, authenticated;
grant execute on function public.next_round(text)            to anon, authenticated;
