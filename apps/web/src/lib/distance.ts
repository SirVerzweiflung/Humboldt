import type { SurfacePoint, ImageMeta } from "./surfacePoint";

// Distance between an answer and the solution (CLAUDE.md §8). Computed client-side:
// the host has the solution live; the board computes it once the solution is
// revealed. Returns a sort key (smaller = closer) and a display string.
export type Distance = { sort: number; text: string };

const R_KM = 6371;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function distanceBetween(
  answer: SurfacePoint,
  solution: SurfacePoint,
  meta?: ImageMeta | Record<string, unknown>,
): Distance | null {
  if (answer.kind === "geo" && solution.kind === "geo") {
    const km = haversineKm(answer, solution);
    return { sort: km, text: km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km` };
  }
  if (answer.kind === "image" && solution.kind === "image") {
    const W = Number((meta as ImageMeta)?.natural_width) || 1;
    const H = Number((meta as ImageMeta)?.natural_height) || 1;
    const dx = (answer.x - solution.x) * W;
    const dy = (answer.y - solution.y) * H;
    const pct = (100 * Math.hypot(dx, dy)) / Math.hypot(W, H);
    return { sort: pct, text: `${pct.toFixed(1)}%` };
  }
  return null;
}
