import { z } from "zod";

// Validates the editor payload at the boundary (CLAUDE.md §14), both before save
// and after load. surface_meta is kept loose (record) — its shape is enforced by
// the geo/image editors that produce it.

export const surfacePointSchema = z.union([
  z.object({ kind: z.literal("geo"), lat: z.number(), lng: z.number() }),
  z.object({ kind: z.literal("image"), x: z.number(), y: z.number() }),
]);

export const questionSchema = z.object({
  id: z.string().optional(),
  prompt: z.string(),
  surface_kind: z.enum(["geo", "image"]),
  surface_ref: z.string(),
  surface_meta: z.record(z.string(), z.unknown()),
  solution: surfacePointSchema.nullable(),
  label: z.string().nullable().default(""),
});

export const quizSchema = z.object({
  id: z.string(),
  quizcode: z.string(),
  title: z.string(),
  questions: z.array(questionSchema),
});

export type QuizQuestion = z.infer<typeof questionSchema>;
export type Quiz = z.infer<typeof quizSchema>;
