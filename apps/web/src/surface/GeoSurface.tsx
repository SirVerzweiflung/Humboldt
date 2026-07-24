import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { feature } from "topojson-client";
import { loadManifest, type Preset } from "../lib/geo";
import type { SurfacePoint } from "../lib/surfacePoint";

// Near-empty authoring map (CLAUDE.md §6): no basemap tiles, just palette-coloured
// GeoJSON built from the self-hosted TopoJSON layers. Click places the solution.

const BG = "#ebd1ad"; // wheat
const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": BG } }],
};

// Draw order: fills under lines.
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

// Minimal TopoJSON shape — we only need objects, and hand it straight to feature().
type TopoLike = { objects: Record<string, unknown> };

const geoCache = new Map<string, GeoJSON.FeatureCollection>();
async function fetchLayer(url: string): Promise<GeoJSON.FeatureCollection> {
  const cached = geoCache.get(url);
  if (cached) return cached;
  const topo = (await (await fetch(url)).json()) as TopoLike;
  const firstKey = Object.keys(topo.objects)[0];
  // topojson-client's types are strict; the runtime call is correct.
  const fc = feature(
    topo as never,
    topo.objects[firstKey] as never,
  ) as unknown as GeoJSON.FeatureCollection;
  geoCache.set(url, fc);
  return fc;
}

type Props = {
  preset: string;
  layers: string[];
  solution: SurfacePoint | null;
  onPick: (p: SurfacePoint) => void;
};

export function GeoSurface({ preset, layers, solution, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [ready, setReady] = useState(false);

  // Create the map once.
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
    map.on("click", (e) => onPickRef.current({ kind: "geo", lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Rebuild layers + refit whenever the preset, the visible layer set, or readiness changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const manifest = await loadManifest();
      const p: Preset | undefined = manifest.presets[preset];
      if (!p || cancelled) return;

      // Remove any existing quiz layers/sources.
      for (const l of map.getStyle().layers ?? []) {
        if (l.id.startsWith("lyr-")) map.removeLayer(l.id);
      }
      for (const id of Object.keys(map.getStyle().sources ?? {})) {
        if (id.startsWith("src-")) map.removeSource(id);
      }

      // Add requested layers that exist in this preset, fills first.
      const ordered = [...FILL_ORDER, ...LINE_ORDER].filter((k) => layers.includes(k) && p.layers[k]);
      for (const key of ordered) {
        const fc = await fetchLayer(p.layers[key].url);
        if (cancelled || !mapRef.current) return;
        const srcId = `src-${key}`;
        const lyrId = `lyr-${key}`;
        map.addSource(srcId, { type: "geojson", data: fc });
        addLayerStyle(map, key, srcId, lyrId);
      }

      const [w, s, e, n] = p.bbox;
      map.fitBounds([[w, s], [e, n]], { padding: 20, animate: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [preset, layers, ready]);

  // Solution marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!solution || solution.kind !== "geo") {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:18px;height:18px;border-radius:50%;background:#f8a0cb;border:3px solid #424242;box-shadow:0 0 0 2px #fff";
      markerRef.current = new maplibregl.Marker({ element: el });
    }
    markerRef.current.setLngLat([solution.lng, solution.lat]).addTo(map);
  }, [solution]);

  return <div ref={containerRef} className="h-full w-full" />;
}
