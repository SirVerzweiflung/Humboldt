import { supabase } from "./supabase";

export type Player = { id: string; room_id: string; nickname: string; device_id: string | null };

// Join or continue as a player by name (name = identity, §3). Idempotent.
// Sets device_id to this device — which supersedes any other device on that name.
export async function joinRoom(code: string, nickname: string): Promise<Player> {
  const { data, error } = await supabase.rpc("join_room", {
    p_code: code,
    p_nickname: nickname,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Player;
  return { id: row.id, room_id: row.room_id, nickname: row.nickname, device_id: row.device_id };
}

// Current device_id on a player row, or null if the row is gone (e.g. host kick).
export async function fetchPlayerDevice(playerId: string): Promise<string | null | undefined> {
  const { data } = await supabase
    .from("players")
    .select("device_id")
    .eq("id", playerId)
    .maybeSingle();
  if (data === null) return undefined; // row missing
  return (data as { device_id: string | null }).device_id;
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
