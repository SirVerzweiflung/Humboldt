import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./shared/AuthGate";
import "./index.css";

// Route-level code splitting (CLAUDE.md §2): the phone (/play) must not download
// the editor's MapLibre bundle, and /board stays light too.
const Play = lazy(() => import("./routes/play/Play").then((m) => ({ default: m.Play })));
const Host = lazy(() => import("./routes/host/Host").then((m) => ({ default: m.Host })));
const Board = lazy(() => import("./routes/board/Board").then((m) => ({ default: m.Board })));
const QuizPage = lazy(() => import("./routes/quiz/QuizPage").then((m) => ({ default: m.QuizPage })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <BrowserRouter>
        <Suspense fallback={<div className="flex h-full items-center justify-center opacity-70">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/board" replace />} />
            <Route path="/play" element={<Play />} />
            <Route path="/host" element={<Host />} />
            <Route path="/quiz" element={<QuizPage />} />
            <Route path="/board" element={<Board />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthGate>
  </StrictMode>,
);
