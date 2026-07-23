import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RoleBadge } from "../../shared/RoleBadge";
import { ensureAnonAuth } from "../../lib/supabase";
import { getRoomByCode } from "../../lib/room";

export function Board() {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    ensureAnonAuth().catch(() => {});
  }, []);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 bg-slate-900 p-6 text-white">
      <RoleBadge label="/board" />
      {code ? <Joined code={code} /> : <JoinForm onJoined={setCode} />}
    </main>
  );
}

function JoinForm({ onJoined }: { onJoined: (code: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const room = await getRoomByCode(value.trim());
      if (!room) setError("No room with that code.");
      else onJoined(room.code);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-4">
      <h1 className="text-4xl font-bold">Board</h1>
      <p className="opacity-70">Enter the room code shown on the Host.</p>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoFocus
        className="w-56 rounded-lg bg-white px-4 py-3 text-center font-mono text-3xl tracking-widest text-slate-900"
      />
      {error && <p className="rounded bg-red-600 px-3 py-2 text-sm">{error}</p>}
      <button
        disabled={busy || value.length < 6}
        className="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-slate-900 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Join"}
      </button>
    </form>
  );
}

function Joined({ code }: { code: string }) {
  const joinUrl = `${window.location.origin}/play?room=${code}`;
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-center">
        <p className="text-lg opacity-70">Room</p>
        <p className="font-mono text-7xl font-bold tracking-widest">{code}</p>
      </div>
      <div className="rounded-xl bg-white p-4">
        <QRCodeSVG value={joinUrl} size={220} />
      </div>
      <a href={joinUrl} className="break-all text-center font-mono text-lg underline">
        {joinUrl}
      </a>
      <p className="text-sm opacity-60">Scan or open the link to join as a player.</p>
    </div>
  );
}
