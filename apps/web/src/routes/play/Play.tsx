import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RoleBadge } from "../../shared/RoleBadge";
import { supabase, ensureAnonAuth } from "../../lib/supabase";
import { getRoomByCode, type Room } from "../../lib/room";
import { errMsg } from "../../lib/errMsg";

export function Play() {
  const [params] = useSearchParams();
  const code = params.get("room");

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 bg-palm p-6 text-white">
      <RoleBadge label="/play" />
      {code ? <InRoom code={code.toUpperCase()} /> : <EnterCode />}
    </main>
  );
}

function EnterCode() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/play?room=${value.trim().toUpperCase()}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-4">
      <h1 className="text-4xl font-bold">Player</h1>
      <p className="opacity-70">Enter the room code.</p>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoFocus
        className="w-56 rounded-lg bg-white px-4 py-3 text-center font-mono text-3xl tracking-widest text-gunmetal"
      />
      <button
        disabled={value.length < 6}
        className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal disabled:opacity-50"
      >
        Join
      </button>
    </form>
  );
}

function InRoom({ code }: { code: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureAnonAuth();
        const r = await getRoomByCode(code);
        if (!r) setError(`No room "${code}".`);
        else setRoom(r);
      } catch (e) {
        setError(errMsg(e));
      }
    })();
  }, [code]);

  if (error) return <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>;
  if (!room) return <p className="opacity-70">Joining {code}…</p>;

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="opacity-70">In room</p>
      <p className="font-mono text-4xl font-bold tracking-widest">{room.code}</p>
      {/* ===== DUMMY SYNC TEST START ===== */}
      <DummySender roomId={room.id} />
      {/* ===== DUMMY SYNC TEST END ===== */}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ===== DUMMY SYNC TEST START =====
// Throwaway: one button that inserts a dummy_ping with an incrementing counter,
// so realtime delivery to the host can be tested. Delete with the table.

function DummySender({ roomId }: { roomId: string }) {
  const [counter, setCounter] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const next = counter + 1;
    setSending(true);
    setError(null);
    try {
      const playerId = await ensureAnonAuth();
      const { error: err } = await supabase
        .from("dummy_pings")
        .insert({ room_id: roomId, player_id: playerId, counter: next });
      if (err) throw err;
      setCounter(next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <button
        onClick={send}
        disabled={sending}
        className="rounded-lg bg-white px-8 py-4 text-xl font-semibold text-gunmetal disabled:opacity-50"
      >
        Send dummy data
      </button>
      <p className="text-sm opacity-70">Next counter: {counter + 1}</p>
      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
    </div>
  );
}
// ===== DUMMY SYNC TEST END =====
// ═══════════════════════════════════════════════════════════════════════════
