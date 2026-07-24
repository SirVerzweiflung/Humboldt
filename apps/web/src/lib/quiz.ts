import { supabase } from "./supabase";
import { quizSchema, type Quiz, type QuizQuestion } from "./quizSchema";

// Thin wrappers over the code-gated RPCs (CLAUDE.md §3/§4). The client never
// touches the quiz_* tables directly — only these functions.

export type { Quiz, QuizQuestion };

export async function quizCreate(): Promise<{ id: string; quizcode: string }> {
  const { data, error } = await supabase.rpc("quiz_create");
  if (error) throw error;
  // quiz_create returns a single-row table.
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row.id as string, quizcode: row.quizcode as string };
}

// Returns the quiz, or null if the quizcode is unknown.
export async function quizLoad(quizcode: string): Promise<Quiz | null> {
  const { data, error } = await supabase.rpc("quiz_load", { p_quizcode: quizcode });
  if (error) throw error;
  if (!data) return null;
  return quizSchema.parse(data);
}

// payload questions are saved in array order (idx assigned server-side).
export async function quizSave(
  quizcode: string,
  title: string,
  questions: QuizQuestion[],
): Promise<void> {
  const { error } = await supabase.rpc("quiz_save", {
    p_quizcode: quizcode,
    p_payload: { title, questions },
  });
  if (error) throw error;
}
