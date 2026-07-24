// Client-side downscale + upload to the self-hosted upload service (server/upload).
// Images never go to Supabase — saves egress (CLAUDE.md §4/§10). We downscale to
// ~2000px long edge and re-encode to WebP before sending raw bytes.

const MAX_EDGE = 2000;
const WEBP_QUALITY = 0.85;

async function downscale(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
  );
  if (!blob) throw new Error("Image encode failed");
  return { blob, width, height };
}

export type UploadResult = { url: string; naturalWidth: number; naturalHeight: number };

export async function uploadImage(quizId: string, file: File): Promise<UploadResult> {
  const { blob, width, height } = await downscale(file);
  const res = await fetch(`/api/upload?quiz=${encodeURIComponent(quizId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "image/webp",
      "X-Upload-Token": import.meta.env.VITE_UPLOAD_TOKEN,
    },
    body: blob,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed (${res.status}): ${msg}`);
  }
  const { url } = (await res.json()) as { url: string };
  return { url, naturalWidth: width, naturalHeight: height };
}
