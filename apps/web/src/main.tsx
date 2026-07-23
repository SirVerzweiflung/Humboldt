import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Play } from "./routes/play/Play";
import { Host } from "./routes/host/Host";
import { Board } from "./routes/board/Board";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/play" element={<Play />} />
        <Route path="/host" element={<Host />} />
        <Route path="/board" element={<Board />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
