import { useCallback, useEffect, useState } from "react";
import { RoleBadge } from "../../shared/RoleBadge";
import { supabase, ensureAnonAuth } from "../../lib/supabase";
import { createRoom, type Room } from "../../lib/room";

export function Host() {
  const [room, setRoom] = useState<Room | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAnonAuth().catch((e) => setError(String(e)));
  }, []);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      setRoom(await createRoom());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full flex-col items-center gap-6 overflow-y-auto bg-indigo-700 p-6 text-white">
      <RoleBadge label="/host" />
      <h1 className="text-3xl font-bold">Host</h1>

      {error && <p className="rounded bg-red-600 px-3 py-2 text-sm">{error}</p>}

      {!room ? (
        <button
          onClick={onCreate}
          disabled={busy}
          className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-indigo-700 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create room"}
        </button>
      ) : (
        <>
          <div className="text-center">
            <p className="text-sm opacity-70">Room code</p>
            <p className="font-mono text-5xl font-bold tracking-widest">{room.code}</p>
            <p className="mt-1 text-xs opacity-60">
              Type this into the Board (/board) to open the join screen.
            </p>
          </div>

          {/* ===== DUMMY SYNC TEST START ===== */}
          <DummyPingList roomId={room.id} />
          {/* ===== DUMMY SYNC TEST END ===== */}
        </>
      )}
    </main>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ===== DUMMY SYNC TEST START =====
// Throwaway component: live list of dummy_pings for the room. Delete with the
// dummy_pings table once real answers land.

type Ping = { id: string; player_id: string; counter: number; created_at: string };

function DummyPingList({ roomId }: { roomId: string }) {
  const [pings, setPings] = useState<Ping[]>([]);
  const [status, setStatus] = useState("connecting…");

  // Never accumulate blind from events — always reconcile against a fetch (§5).
  const resync = useCallback(async () => {
    const { data } = await supabase
      .from("dummy_pings")
      .select("id, player_id, counter, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });
    if (data) setPings(data as Ping[]);
  }, [roomId]);

  useEffect(() => {
    resync();

    const channel = supabase
      .channel(`dummy:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dummy_pings", filter: `room_id=eq.${roomId}` },
        // Event is only a hint that something changed; refetch the truth.
        () => resync(),
      )
      .subscribe((s) => {
        setStatus(s === "SUBSCRIBED" ? "live" : s.toLowerCase());
        if (s === "SUBSCRIBED") resync(); // covers first connect and every reconnect
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", resync);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", resync);
    };
  }, [roomId, resync]);

  return (
    <section className="w-full max-w-md">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Dummy pings</h2>
        <span className="text-xs opacity-70">{status}</span>
      </div>
      {pings.length === 0 ? (
        <p className="text-sm opacity-60">None yet. Send some from a player screen.</p>
      ) : (
        <ul className="space-y-1">
          {pings.map((p) => (
            <li
              key={p.id}
              className="flex justify-between rounded bg-white/10 px-3 py-2 font-mono text-sm"
            >
              <span>#{p.counter}</span>
              <span className="opacity-70">{p.player_id.slice(0, 8)}</span>
              <span className="opacity-50">{new Date(p.created_at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
// ===== DUMMY SYNC TEST END =====
// ═══════════════════════════════════════════════════════════════════════════
