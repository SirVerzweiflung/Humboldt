import { GeoSurface } from "./GeoSurface";
import { ImageSurface } from "./ImageSurface";
import type { SurfacePoint, SurfacePin } from "../lib/surfacePoint";

// Renders the surface for a round (geo or image) from its stored fields, with any
// number of coloured pins. Shared by host / player / board so they always draw the
// same map the quiz was authored on.
type RoundLike = {
  surface_kind: "geo" | "image";
  surface_ref: string;
  surface_meta: Record<string, unknown>;
};

export function RoundSurface({
  round,
  pins,
  onPick,
}: {
  round: RoundLike;
  pins: SurfacePin[];
  onPick?: (p: SurfacePoint) => void;
}) {
  if (round.surface_kind === "geo") {
    const preset = (round.surface_meta.preset as string) ?? round.surface_ref;
    const layers = (round.surface_meta.layers as string[]) ?? [];
    return <GeoSurface preset={preset} layers={layers} pins={pins} onPick={onPick} />;
  }
  return <ImageSurface src={round.surface_ref} pins={pins} onPick={onPick} />;
}
