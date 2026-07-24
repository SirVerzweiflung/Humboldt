// Loads the geo asset manifest (built offline by tools/geo, served from public/geo).
// Nothing here is fetched from a third party — all self-hosted (CLAUDE.md §6.3).

export type LayerAsset = { url: string; bytes: number; gzipBytes: number };
export type Preset = {
  detail: string;
  bbox: [number, number, number, number];
  layers: Record<string, LayerAsset>;
};
type Manifest = { generatedAt: string; presets: Record<string, Preset> };

let cache: Manifest | null = null;

export async function loadManifest(): Promise<Manifest> {
  if (cache) return cache;
  const res = await fetch("/geo/manifest.json");
  if (!res.ok) throw new Error("Failed to load /geo/manifest.json");
  cache = (await res.json()) as Manifest;
  return cache;
}

export async function listPresets(): Promise<string[]> {
  return Object.keys((await loadManifest()).presets);
}
