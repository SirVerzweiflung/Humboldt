import { supabase } from "./supabase";

export type Player = { id: string; room_id: string; nickname: string };

// Join or continue as a player by name (name = identity, §3). Idempotent.
export async function joinRoom(code: string, nickname: string): Promise<Player> {
  const { data, error } = await supabase.rpc("join_room", {
    p_code: code,
    p_nickname: nickname,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Player;
  return { id: row.id, room_id: row.room_id, nickname: row.nickname };
}

// ── device-local memory (CLAUDE.md: name saved so people don't retype it) ──
const NAME_KEY = "player_name";
const LAST_ROOM_KEY = "player_last_room";

export const savedName = {
  get: () => localStorage.getItem(NAME_KEY) ?? "",
  set: (n: string) => localStorage.setItem(NAME_KEY, n),
  clear: () => localStorage.removeItem(NAME_KEY), // "log out" — device only
};

export const lastRoom = {
  get: () => localStorage.getItem(LAST_ROOM_KEY) ?? "",
  set: (c: string) => localStorage.setItem(LAST_ROOM_KEY, c),
};
