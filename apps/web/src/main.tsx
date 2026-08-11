import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthGate } from "./shared/AuthGate";
import { Landing } from "./routes/landing/Landing";
import { registerServiceWorker } from "./lib/pwa";
import "./index.css";

// Route-level code splitting (CLAUDE.md §2): the phone (/play) must not download
// the editor's MapLibre bundle, and /board stays light too. Landing is NOT lazy —
// it is the first paint and it is tiny.
const Play = lazy(() => import("./routes/play/Play").then((m) => ({ default: m.Play })));
const Host = lazy(() => import("./routes/host/Host").then((m) => ({ default: m.Host })));
const Board = lazy(() => import("./routes/board/Board").then((m) => ({ default: m.Board })));
const QuizPage = lazy(() => import("./routes/quiz/QuizPage").then((m) => ({ default: m.QuizPage })));

// The role routes need an anonymous Supabase session; "/" does not. Gating each
// route rather than the whole router keeps the landing page captcha-free.
function Gated({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="flex h-full items-center justify-center opacity-70">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/play" element={<Gated><Play /></Gated>} />
          <Route path="/host" element={<Gated><Host /></Gated>} />
          <Route path="/quiz" element={<Gated><QuizPage /></Gated>} />
          <Route path="/board" element={<Gated><Board /></Gated>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
