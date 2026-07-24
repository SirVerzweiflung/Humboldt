-- Migration 0004: authored quizzes (CLAUDE.md §3/§4).
-- The quiz_* tables hold secret solutions, so they are RLS deny-all: no client
-- may read or write them directly. All access is through SECURITY DEFINER RPCs
-- that take the secret quizcode and run as owner. The quizcode (≈120 bits) is
-- the sole credential — knowing it lets you load and save the quiz.

-- ── tables ────────────────────────────────────────────────────────────────
create table public.quizzes (
  id         uuid primary key default gen_random_uuid(),
  quizcode   text unique not null,
  title      text not null default 'Untitled quiz',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quiz_questions (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes on delete cascade,
  idx          int  not null,
  prompt       text not null default '',
  surface_kind text not null,               -- 'geo' | 'image'
  surface_ref  text not null default '',    -- geo: preset id | image: relative upload URL
  surface_meta jsonb not null default '{}',
  unique (quiz_id, idx)
);

create table public.quiz_solutions (
  question_id uuid primary key references public.quiz_questions on delete cascade,
  quiz_id     uuid not null references public.quizzes on delete cascade,
  solution    jsonb,                        -- geo: {lat,lng} | image: {x,y} 0..1 | null if unset
  label       text
);

-- Deny-all: RLS on, zero policies. Only the SECURITY DEFINER functions below
-- (owned by the migration role) can touch these tables.
alter table public.quizzes        enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_solutions enable row level security;

-- ── helpers ──────────────────────────────────────────────────────────────
-- URL-safe 120-bit code: base64(15 bytes) → url-safe, strip padding.
create or replace function public._new_quizcode()
returns text language sql volatile as $$
  select rtrim(translate(encode(gen_random_bytes(15), 'base64'), '+/', '-_'), '=');
$$;

-- ── RPCs ─────────────────────────────────────────────────────────────────
create or replace function public.quiz_create()
returns table (id uuid, quizcode text)
language plpgsql security definer set search_path = public as $$
declare
  new_code text := _new_quizcode();
  new_id   uuid;
begin
  insert into quizzes (quizcode) values (new_code) returning quizzes.id into new_id;
  return query select new_id, new_code;
end;
$$;

-- Full quiz (questions + secret solutions) for the editor. Null if code unknown.
create or replace function public.quiz_load(p_quizcode text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  q       quizzes%rowtype;
  result  jsonb;
begin
  select * into q from quizzes where quizcode = p_quizcode;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'id', q.id,
    'quizcode', q.quizcode,
    'title', q.title,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', qq.id,
        'idx', qq.idx,
        'prompt', qq.prompt,
        'surface_kind', qq.surface_kind,
        'surface_ref', qq.surface_ref,
        'surface_meta', qq.surface_meta,
        'solution', qs.solution,
        'label', qs.label
      ) order by qq.idx)
      from quiz_questions qq
      left join quiz_solutions qs on qs.question_id = qq.id
      where qq.quiz_id = q.id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- Replace the quiz's title + all questions/solutions from the payload.
-- payload: { "title": text, "questions": [
--   { "prompt", "surface_kind", "surface_ref", "surface_meta", "solution", "label" } ... ] }
-- Question order is the array order (idx assigned here).
create or replace function public.quiz_save(p_quizcode text, p_payload jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  q     quizzes%rowtype;
  item  jsonb;
  i     int := 0;
  new_q uuid;
begin
  select * into q from quizzes where quizcode = p_quizcode;
  if not found then
    raise exception 'unknown quizcode';
  end if;

  update quizzes
     set title = coalesce(p_payload->>'title', title), updated_at = now()
   where id = q.id;

  -- Simplest correct approach: wipe and re-insert (cascade clears solutions).
  delete from quiz_questions where quiz_id = q.id;

  for item in select * from jsonb_array_elements(coalesce(p_payload->'questions', '[]'::jsonb))
  loop
    insert into quiz_questions (quiz_id, idx, prompt, surface_kind, surface_ref, surface_meta)
    values (
      q.id, i,
      coalesce(item->>'prompt', ''),
      item->>'surface_kind',
      coalesce(item->>'surface_ref', ''),
      coalesce(item->'surface_meta', '{}'::jsonb)
    )
    returning id into new_q;

    insert into quiz_solutions (question_id, quiz_id, solution, label)
    values (new_q, q.id, item->'solution', item->>'label');

    i := i + 1;
  end loop;

  return true;
end;
$$;

-- Anonymous (and authenticated) clients may call the RPCs; the code is the gate.
grant execute on function public.quiz_create()            to anon, authenticated;
grant execute on function public.quiz_load(text)          to anon, authenticated;
grant execute on function public.quiz_save(text, jsonb)   to anon, authenticated;
