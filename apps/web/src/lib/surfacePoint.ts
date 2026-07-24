// The ONE representation of a point anywhere in the app (CLAUDE.md §14).
export type SurfacePoint =
  | { kind: "geo"; lat: number; lng: number }
  | { kind: "image"; x: number; y: number }; // x,y normalised 0..1

export type GeoMeta = {
  preset: string;
  bbox: [number, number, number, number];
  layers: string[];
};

export type ImageMeta = {
  natural_width: number;
  natural_height: number;
  fit: "contain";
};
