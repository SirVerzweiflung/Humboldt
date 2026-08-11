import type { WakeState } from "../lib/wakeLock";

// Realtime channel health, derived in useRoom (CLAUDE.md §5 "Failure UX").
export type Connection = "connected" | "reconnecting" | "offline";

const CONNECTION_STYLE: Record<Connection, { label: string; className: string }> = {
  connected: { label: "live", className: "bg-white/20 text-white" },
  reconnecting: { label: "reconnecting", className: "bg-wheat text-gunmetal" },
  offline: { label: "offline", className: "bg-pink text-gunmetal" },
};

// Persistent status chip for the three play screens. Both props are optional so
// a screen without a room (the landing page, the lobby before a snapshot lands)
// can still show the wake state on its own.
export function StatusChip({
  connection,
  wake,
  className = "",
}: {
  connection?: Connection;
  wake?: WakeState;
  className?: string;
}) {
  const conn = connection ? CONNECTION_STYLE[connection] : null;

  return (
    <span className={`flex shrink-0 items-center gap-2 text-xs ${className}`}>
      {conn && (
        <span className={`flex items-center gap-1 rounded px-2 py-0.5 ${conn.className}`}>
          <span aria-hidden>●</span>
          {conn.label}
        </span>
      )}
      {wake && (
        <span
          className="flex items-center gap-1 rounded bg-white/20 px-2 py-0.5 text-white"
          // The chip is what the pre-quiz checklist (§12) actually looks at, so
          // spell out the failure rather than hiding it.
          title={
            wake === "held"
              ? "Screen wake lock held — the display will not auto-dim"
              : wake === "unsupported"
                ? "This browser has no Wake Lock API"
                : "No wake lock — the screen may dim. Disable auto-lock in system settings."
          }
        >
          <span aria-hidden>{wake === "held" ? "▣" : "▢"}</span>
          {wake === "held" ? "awake" : "may dim"}
        </span>
      )}
    </span>
  );
}
