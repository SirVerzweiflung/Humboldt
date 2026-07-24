import { useEffect, useState, type ReactNode } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { supabase, signInWithCaptcha } from "../lib/supabase";

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

// Ensures an anonymous session exists before rendering the app. On first visit
// (no session) it shows a Cloudflare Turnstile widget; its token is passed to
// signInAnonymously. Returning devices have a localStorage session and never see
// the widget. Turnstile tokens are single-use, so we sign in immediately on each.
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"checking" | "captcha" | "ready">("checking");
  const [error, setError] = useState<string | null>(null);
  // Force a fresh Turnstile widget after a failed/expired token.
  const [widgetKey, setWidgetKey] = useState(0);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setPhase(data.session ? "ready" : "captcha"))
      .catch((e) => setError(String(e)));
  }, []);

  async function onToken(token: string) {
    setError(null);
    try {
      await signInWithCaptcha(token);
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setWidgetKey((k) => k + 1); // token consumed; get a new one
    }
  }

  if (phase === "ready") return <>{children}</>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-gunmetal p-6 text-white">
      {phase === "checking" && <p className="opacity-70">Loading…</p>}
      {phase === "captcha" &&
        (siteKey ? (
          <>
            <p className="opacity-80">Verifying you're human…</p>
            <Turnstile
              key={widgetKey}
              siteKey={siteKey}
              onSuccess={onToken}
              onError={() => setError("Turnstile failed to load")}
              onExpire={() => setWidgetKey((k) => k + 1)}
            />
          </>
        ) : (
          <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">
            Missing VITE_TURNSTILE_SITE_KEY in apps/web/.env
          </p>
        ))}
      {error && <p className="rounded bg-pink px-3 py-2 text-sm text-gunmetal">{error}</p>}
    </div>
  );
}
