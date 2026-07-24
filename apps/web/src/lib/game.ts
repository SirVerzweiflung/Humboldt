import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { SurfacePoint } from "./surfacePoint";

// ── types (mirror the DB) ───────────────────────────────────────────────────
export type Phase = "lobby" | "answering" | "revealing" | "ended";

export type GameRoom = {
  id: string;
  code: string;
  host_id: string;
  phase: Phase;
  current_round_idx: number;
  reveal_seq: number;
  quiz_title: string | null;
};

export type GamePlayer = { id: string; nickname: string; joined_at: string; device_id: string | null };

export type Round = {
  id: string;
  idx: number;
  prompt: string;
  surface_kind: "geo" | "image";
  surface_ref: string;
  surface_meta: Record<string, unknown>;
  opened_at: string | null;
  closed_at: string | null;
  solution_revealed_at: string | null;
  revealed_solution: SurfacePoint | null;
};

export type Answer = {
  id: string;
  round_id: string;
  player_id: string;
  position: SurfacePoint;
  revealed_at: string | null;
  reveal_order: number | null;
};

export type Snapshot = {
  room: GameRoom;
  players: GamePlayer[]; // sorted by joined_at
  rounds: Round[]; // sorted by idx
  answers: Answer[]; // visible to this client (RLS)
  scores: Record<string, number>; // player_id → summed delta
  solution: SurfacePoint | null; // current round solution, only if host (RLS)
};

// ── snapshot fetch (§5: always reconcile against a fetch) ───────────────────
export async function fetchSnapshot(code: string): Promise<Snapshot | null> {
  const { data: room } = await supabase
    .from("rooms")
    .select("id, code, host_id, phase, current_round_idx, reveal_seq, quiz_title")
    .eq("code", code)
    .maybeSingle();
  if (!room) return null;
  const roomId = (room as GameRoom).id;

  const [players, rounds, answers, events] = await Promise.all([
    supabase.from("players").select("id, nickname, joined_at, device_id").eq("room_id", roomId).order("joined_at"),
    supabase.from("rounds").select("*").eq("room_id", roomId).order("idx"),
    supabase.from("answers").select("id, round_id, player_id, position, revealed_at, reveal_order").eq("room_id", roomId),
    supabase.from("score_events").select("player_id, delta").eq("room_id", roomId),
  ]);

  const scores: Record<string, number> = {};
  for (const e of (events.data ?? []) as { player_id: string; delta: number }[]) {
    scores[e.player_id] = (scores[e.player_id] ?? 0) + e.delta;
  }

  const roundList = (rounds.data ?? []) as Round[];
  const cur = roundList.find((r) => r.idx === (room as GameRoom).current_round_idx);
  let solution: SurfacePoint | null = null;
  if (cur) {
    const { data } = await supabase.from("round_solutions").select("solution").eq("round_id", cur.id).maybeSingle();
    solution = ((data as { solution: SurfacePoint } | null)?.solution) ?? null;
  }

  return {
    room: room as GameRoom,
    players: (players.data ?? []) as GamePlayer[],
    rounds: roundList,
    answers: (answers.data ?? []) as Answer[],
    scores,
    solution,
  };
}

export function currentRound(snap: Snapshot): Round | undefined {
  return snap.rounds.find((r) => r.idx === snap.room.current_round_idx);
}

// ── realtime hook ───────────────────────────────────────────────────────────
export function useRoom(code: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [missing, setMissing] = useState(false);

  const resync = useCallback(async () => {
    const s = await fetchSnapshot(code);
    if (s) setSnap(s);
    else setMissing(true);
  }, [code]);

  useEffect(() => {
    resync();
  }, [resync]);

  const roomId = snap?.room.id;
  useEffect(() => {
    if (!roomId) return;
    const tables = ["rooms", "players", "answers", "score_events", "rounds"];
    let ch = supabase.channel(`room:${code}`);
    for (const t of tables) {
      const filter = t === "rooms" ? `code=eq.${code}` : `room_id=eq.${roomId}`;
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter }, () => resync());
    }
    ch.subscribe((s) => {
      if (s === "SUBSCRIBED") resync();
    });
    const onVis = () => document.visibilityState === "visible" && resync();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", resync);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", resync);
    };
  }, [roomId, code, resync]);

  return { snap, missing, resync };
}

// ── RPC wrappers ─────────────────────────────────────────────────────────────
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
};

export const attachQuiz = (code: string, quizcode: string) => rpc("attach_quiz", { p_room_code: code, p_quizcode: quizcode });
export const startQuiz = (code: string) => rpc("start_quiz", { p_room_code: code });
export const kickPlayer = (playerId: string) => rpc("kick_player", { p_player_id: playerId });
export const submitAnswer = (playerId: string, position: SurfacePoint) => rpc("submit_answer", { p_player_id: playerId, p_position: position });
export const unlockAnswer = (answerId: string) => rpc("unlock_answer", { p_answer_id: answerId });
export const closeQuestion = (code: string) => rpc("close_question", { p_room_code: code });
export const revealAnswer = (answerId: string) => rpc("reveal_answer", { p_answer_id: answerId });
export const revealSolution = (code: string) => rpc("reveal_solution", { p_room_code: code });
export const awardPoint = (playerId: string, delta: number, reason?: string) => rpc("award_point", { p_player_id: playerId, p_delta: delta, p_reason: reason ?? null });
export const nextRound = (code: string) => rpc("next_round", { p_room_code: code });
