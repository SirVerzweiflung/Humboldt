-- Migration 0006: new quizzes start with a blank title so the editor's
-- "Quiz name" placeholder shows (was defaulting to 'Untitled quiz', a real value
-- that hid the placeholder). quiz_save still coalesces, so a blank title is fine.
alter table public.quizzes alter column title set default '';
