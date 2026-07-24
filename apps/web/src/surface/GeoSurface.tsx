import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { feature } from "topojson-client";
import { loadManifest, type Preset } from "../lib/geo";
import type { SurfacePoint, SurfacePin } from "../lib/surfacePoint";

// Near-empty authoring/play map (CLAUDE.md §6): no basemap tiles, just
// palette-coloured GeoJSON from self-hosted TopoJSON. Renders any number of
// coloured pins; clicking picks a point when onPick is supplied.

const BG = "#ebd1ad"; // wheat
const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": BG } }],
};

const FILL_ORDER = ["land", "focus", "lakes"];
const LINE_ORDER = ["coastline", "admin0_borders", "rivers"];

function addLayerStyle(map: maplibregl.Map, key: string, srcId: string, lyrId: string) {
  switch (key) {
    case "land":
    case "focus":
      map.addLayer({ id: lyrId, type: "fill", source: srcId, paint: { "fill-color": "#93914d", "fill-opacity": 0.45 } });
      break;
    case "lakes":
      map.addLayer({ id: lyrId, type: "fill", source: srcId, paint: { "fill-color": "#5296a5", "fill-opacity": 0.55 } });
      break;
    case "coastline":
      map.addLayer({ id: lyrId, type: "line", source: srcId, paint: { "line-color": "#424242", "line-width": 1.2 } });
      break;
    case "admin0_borders":
      map.addLayer({ id: lyrId, type: "line", source: srcId, paint: { "line-color": "#424242", "line-width": 1, "line-dasharray": [2, 1.5] } });
      break;
    case "rivers":
      map.addLayer({ id: lyrId, type: "line", source: srcId, paint: { "line-color": "#5296a5", "line-width": 0.8 } });
      break;
    default:
      map.addLayer({ id: lyrId, type: "line", source: srcId, paint: { "line-color": "#424242", "line-width": 1 } });
  }
}

type TopoLike = { objects: Record<string, unknown> };
const geoCache = new Map<string, GeoJSON.FeatureCollection>();
async function fetchLayer(url: string): Promise<GeoJSON.FeatureCollection> {
  const cached = geoCache.get(url);
  if (cached) return cached;
  const topo = (await (await fetch(url)).json()) as TopoLike;
  const firstKey = Object.keys(topo.objects)[0];
  const fc = feature(topo as never, topo.objects[firstKey] as never) as unknown as GeoJSON.FeatureCollection;
  geoCache.set(url, fc);
  return fc;
}

function pinElement(pin: SurfacePin): HTMLElement {
  // Just the dot — no label. A dot-only element anchored at its centre sits
  // exactly on the lng/lat at every zoom (a label in the box shifted the anchor).
  const dot = document.createElement("div");
  if (pin.solution) {
    dot.style.cssText =
      "width:16px;height:16px;background:#fff;border:4px solid #424242;transform:rotate(45deg);box-shadow:0 0 0 2px #fff";
  } else {
    dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${pin.color};border:2px solid #fff;box-shadow:0 0 0 1px #424242`;
  }
  dot.title = pin.label ?? "";
  return dot;
}

type Props = {
  preset: string;
  layers: string[];
  pins: SurfacePin[];
  onPick?: (p: SurfacePoint) => void;
};

export function GeoSurface({ preset, layers, pins, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: EMPTY_STYLE,
      center: [0, 20],
      zoom: 1,
      attributionControl: false,
      dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (e) => onPickRef.current?.({ kind: "geo", lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Rebuild base layers + refit on preset / layer / ready change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    (async () => {
      const manifest = await loadManifest();
      const p: Preset | undefined = manifest.presets[preset];
      if (!p || cancelled) return;
      for (const l of map.getStyle().layers ?? []) if (l.id.startsWith("lyr-")) map.removeLayer(l.id);
      for (const id of Object.keys(map.getStyle().sources ?? {})) if (id.startsWith("src-")) map.removeSource(id);
      const ordered = [...FILL_ORDER, ...LINE_ORDER].filter((k) => layers.includes(k) && p.layers[k]);
      for (const key of ordered) {
        const fc = await fetchLayer(p.layers[key].url);
        if (cancelled || !mapRef.current) return;
        map.addSource(`src-${key}`, { type: "geojson", data: fc });
        addLayerStyle(map, key, `src-${key}`, `lyr-${key}`);
      }
      const [w, s, e, n] = p.bbox;
      map.fitBounds([[w, s], [e, n]], { padding: 20, animate: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [preset, layers, ready]);

  // Sync pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = pins
      .filter((pin) => pin.point.kind === "geo")
      .map((pin) => {
        const gp = pin.point as { kind: "geo"; lat: number; lng: number };
        return new maplibregl.Marker({ element: pinElement(pin), anchor: "center" })
          .setLngLat([gp.lng, gp.lat])
          .addTo(map);
      });
  }, [pins]);

  return <div ref={containerRef} className="h-full w-full" />;
}
