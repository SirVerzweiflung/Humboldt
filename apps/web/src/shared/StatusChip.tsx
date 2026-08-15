import type { WakeState } from "../lib/wakeLock";

// Realtime channel health, derived in useRoom (CLAUDE.md §5 "Failure UX").
export type Connection = "connected" | "reconnecting" | "offline";

const CONNECTION_STYLE: Record<Connection, { label: string; className: string }> = {
  connected: { label: "live", className: "bg-white/20 text-white" },
  reconnecting: { label: "reconnecting", className: "bg-wheat text-gunmetal" },
  offline: { label: "offline", className: "bg-pink text-gunmetal" },
};

// Status chip for the three play screens — an EXCEPTION reporter, not a dashboard.
//
// "connected" and "awake" are the states you get 99% of an evening, so showing
// them is pure noise on a projector; the chip renders nothing at all when
// everything is nominal and only appears when something needs attention. That
// makes its presence the signal (§12 checklist: a visible chip means look at it).
//
// Both props are optional so a screen without a room, or a phone that is not
// currently meant to hold a lock, can pass only what applies.
export function StatusChip({
  connection,
  wake,
  className = "",
}: {
  connection?: Connection;
  wake?: WakeState;
  className?: string;
}) {
  const conn = connection && connection !== "connected" ? CONNECTION_STYLE[connection] : null;
  const showWake = wake !== undefined && wake !== "held";

  if (!conn && !showWake) return null;

  return (
    <span className={`flex shrink-0 items-center gap-2 text-xs ${className}`}>
      {conn && (
        <span className={`flex items-center gap-1 rounded px-2 py-0.5 ${conn.className}`}>
          <span aria-hidden>●</span>
          {conn.label}
        </span>
      )}
      {showWake && (
        <span
          className="flex items-center gap-1 rounded bg-wheat px-2 py-0.5 text-gunmetal"
          title={
            wake === "unsupported"
              ? "This browser has no Wake Lock API"
              : "No wake lock — the screen may dim. Disable auto-lock in system settings."
          }
        >
          <span aria-hidden>▢</span>
          may dim
        </span>
      )}
    </span>
  );
}
