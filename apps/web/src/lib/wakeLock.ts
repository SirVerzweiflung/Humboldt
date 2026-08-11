import { useEffect, useState } from "react";

export type WakeState = "held" | "unsupported" | "denied";

// Screen Wake Lock (CLAUDE.md §11.1). Held only while `active`.
//
// Two things make this fiddly and both are platform behaviour, not choices:
//   1. The OS releases the sentinel every time the page is hidden, so the
//      visibilitychange re-acquire is mandatory, not an optimisation.
//   2. The request can be refused at any moment (low battery, power saver) and
//      an already-held lock can be revoked. Every path is try/catch'd and the
//      failure is reported as state, never thrown — nothing in the quiz may
//      break because a phone decided to save power.
export function useWakeLock(active: boolean): WakeState {
  const [state, setState] = useState<WakeState>(() =>
    typeof navigator !== "undefined" && "wakeLock" in navigator ? "denied" : "unsupported",
  );

  useEffect(() => {
    if (!("wakeLock" in navigator)) {
      setState("unsupported");
      return;
    }
    if (!active) {
      setState("denied");
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await next.release().catch(() => {});
          return;
        }
        sentinel = next;
        // Fired when the OS takes it back (hide, power saver, manual release).
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
          if (!cancelled) setState("denied");
        });
        setState("held");
      } catch {
        setState("denied");
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    document.addEventListener("visibilitychange", onVisibility);
    void acquire();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);

  return state;
}
