import { supabase, ensureAnonAuth } from "./supabase";
import { PROTOCOL_VERSION } from "./protocol";

// Unambiguous alphabet — no O/0/I/1 (CLAUDE.md §3).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function randomCode(): string {
  const buf = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(buf);
  let out = "";
  for (const n of buf) out += ALPHABET[n % ALPHABET.length];
  return out;
}

export type Room = {
  id: string;
  code: string;
  host_id: string;
  host_claim_code: string;
  protocol_version: number;
};

// Create a room owned by this (anonymous) device. Retries on the rare code
// collision (unique constraint → Postgres error 23505).
export async function createRoom(): Promise<Room> {
  const hostId = await ensureAnonAuth();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        code,
        host_id: hostId,
        host_claim_code: randomCode().slice(0, 4),
        protocol_version: PROTOCOL_VERSION,
      })
      .select("id, code, host_id, host_claim_code, protocol_version")
      .single();
    if (!error && data) return data as Room;
    if (error && error.code !== "23505") throw error; // not a collision → real failure
  }
  throw new Error("Could not generate a unique room code");
}

export async function getRoomByCode(code: string): Promise<Room | null> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, code, host_id, host_claim_code, protocol_version")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as Room) ?? null;
}
