import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RoleBadge } from "../../shared/RoleBadge";
import { StatusChip } from "../../shared/StatusChip";
import { useWakeLock } from "../../lib/wakeLock";
import { ensureAnonAuth } from "../../lib/supabase";
import { getRoomByCode } from "../../lib/room";
import { errMsg } from "../../lib/errMsg";
import { useRoom, currentRound, type Snapshot } from "../../lib/game";
import { colorMap } from "../../lib/colors";
import { distanceBetween } from "../../lib/distance";
import { RoundSurface } from "../../surface/RoundSurface";
import type { SurfacePin } from "../../lib/surfacePoint";

export function Board() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    ensureAnonAuth().catch(() => {});
  }, []);
  return code ? <BoardRoom code={code} /> : (
    <main className="flex h-full flex-col items-center justify-center gap-6 bg-gunmetal p-6 text-white">
      <RoleBadge label="/board" />
      <JoinForm onJoined={setCode} />
    </main>
  );
}

function JoinForm({ onJoined }: { onJoined: (code: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const room = await getRoomByCode(value.trim());
      if (!room) setError("No room with that code.");
      else onJoined(room.code);
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-4">
      <h1 className="text-4xl font-bold">Board</h1>
      <p className="opacity-70">Enter the room code shown on the Host.</p>
      <input value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} autoFocus
        className="w-56 rounded-lg bg-white px-4 py-3 text-center font-mono text-3xl tracking-widest text-gunmetal" />
      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
      <button disabled={busy || value.length < 6} className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal disabled:opacity-50">
        {busy ? "Checking…" : "Join"}
      </button>
    </form>
  );
}

function BoardRoom({ code }: { code: string }) {
  const { snap, connection } = useRoom(code);
  // The projector must never dim for the whole event (§11.1).
  const wake = useWakeLock(true);
  // Top-left, inside the 5 % overscan-safe inset (§11.5) so a cropping TV keeps it.
  const status = (
    <div className="pointer-events-none absolute left-[3%] top-[3%] z-10">
      <StatusChip connection={connection} wake={wake} />
    </div>
  );
  if (!snap)
    return <main className="flex h-full items-center justify-center bg-gunmetal text-white">Loading {code}…</main>;
  if (snap.room.phase === "lobby") return <Lobby code={code} status={status} />;
  if (snap.room.phase === "ended")
    return <Leaderboard snap={snap} code={code} title="Final scores" status={status} />;
  return <BoardGame snap={snap} code={code} status={status} />;
}

// Discreet room code, inside the overscan-safe area (§11.5).
function CornerCode({ code }: { code: string }) {
  return (
    <div className="pointer-events-none absolute right-[3%] top-[3%] font-mono text-sm opacity-60">
      Room {code}
    </div>
  );
}

function Lobby({ code, status }: { code: string; status: React.ReactNode }) {
  const joinUrl = `${window.location.origin}/play?room=${code}`;
  return (
    <main className="relative flex h-full flex-col items-center justify-center gap-6 bg-gunmetal p-6 text-white">
      {status}
      <p className="text-lg opacity-70">Join the quiz</p>
      <p className="font-mono text-7xl font-bold tracking-widest">{code}</p>
      <div className="rounded-xl bg-white p-4"><QRCodeSVG value={joinUrl} size={220} fgColor="#424242" /></div>
      <p className="opacity-60">Scan or open the link to join.</p>
    </main>
  );
}

function BoardGame({ snap, code, status }: { snap: Snapshot; code: string; status: React.ReactNode }) {
  const round = currentRound(snap);
  const colors = colorMap(snap.players.map((p) => p.id));
  if (!round)
    return <main className="flex h-full items-center justify-center bg-gunmetal text-white">…</main>;

  // Board only receives revealed answers (RLS). Restrict to THIS round + solution.
  const roundAnswers = snap.answers.filter((a) => a.round_id === round.id && a.revealed_at);
  const revealedByPlayer: Record<string, (typeof snap.answers)[number]> = {};
  for (const a of roundAnswers) revealedByPlayer[a.player_id] = a;

  const pins: SurfacePin[] = roundAnswers.map((a) => ({
    id: a.id,
    point: a.position,
    color: colors[a.player_id],
    label: nickOf(snap, a.player_id),
  }));
  if (round.revealed_solution)
    pins.push({ id: "sol", point: round.revealed_solution, color: "#fff", label: "solution", solution: true });

  // Always score-ordered; ties broken by join order (players already join-sorted).
  const ranked = snap.players
    .map((p, i) => ({ p, i, score: snap.scores[p.id] ?? 0 }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i));

  return (
    <main className="relative flex h-full bg-gunmetal text-white">
      {status}
      <CornerCode code={code} />
      <section className="flex min-w-0 flex-1 flex-col p-4">
        <h1 className="mb-2 text-3xl font-bold">{round.prompt || "…"}</h1>
        <div className="min-h-0 flex-1 overflow-hidden rounded border border-white/30">
          <RoundSurface round={round} pins={pins} />
        </div>
      </section>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/20 p-4">
        <h2 className="mb-2 text-xl font-bold">Scores</h2>
        <ol className="space-y-1">
          {ranked.map(({ p, score }, rank) => {
            const ans = revealedByPlayer[p.id];
            const dist = ans && round.revealed_solution
              ? distanceBetween(ans.position, round.revealed_solution, round.surface_meta)
              : null;
            return (
              <li key={p.id} className="flex items-center gap-2 rounded bg-white/10 px-3 py-2">
                <span className="w-6 tabular-nums opacity-70">{rank + 1}.</span>
                <Dot color={colors[p.id]} />
                <span className="flex-1 truncate">{p.nickname}</span>
                {dist && <span className="text-sm opacity-80">{dist.text}</span>}
                <span className="w-8 text-right tabular-nums font-bold">{score}</span>
              </li>
            );
          })}
        </ol>
      </aside>
    </main>
  );
}

function Leaderboard({ snap, code, title, status }: {
  snap: Snapshot; code: string; title: string; status?: React.ReactNode;
}) {
  const colors = colorMap(snap.players.map((p) => p.id));
  const ranked = snap.players
    .map((p, i) => ({ p, i, score: snap.scores[p.id] ?? 0 }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i));
  return (
    <main className="relative flex h-full flex-col items-center justify-center gap-4 bg-gunmetal p-6 text-white">
      {status}
      <CornerCode code={code} />
      <h1 className="text-4xl font-bold">{title}</h1>
      <ol className="w-full max-w-lg space-y-1">
        {ranked.map(({ p, score }, i) => (
          <li key={p.id} className="flex items-center gap-3 rounded bg-white/10 px-4 py-3 text-xl">
            <span className="w-8 tabular-nums opacity-70">{i + 1}.</span>
            <Dot color={colors[p.id]} />
            <span className="flex-1">{p.nickname}</span>
            <span className="tabular-nums font-bold">{score}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}

function nickOf(snap: Snapshot, playerId: string): string {
  return snap.players.find((p) => p.id === playerId)?.nickname ?? "?";
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-white" style={{ background: color }} />;
}
