// Tiny self-hosted image upload service (CLAUDE.md §4/§10).
// Images live on OUR box (Cloudflare-edge-cached), never Supabase, to save egress.
// The client downscales + re-encodes to WebP before POSTing raw bytes here; this
// server just checks the token, validates, and writes the file.
//
//   POST /api/upload?quiz=<quizId>
//     headers: X-Upload-Token: <secret>, Content-Type: image/(webp|jpeg|png)
//     body:    raw image bytes
//   → 200 { "url": "/uploads/quizzes/<quizId>/<uuid>.<ext>" }
//
// Env: UPLOAD_PORT (8787), UPLOAD_TOKEN (required), UPLOAD_DIR
//      (default: apps/web/public/uploads — so Vite serves it in dev).

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.UPLOAD_PORT ?? 8787);
const TOKEN = process.env.UPLOAD_TOKEN ?? "";
const HERE = dirname(fileURLToPath(import.meta.url));
// Default writes into repo-root/public/uploads — the same dir Vite serves (publicDir).
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(HERE, "..", "..", "public", "uploads");

const MAX_BYTES = 6 * 1024 * 1024; // client already downscales; this is a backstop
const EXT = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

if (!TOKEN) {
  console.error("UPLOAD_TOKEN not set — refusing to start (would accept anonymous writes).");
  process.exit(1);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/api/upload")) {
    return send(res, 404, { error: "not found" });
  }
  if (req.headers["x-upload-token"] !== TOKEN) {
    return send(res, 401, { error: "bad token" });
  }

  const ext = EXT[req.headers["content-type"] ?? ""];
  if (!ext) return send(res, 415, { error: "unsupported type" });

  const quiz = new URL(req.url, "http://localhost").searchParams.get("quiz") ?? "";
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(quiz)) return send(res, 400, { error: "bad quiz id" });

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BYTES) {
      send(res, 413, { error: "too large" });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", async () => {
    if (res.writableEnded) return;
    try {
      const dir = join(UPLOAD_DIR, "quizzes", quiz);
      await mkdir(dir, { recursive: true });
      const name = `${randomUUID()}.${ext}`;
      await writeFile(join(dir, name), Buffer.concat(chunks));
      send(res, 200, { url: `/uploads/quizzes/${quiz}/${name}` });
    } catch (e) {
      send(res, 500, { error: String(e) });
    }
  });
});

server.listen(PORT, () => console.log(`upload service on :${PORT} → ${UPLOAD_DIR}`));
