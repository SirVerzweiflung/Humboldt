import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true so phones/tablets on the LAN can reach the dev server (players, host, board).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
