-- Migration 0005: fix quizcode generation.
-- 0004 used gen_random_bytes() (pgcrypto), which is not on the function's
-- search_path on Supabase → "function gen_random_bytes(integer) does not exist".
-- gen_random_uuid() is core and already used for table defaults, so derive the
-- code from it: 16 uuid bytes → base64 → url-safe → ~120 bits, no extension.

create or replace function public._new_quizcode()
returns text language sql volatile as $$
  select rtrim(
    translate(
      encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
      '+/', '-_'
    ),
    '='
  );
$$;
