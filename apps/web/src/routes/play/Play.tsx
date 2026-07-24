import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RoleBadge } from "../../shared/RoleBadge";
import { supabase, ensureAnonAuth } from "../../lib/supabase";
import { getRoomByCode, type Room } from "../../lib/room";
import { joinRoom, savedName, lastRoom, type Player } from "../../lib/player";
import { errMsg } from "../../lib/errMsg";

export function Play() {
  const [params] = useSearchParams();
  const code = params.get("room");

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 bg-palm p-6 text-white">
      <RoleBadge label="/play" />
      {code ? <RoomGate code={code.toUpperCase()} /> : <EnterCode />}
    </main>
  );
}

// ── code entry (no room in URL) ─────────────────────────────────────────────
function EnterCode() {
  // Prefill the last room so a player bounced out (back button) rejoins in a tap.
  const [value, setValue] = useState(lastRoom.get());
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
        disabled={value.trim().length < 6}
        className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal disabled:opacity-50"
      >
        Join
      </button>
    </form>
  );
}

// ── room gate: resolve room → name/confirm → in-room ────────────────────────
type Phase = "loading" | "error" | "need-name" | "confirm" | "in-room";

function RoomGate({ code }: { code: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureAnonAuth();
        const r = await getRoomByCode(code);
        if (cancelled) return;
        if (!r) {
          setError(`No room "${code}".`);
          setPhase("error");
          return;
        }
        setRoom(r);
        const name = savedName.get();
        // Recovery: returning to the room we were last in → sign back in silently.
        if (name && lastRoom.get() === code) {
          const p = await joinRoom(code, name);
          if (cancelled) return;
          setPlayer(p);
          setPhase("in-room");
        } else {
          setPhase(name ? "confirm" : "need-name");
        }
      } catch (e) {
        if (!cancelled) {
          setError(errMsg(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function join(name: string) {
    setError(null);
    try {
      const p = await joinRoom(code, name);
      savedName.set(name);
      lastRoom.set(code);
      setPlayer(p);
      setPhase("in-room");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  function logout() {
    savedName.clear();
    setPlayer(null);
    setPhase("need-name");
  }

  if (phase === "loading") return <p className="opacity-70">Joining {code}…</p>;
  if (phase === "error")
    return <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>;

  if (phase === "confirm")
    return (
      <ConfirmJoin code={code} name={savedName.get()} onJoin={join} onLogout={logout} error={error} />
    );

  if (phase === "need-name")
    return <NameEntry code={code} onJoin={join} error={error} />;

  // in-room
  return <InRoom room={room!} player={player!} onLogout={logout} />;
}

function ConfirmJoin({
  code,
  name,
  onJoin,
  onLogout,
  error,
}: {
  code: string;
  name: string;
  onJoin: (n: string) => void;
  onLogout: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="opacity-70">Room {code}</p>
      <button
        onClick={() => onJoin(name)}
        className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal"
      >
        Join as {name}
      </button>
      <button onClick={onLogout} className="text-sm underline opacity-70">
        not you? log out
      </button>
      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
    </div>
  );
}

function NameEntry({
  code,
  onJoin,
  error,
}: {
  code: string;
  onJoin: (n: string) => void;
  error: string | null;
}) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onJoin(name.trim());
      }}
      className="flex flex-col items-center gap-4"
    >
      <p className="opacity-70">Room {code}</p>
      <p className="text-sm opacity-70">Pick a name others will recognise.</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="your name"
        maxLength={40}
        autoFocus
        className="w-64 rounded-lg bg-white px-4 py-3 text-center text-xl text-gunmetal"
      />
      <button
        disabled={name.trim().length < 1}
        className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal disabled:opacity-50"
      >
        Join
      </button>
      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
    </form>
  );
}

function InRoom({ room, player, onLogout }: { room: Room; player: Player; onLogout: () => void }) {
  const navigate = useNavigate();

  // Back-button safety: the phone "back" must not throw the player out of the app
  // to a blank/unintended page. Push a guard entry; when back is pressed, send them
  // to the (prefilled) code-entry screen instead. The session stays live, so the
  // code is prefilled and returning auto-signs them back in.
  useEffect(() => {
    window.history.pushState({ playGuard: true }, "");
    const onPop = () => navigate("/play", { replace: true });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate]);

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="opacity-70">Room {room.code}</p>
      <p className="text-2xl font-bold">You're in, {player.nickname} 👋</p>
      <p className="opacity-70">Waiting for the host…</p>

      {/* ===== DUMMY SYNC TEST START ===== */}
      <DummySender roomId={room.id} />
      {/* ===== DUMMY SYNC TEST END ===== */}

      <div className="mt-8 flex flex-col items-center gap-2 text-xs opacity-70">
        {/* Leaving is intentionally low-key: it doesn't delete you from the quiz
            (only the host can), it just returns this device to the code screen. */}
        <button onClick={() => navigate("/play")} className="underline">
          leave room on this device
        </button>
        <button onClick={onLogout} className="underline">
          log out ({player.nickname})
        </button>
      </div>
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
