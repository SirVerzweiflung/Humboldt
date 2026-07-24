import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RoleBadge } from "../../shared/RoleBadge";
import { ensureAnonAuth } from "../../lib/supabase";
import { createRoom, claimRoom, getRoomByCode } from "../../lib/room";
import { errMsg } from "../../lib/errMsg";
import {
  useRoom, currentRound, attachQuiz, startQuiz, kickPlayer, unlockAnswer, closeQuestion,
  revealAnswer, revealSolution, awardPoint, nextRound,
  type Snapshot, type Answer,
} from "../../lib/game";
import { colorMap } from "../../lib/colors";
import { distanceBetween } from "../../lib/distance";
import { RoundSurface } from "../../surface/RoundSurface";
import type { SurfacePin } from "../../lib/surfacePoint";

const HOST_ROOM_KEY = "host_room_code";

export function Host() {
  const [code, setCode] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureAnonAuth();
        const saved = localStorage.getItem(HOST_ROOM_KEY);
        if (saved && (await getRoomByCode(saved))) setCode(saved);
        else if (saved) localStorage.removeItem(HOST_ROOM_KEY);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  function enter(c: string) {
    localStorage.setItem(HOST_ROOM_KEY, c);
    setCode(c);
  }
  async function onCreate() {
    setBusy(true); setError(null);
    try { enter((await createRoom()).code); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  async function onRejoin(c: string) {
    setBusy(true); setError(null);
    try {
      const r = await claimRoom(c);
      if (r) enter(r.code); else setError(`No room "${c.toUpperCase()}".`);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  function leave() { localStorage.removeItem(HOST_ROOM_KEY); setCode(null); }

  if (restoring)
    return <Screen><p className="opacity-70">Restoring…</p></Screen>;
  if (!code)
    return (
      <Screen>
        <RoleBadge label="/host" />
        <h1 className="text-3xl font-bold">Host</h1>
        <Link to="/quiz" className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold hover:underline">
          Create / edit a quiz →
        </Link>
        {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
        <StartScreen busy={busy} onCreate={onCreate} onRejoin={onRejoin} />
      </Screen>
    );
  return <HostRoom code={code} onLeave={leave} />;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-full flex-col items-center gap-6 overflow-y-auto bg-pacific p-6 text-white">
      {children}
    </main>
  );
}

function StartScreen({ busy, onCreate, onRejoin }: { busy: boolean; onCreate: () => void; onRejoin: (c: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-col items-center gap-6">
      <button onClick={onCreate} disabled={busy} className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal disabled:opacity-50">
        {busy ? "Working…" : "Create room"}
      </button>
      <form onSubmit={(e) => { e.preventDefault(); onRejoin(code.trim()); }} className="flex flex-col items-center gap-2">
        <p className="text-sm opacity-70">…or rejoin an existing room as host</p>
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6}
            className="w-40 rounded-lg bg-white px-3 py-2 text-center font-mono text-xl tracking-widest text-gunmetal" />
          <button disabled={busy || code.trim().length < 6} className="rounded-lg bg-white/20 px-4 py-2 font-semibold disabled:opacity-50">Rejoin</button>
        </div>
      </form>
    </div>
  );
}

// ── room (lobby or game) ────────────────────────────────────────────────────
function HostRoom({ code, onLeave }: { code: string; onLeave: () => void }) {
  const { snap, resync } = useRoom(code);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await resync(); } catch (e) { setError(errMsg(e)); }
  };

  if (!snap) return <Screen><p className="opacity-70">Loading {code}…</p></Screen>;

  const banner = error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>;

  if (snap.room.phase === "lobby")
    return <HostLobby snap={snap} code={code} run={run} onLeave={onLeave} banner={banner} />;
  return <HostGame snap={snap} code={code} run={run} banner={banner} />;
}

function HostLobby({ snap, code, run, onLeave, banner }: {
  snap: Snapshot; code: string; run: (fn: () => Promise<unknown>) => Promise<void>; onLeave: () => void; banner: React.ReactNode;
}) {
  const [quizcode, setQuizcode] = useState("");
  const colors = colorMap(snap.players.map((p) => p.id));
  const hasQuiz = snap.rounds.length > 0;

  return (
    <Screen>
      <RoleBadge label="/host" />
      <div className="text-center">
        <p className="text-sm opacity-70">Room code</p>
        <p className="font-mono text-5xl font-bold tracking-widest">{code}</p>
      </div>
      {banner}

      <section className="w-full max-w-md">
        <h2 className="mb-2 font-semibold">Players ({snap.players.length})</h2>
        {snap.players.length === 0 ? (
          <p className="text-sm opacity-60">Waiting for players to join…</p>
        ) : (
          <ul className="space-y-1">
            {snap.players.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded bg-white/10 px-3 py-2">
                <Dot color={colors[p.id]} />
                <span className="flex-1">{p.nickname}</span>
                <button onClick={() => run(() => kickPlayer(p.id))} className="text-xs underline opacity-70">kick</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="w-full max-w-md">
        {hasQuiz ? (
          <div className="flex flex-col items-center gap-3">
            <p>Quiz attached: <b>{snap.room.quiz_title || "(untitled)"}</b> — {snap.rounds.length} questions</p>
            <button onClick={() => run(() => startQuiz(code))} className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-gunmetal">
              Start quiz
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); run(() => attachQuiz(code, quizcode.trim())); }} className="flex flex-col gap-2">
            <label className="text-sm opacity-80">Attach a quiz by its quizcode:</label>
            <div className="flex gap-2">
              <input value={quizcode} onChange={(e) => setQuizcode(e.target.value)} placeholder="quizcode"
                className="flex-1 rounded-lg bg-white px-3 py-2 font-mono text-gunmetal" />
              <button disabled={quizcode.trim().length < 8} className="rounded-lg bg-white/20 px-4 py-2 font-semibold disabled:opacity-50">Attach</button>
            </div>
          </form>
        )}
      </section>

      <button onClick={onLeave} className="mt-auto text-xs underline opacity-70">Leave room</button>
    </Screen>
  );
}

// ── game control ────────────────────────────────────────────────────────────
function HostGame({ snap, code, run, banner }: {
  snap: Snapshot; code: string; run: (fn: () => Promise<unknown>) => Promise<void>; banner: React.ReactNode;
}) {
  const active = currentRound(snap);
  const [previewIdx, setPreviewIdx] = useState(snap.room.current_round_idx);
  const [confirmUnlock, setConfirmUnlock] = useState<string | null>(null);

  const colors = colorMap(snap.players.map((p) => p.id));
  const previewRound = snap.rounds[previewIdx] ?? active;
  const isActivePreview = previewRound?.idx === snap.room.current_round_idx;

  if (snap.room.phase === "ended") return <HostEnded snap={snap} colors={colors} />;
  if (!active || !previewRound) return <Screen><p>Loading round…</p></Screen>;

  const activeAnswers = snap.answers.filter((a) => a.round_id === active.id);
  const answerByPlayer: Record<string, Answer> = {};
  for (const a of activeAnswers) answerByPlayer[a.player_id] = a;

  // Player rows sorted closest-first (host has the solution live), ties by join order.
  const rows = snap.players.map((p, i) => {
    const answer = answerByPlayer[p.id];
    const dist = answer && snap.solution ? distanceBetween(answer.position, snap.solution, active.surface_meta) : null;
    return { p, i, answer, dist };
  });
  rows.sort((a, b) => {
    const ad = a.dist ? a.dist.sort : Infinity;
    const bd = b.dist ? b.dist.sort : Infinity;
    return ad !== bd ? ad - bd : a.i - b.i;
  });

  // Map pins for the active round (host sees all answers + the solution it holds).
  const pins: SurfacePin[] = isActivePreview
    ? [
        ...activeAnswers.map((a) => ({ id: a.id, point: a.position, color: colors[a.player_id], label: nick(snap, a.player_id) })),
        ...(snap.solution ? [{ id: "sol", point: snap.solution, color: "#fff", label: "solution", solution: true }] : []),
      ]
    : [];

  const scores = snap.scores;

  return (
    <main className="flex h-full w-full flex-col bg-pacific text-white">
      <header className="flex items-center gap-3 px-4 py-2">
        <RoleBadge label="/host" />
        <span className="font-mono">Room {code}</span>
        <span className="ml-auto text-sm opacity-80 capitalize">{snap.room.phase}</span>
      </header>
      {banner}
      <div className="flex min-h-0 flex-1">
        {/* question list */}
        <aside className="w-48 shrink-0 overflow-y-auto bg-black/10 p-2">
          <p className="mb-1 text-xs font-semibold opacity-70">Questions</p>
          {snap.rounds.map((r) => (
            <button key={r.id} onClick={() => setPreviewIdx(r.idx)}
              className={`mb-1 block w-full truncate rounded px-2 py-1 text-left text-sm ${r.idx === previewIdx ? "bg-white text-gunmetal" : "bg-white/10"}`}>
              {r.idx + 1}. {r.prompt || "untitled"} {r.idx === snap.room.current_round_idx && "●"}
            </button>
          ))}
        </aside>

        {/* map + prompt */}
        <section className="flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-1 flex items-baseline gap-2">
            <h2 className="text-lg font-bold">{previewRound.prompt || "(no prompt)"}</h2>
            <span className="text-xs opacity-70">[{previewRound.surface_kind}]</span>
            {!isActivePreview && <span className="text-xs italic opacity-70">preview — not the active question</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded border border-white/30">
            <RoundSurface round={previewRound} pins={pins} />
          </div>
        </section>

        {/* player list + controls */}
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto bg-black/10 p-3">
          <div className="mb-2 flex gap-2">
            {snap.room.phase === "answering" ? (
              <button onClick={() => run(() => closeQuestion(code))} className="flex-1 rounded bg-white px-3 py-2 text-sm font-semibold text-gunmetal">
                Close question
              </button>
            ) : (
              <>
                <button onClick={() => run(() => revealSolution(code))} disabled={!!active.revealed_solution}
                  className="flex-1 rounded bg-white px-3 py-2 text-sm font-semibold text-gunmetal disabled:opacity-50">
                  {active.revealed_solution ? "Solution shown" : "Reveal solution"}
                </button>
                <button onClick={() => run(() => nextRound(code))} className="rounded bg-white/20 px-3 py-2 text-sm font-semibold">
                  Next →
                </button>
              </>
            )}
          </div>

          <ul className="space-y-1">
            {rows.map(({ p, answer, dist }) => (
              <li key={p.id} className="rounded bg-white/10 px-2 py-1 text-sm">
                <div className="flex items-center gap-2">
                  <Dot color={colors[p.id]} />
                  <span className="flex-1 truncate">{p.nickname}</span>
                  <span className="tabular-nums opacity-80">{scores[p.id] ?? 0}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 pl-5 text-xs">
                  {answer ? (
                    <span className="rounded bg-white/20 px-1">locked{dist ? ` · ${dist.text}` : ""}{answer.revealed_at ? " · shown" : ""}</span>
                  ) : (
                    <span className="opacity-50">no answer</span>
                  )}
                  <span className="ml-auto flex gap-1">
                    {snap.room.phase === "answering" && answer && (
                      confirmUnlock === answer.id ? (
                        <button onClick={() => { run(() => unlockAnswer(answer.id)); setConfirmUnlock(null); }} className="rounded bg-pink px-1 text-gunmetal">confirm unlock</button>
                      ) : (
                        <button onClick={() => setConfirmUnlock(answer.id)} className="underline opacity-70">unlock</button>
                      )
                    )}
                    {snap.room.phase === "revealing" && (
                      <>
                        {answer && !answer.revealed_at && (
                          <button onClick={() => run(() => revealAnswer(answer.id))} className="rounded bg-white/20 px-1">reveal</button>
                        )}
                        <button onClick={() => run(() => awardPoint(p.id, 1))} className="rounded bg-white/20 px-1">+1</button>
                        <button onClick={() => run(() => awardPoint(p.id, -1))} className="rounded bg-white/20 px-1">−1</button>
                      </>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}

function HostEnded({ snap, colors }: { snap: Snapshot; colors: Record<string, string> }) {
  const ranked = [...snap.players].sort((a, b) => (snap.scores[b.id] ?? 0) - (snap.scores[a.id] ?? 0));
  return (
    <Screen>
      <h1 className="text-3xl font-bold">Quiz ended</h1>
      <ol className="w-full max-w-md space-y-1">
        {ranked.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2 rounded bg-white/10 px-3 py-2">
            <span className="w-6 tabular-nums">{i + 1}.</span>
            <Dot color={colors[p.id]} />
            <span className="flex-1">{p.nickname}</span>
            <span className="tabular-nums font-bold">{snap.scores[p.id] ?? 0}</span>
          </li>
        ))}
      </ol>
    </Screen>
  );
}

function nick(snap: Snapshot, playerId: string): string {
  return snap.players.find((p) => p.id === playerId)?.nickname ?? "?";
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-white" style={{ background: color }} />;
}
