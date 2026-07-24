import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true so phones/tablets on the LAN can reach the dev server (players, host, board).
export default defineConfig({
  plugins: [react()],
  // Static assets (built geo TopoJSON + uploaded images) live in repo-root/public,
  // one level above the app root — that's where tools/geo and the upload service write.
  publicDir: "../../public",
  server: {
    host: true,
    port: 5173,
    // Dev: forward image uploads to the local upload service (server/upload).
    // /uploads/* is served statically by Vite straight from public/uploads.
    proxy: {
      "/api/upload": "http://localhost:8787",
    },
  },
});
