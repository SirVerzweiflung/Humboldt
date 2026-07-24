import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RoleBadge } from "../../shared/RoleBadge";
import { supabase, ensureAnonAuth } from "../../lib/supabase";
import { createRoom, claimRoom, getRoomByCode, type Room } from "../../lib/room";

// Which room this device is hosting, remembered across reloads / lock screens so
// reopening restores the room instead of dumping back to "Create room".
const HOST_ROOM_KEY = "host_room_code";

export function Host() {
  const [room, setRoom] = useState<Room | null>(null);
  // Start in "restoring" so we never flash the Create screen before the check.
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: restore the persisted room (same device stays host — its session's
  // uid already owns the row). Clears the pointer if the room is gone.
  useEffect(() => {
    (async () => {
      try {
        await ensureAnonAuth();
        const saved = localStorage.getItem(HOST_ROOM_KEY);
        if (saved) {
          const r = await getRoomByCode(saved);
          if (r) setRoom(r);
          else localStorage.removeItem(HOST_ROOM_KEY);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  function enter(r: Room) {
    localStorage.setItem(HOST_ROOM_KEY, r.code);
    setRoom(r);
  }

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      enter(await createRoom());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRejoin(code: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await claimRoom(code);
      if (r) enter(r);
      else setError(`No room "${code.toUpperCase()}".`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    localStorage.removeItem(HOST_ROOM_KEY);
    setRoom(null);
  }

  return (
    <main className="flex h-full flex-col items-center gap-6 overflow-y-auto bg-pacific p-6 text-white">
      <RoleBadge label="/host" />
      <h1 className="text-3xl font-bold">Host</h1>

      <Link
        to="/quiz"
        className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold underline-offset-2 hover:underline"
      >
        Create / edit a quiz →
      </Link>

      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}

      {restoring ? (
        <p className="opacity-70">Restoring…</p>
      ) : !room ? (
        <StartScreen busy={busy} onCreate={onCreate} onRejoin={onRejoin} />
      ) : (
        <>
          <div className="text-center">
            <p className="text-sm opacity-70">Room code</p>
            <p className="font-mono text-5xl font-bold tracking-widest">{room.code}</p>
            <p className="mt-1 text-xs opacity-60">
              Type this into the Board (/board) to open the join screen.
            </p>
            <button onClick={leave} className="mt-2 text-xs underline opacity-70">
              Leave room
            </button>
          </div>

          {/* ===== DUMMY SYNC TEST START ===== */}
          <DummyPingList roomId={room.id} />
          {/* ===== DUMMY SYNC TEST END ===== */}
        </>
      )}
    </main>
  );
}

function StartScreen({
  busy,
  onCreate,
  onRejoin,
}: {
  busy: boolean;
  onCreate: () => void;
  onRejoin: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-col items-center gap-6">
      <button
        onClick={onCreate}
        disabled={busy}
        className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal disabled:opacity-50"
      >
        {busy ? "Working…" : "Create room"}
      </button>

      <div className="flex flex-col items-center gap-2">
        <p className="text-sm opacity-70">…or rejoin an existing room as host</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRejoin(code.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="w-40 rounded-lg bg-white px-3 py-2 text-center font-mono text-xl tracking-widest text-gunmetal"
          />
          <button
            disabled={busy || code.trim().length < 6}
            className="rounded-lg bg-white/20 px-4 py-2 font-semibold disabled:opacity-50"
          >
            Rejoin
          </button>
        </form>
      </div>
    </div>
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
