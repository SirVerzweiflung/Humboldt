import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RoleBadge } from "../../shared/RoleBadge";
import { StatusChip } from "../../shared/StatusChip";
import { useWakeLock } from "../../lib/wakeLock";
import { ensureAnonAuth } from "../../lib/supabase";
import { getRoomByCode, type Room } from "../../lib/room";
import { joinRoom, savedName, lastRoom, type Player } from "../../lib/player";
import { errMsg } from "../../lib/errMsg";
import { useRoom, currentRound, submitAnswer } from "../../lib/game";
import { colorMap } from "../../lib/colors";
import { RoundSurface } from "../../surface/RoundSurface";
import type { SurfacePoint } from "../../lib/surfacePoint";

type KickReason = "superseded" | "removed";

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
type Phase = "loading" | "error" | "need-name" | "confirm" | "in-room" | "kicked";

function RoomGate({ code }: { code: string }) {
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [kickReason, setKickReason] = useState<KickReason>("superseded");

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

  const onKicked = useCallback((reason: KickReason) => {
    setKickReason(reason);
    setPhase("kicked");
  }, []);

  if (phase === "loading") return <p className="opacity-70">Joining {code}…</p>;
  if (phase === "error")
    return <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>;

  if (phase === "confirm")
    return (
      <ConfirmJoin code={code} name={savedName.get()} onJoin={join} onLogout={logout} error={error} />
    );

  if (phase === "need-name")
    return <NameEntry code={code} onJoin={join} error={error} />;

  if (phase === "kicked")
    return (
      <KickedScreen
        reason={kickReason}
        name={savedName.get()}
        onRejoin={() => join(savedName.get())}
        onCode={() => navigate("/play")}
        error={error}
      />
    );

  // in-room
  return <InRoom room={room!} player={player!} onLogout={logout} onKicked={onKicked} />;
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

function InRoom({
  room,
  player,
  onLogout,
  onKicked,
}: {
  room: Room;
  player: Player;
  onLogout: () => void;
  onKicked: (reason: KickReason) => void;
}) {
  const navigate = useNavigate();
  const { snap, connection } = useRoom(room.code);
  // Phones only hold the lock while a pin is actually being placed (§11.1) —
  // holding it all evening would flatten the battery for nothing.
  const wake = useWakeLock(snap?.room.phase === "answering");
  const [myUid, setMyUid] = useState("");
  const [myPin, setMyPin] = useState<SurfacePoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAnonAuth().then(setMyUid);
  }, []);

  // Anti-griefing + host-kick, derived from the live snapshot (no separate channel).
  useEffect(() => {
    if (!snap || !myUid) return;
    const me = snap.players.find((p) => p.id === player.id);
    if (!me) onKicked("removed");
    else if (me.device_id && me.device_id !== myUid) onKicked("superseded");
  }, [snap, myUid, player.id, onKicked]);

  const round = snap ? currentRound(snap) : undefined;
  // Reset the working pin whenever the active round changes.
  useEffect(() => {
    setMyPin(null);
  }, [round?.id]);

  // Back-button safety (see §9): keep the player inside the app on a prefilled code screen.
  useEffect(() => {
    window.history.pushState({ playGuard: true }, "");
    const onPop = () => navigate("/play", { replace: true });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate]);

  const footer = (
    <div className="mt-6 flex flex-col items-center gap-2 text-xs opacity-70">
      <button onClick={() => navigate("/play")} className="underline">leave room on this device</button>
      <button onClick={onLogout} className="underline">log out ({player.nickname})</button>
    </div>
  );

  if (!snap) return <p className="opacity-70">Loading…</p>;

  const myColor = colorMap(snap.players.map((p) => p.id))[player.id] ?? "#f8a0cb";
  const myAnswer = round ? snap.answers.find((a) => a.player_id === player.id && a.round_id === round.id) : undefined;

  async function lock() {
    if (!myPin) return;
    setBusy(true); setError(null);
    try { await submitAnswer(player.id, myPin); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  // Header line shown in every phase.
  const head = (
    <div className="flex w-full items-center gap-3">
      <p className="text-lg font-bold">Hi {player.nickname}</p>
      {/* Only report the lock while we are actually meant to hold one — outside
          `answering` a released lock is correct, not a fault worth flagging. */}
      <StatusChip
        connection={connection}
        wake={snap.room.phase === "answering" ? wake : undefined}
        className="ml-auto"
      />
    </div>
  );

  if (snap.room.phase === "lobby")
    return <div className="flex flex-col items-center gap-3">{head}<p className="opacity-70">Waiting for the host to start…</p>{footer}</div>;

  if (!round) return <div className="flex flex-col items-center gap-3">{head}<p className="opacity-70">Waiting…</p>{footer}</div>;

  const answering = snap.room.phase === "answering" && !myAnswer;
  const pins = [];
  if (answering && myPin) pins.push({ id: "me", point: myPin, color: myColor });
  if (myAnswer) pins.push({ id: "me", point: myAnswer.position, color: myColor });
  if (round.revealed_solution) pins.push({ id: "sol", point: round.revealed_solution, color: "#fff", solution: true });

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      {head}
      <p className="text-center font-semibold">{round.prompt || "…"}</p>
      <div className="h-[55vh] w-full overflow-hidden rounded border border-white/40">
        <RoundSurface round={round} pins={pins} onPick={answering ? setMyPin : undefined} />
      </div>

      {answering ? (
        <>
          <p className="text-xs opacity-70">{myPin ? "Tap Lock in when you're sure." : "Tap the map to place your pin."}</p>
          <button onClick={lock} disabled={!myPin || busy}
            className="w-full rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal disabled:opacity-50">
            {busy ? "Locking…" : "Lock in"}
          </button>
        </>
      ) : myAnswer ? (
        <p className="rounded bg-white/20 px-3 py-1 text-sm">Locked in ✓ — waiting for the host.</p>
      ) : (
        <p className="rounded bg-white/20 px-3 py-1 text-sm">No answer locked — watch the board.</p>
      )}
      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
      {footer}
    </div>
  );
}

function KickedScreen({
  reason,
  name,
  onRejoin,
  onCode,
  error,
}: {
  reason: KickReason;
  name: string;
  onRejoin: () => void;
  onCode: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {reason === "superseded" ? (
        <>
          <p className="text-xl font-bold">Someone else joined as “{name}”.</p>
          <p className="opacity-70">You were signed out on this device.</p>
          {name && (
            <button
              onClick={onRejoin}
              className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal"
            >
              Rejoin as {name} (removes the other device)
            </button>
          )}
        </>
      ) : (
        <p className="text-xl font-bold">The host removed you from the quiz.</p>
      )}
      <button onClick={onCode} className="text-sm underline opacity-70">
        back to code screen
      </button>
      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
    </div>
  );
}
