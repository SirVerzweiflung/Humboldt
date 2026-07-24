-- Migration 0009: add the missing rooms.source_quiz_id column.
-- attach_quiz (0008) writes it and CLAUDE.md §3 documents it, but no migration
-- ever added it to the table → "column source_quiz_id of relation rooms does not
-- exist" on Attach. Provenance only; nullable.
alter table public.rooms add column if not exists source_quiz_id uuid;
