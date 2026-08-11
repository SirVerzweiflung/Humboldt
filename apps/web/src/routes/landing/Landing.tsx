import { Link } from "react-router-dom";
import { useInstallPrompt } from "../../lib/pwa";

// Role chooser at "/". Deliberately OUTSIDE <AuthGate> (see main.tsx): it needs
// no Supabase session, so nobody meets a captcha before they have even chosen
// what they are. The captcha appears once a role is picked.
//
// /quiz is intentionally absent — the editor is reached from the Host screen.
export function Landing() {
  const { canInstall, promptInstall, isIOS, isStandalone } = useInstallPrompt();

  return (
    <main className="flex h-full flex-col items-center justify-center gap-8 bg-gunmetal p-6 text-white">
      <header className="text-center">
        <h1 className="text-4xl font-bold">Map Quiz</h1>
        <p className="mt-2 opacity-70">Pick this device's role.</p>
      </header>

      <nav className="flex w-full max-w-md flex-col gap-3">
        <RoleLink
          to="/play"
          className="bg-palm text-white"
          title="Player"
          detail="Phone. Join with the room code, drop one pin per question."
        />
        <RoleLink
          to="/host"
          className="bg-pacific text-white"
          title="Host"
          detail="Tablet. Run the quiz: reveal answers, drop solutions, award points."
        />
        <RoleLink
          to="/board"
          className="bg-white/20 text-white"
          title="Board"
          detail="The big screen. Read-only projection for everyone to watch."
        />
      </nav>

      {!isStandalone && (canInstall || isIOS) && (
        <section className="flex flex-col items-center gap-2 text-sm">
          {canInstall ? (
            <button
              onClick={() => void promptInstall()}
              className="rounded-lg bg-white px-5 py-2 font-semibold text-gunmetal"
            >
              Install app
            </button>
          ) : (
            // iOS fires no beforeinstallprompt, so the only option is to say how.
            <p className="max-w-xs text-center opacity-70">
              To install: tap <b>Share</b>, then <b>Add to Home Screen</b>.
            </p>
          )}
          <p className="max-w-xs text-center text-xs opacity-60">
            Installing gives a full-screen view and keeps you signed in — worth it on the host tablet.
          </p>
        </section>
      )}
    </main>
  );
}

function RoleLink({ to, className, title, detail }: {
  to: string; className: string; title: string; detail: string;
}) {
  return (
    <Link to={to} className={`rounded-xl px-5 py-4 ${className}`}>
      <span className="block text-xl font-bold">{title}</span>
      <span className="block text-sm opacity-80">{detail}</span>
    </Link>
  );
}
