import { useEffect, useState } from "react";
import type { Preset } from "../../lib/geo";
import type { QuizQuestion } from "../../lib/quizSchema";
import type { SurfacePoint } from "../../lib/surfacePoint";
import { uploadImage } from "../../lib/upload";
import { errMsg } from "../../lib/errMsg";
import { GeoSurface } from "../../surface/GeoSurface";
import { ImageSurface } from "../../surface/ImageSurface";

type Props = {
  question: QuizQuestion;
  quizId: string;
  presets: Record<string, Preset>;
  onChange: (patch: Partial<QuizQuestion>) => void;
};

export function QuestionEditor({ question, quizId, presets, onChange }: Props) {
  const meta = question.surface_meta as Record<string, unknown>;

  function setKind(kind: "geo" | "image") {
    if (kind === question.surface_kind) return;
    if (kind === "geo") {
      const first = Object.keys(presets)[0];
      onChange({ surface_kind: "geo", surface_ref: first, surface_meta: geoMeta(presets, first), solution: null });
    } else {
      onChange({ surface_kind: "image", surface_ref: "", surface_meta: {}, solution: null });
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Question prompt</span>
        <textarea
          value={question.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="Where is Rome?"
          rows={2}
          className="rounded border border-gunmetal/30 p-2"
        />
      </label>

      <div className="flex gap-2">
        <KindButton active={question.surface_kind === "geo"} onClick={() => setKind("geo")}>
          Map
        </KindButton>
        <KindButton active={question.surface_kind === "image"} onClick={() => setKind("image")}>
          Image
        </KindButton>
      </div>

      {question.surface_kind === "geo" ? (
        <GeoEditor question={question} presets={presets} meta={meta} onChange={onChange} />
      ) : (
        <ImageEditor question={question} quizId={quizId} onChange={onChange} />
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Solution label (optional)</span>
        <input
          value={question.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Rome"
          className="rounded border border-gunmetal/30 p-2"
        />
      </label>

      <SolutionReadout solution={question.solution} onChange={onChange} />
    </div>
  );
}

// ── geo ──────────────────────────────────────────────────────────────────
// Friendlier checkbox labels; the layer key (used in surface_meta) is unchanged.
const LAYER_LABELS: Record<string, string> = { admin0_borders: "borders" };

function geoMeta(presets: Record<string, Preset>, preset: string) {
  return { preset, bbox: presets[preset].bbox, layers: Object.keys(presets[preset].layers) };
}

function GeoEditor({
  question,
  presets,
  meta,
  onChange,
}: {
  question: QuizQuestion;
  presets: Record<string, Preset>;
  meta: Record<string, unknown>;
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  const preset = (meta.preset as string) ?? Object.keys(presets)[0];
  const layers = (meta.layers as string[]) ?? [];
  const available = presets[preset] ? Object.keys(presets[preset].layers) : [];

  function setPreset(p: string) {
    onChange({ surface_ref: p, surface_meta: geoMeta(presets, p) });
  }
  function toggleLayer(l: string) {
    const next = layers.includes(l) ? layers.filter((x) => x !== l) : [...layers, l];
    onChange({ surface_meta: { ...meta, layers: next } });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Region
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="rounded border border-gunmetal/30 p-1"
          >
            {Object.keys(presets).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          {available.map((l) => (
            <label key={l} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={layers.includes(l)} onChange={() => toggleLayer(l)} />
              {LAYER_LABELS[l] ?? l}
            </label>
          ))}
        </div>
      </div>
      <p className="text-xs opacity-60">Click the map to place the solution. Zoom in for precision.</p>
      <div className="h-[45vh] w-full overflow-hidden rounded border border-gunmetal/30">
        <GeoSurface
          preset={preset}
          layers={layers}
          solution={question.solution}
          onPick={(p: SurfacePoint) => onChange({ solution: p })}
        />
      </div>
    </>
  );
}

// ── image ────────────────────────────────────────────────────────────────
function ImageEditor({
  question,
  quizId,
  onChange,
}: {
  question: QuizQuestion;
  quizId: string;
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { url, naturalWidth, naturalHeight } = await uploadImage(quizId, file);
      onChange({
        surface_ref: url,
        surface_meta: { natural_width: naturalWidth, natural_height: naturalHeight, fit: "contain" },
        solution: null,
      });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded bg-pacific px-3 py-1 text-sm font-semibold text-white">
          {question.surface_ref ? "Replace image" : busy ? "Uploading…" : "Upload image"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {error && <span className="text-xs text-pink">{error}</span>}
      </div>
      {question.surface_ref && (
        <>
          <p className="text-xs opacity-60">Tap the image to place the solution. Drag to pan, wheel/pinch to zoom.</p>
          <div className="h-[45vh] w-full overflow-hidden rounded border border-gunmetal/30">
            <ImageSurface
              src={question.surface_ref}
              solution={question.solution}
              onPick={(p: SurfacePoint) => onChange({ solution: p })}
            />
          </div>
        </>
      )}
    </>
  );
}

// ── shared bits ────────────────────────────────────────────────────────────
function KindButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-4 py-1 text-sm font-semibold ${
        active ? "bg-gunmetal text-white" : "bg-gunmetal/10 text-gunmetal"
      }`}
    >
      {children}
    </button>
  );
}

function SolutionReadout({
  solution,
  onChange,
}: {
  solution: SurfacePoint | null;
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="font-semibold">Solution:</span>
      {!solution ? (
        <span className="opacity-60">not placed yet</span>
      ) : solution.kind === "geo" ? (
        <GeoSolutionFields sol={solution} onChange={onChange} />
      ) : (
        <span className="font-mono">
          x {solution.x.toFixed(3)}, y {solution.y.toFixed(3)}
        </span>
      )}
      {solution && (
        <button onClick={() => onChange({ solution: null })} className="text-xs underline opacity-70">
          clear
        </button>
      )}
    </div>
  );
}

// Editable lat/lng. Local buffers let you type freely (partial "-", "12.")
// without the map click / re-format fighting the keystrokes.
function GeoSolutionFields({
  sol,
  onChange,
}: {
  sol: { kind: "geo"; lat: number; lng: number };
  onChange: (patch: Partial<QuizQuestion>) => void;
}) {
  const [lat, setLat] = useState(String(sol.lat));
  const [lng, setLng] = useState(String(sol.lng));

  // Resync from external changes (map click) unless the buffer already means it.
  useEffect(() => {
    if (parseFloat(lat) !== sol.lat) setLat(sol.lat.toFixed(4));
    if (parseFloat(lng) !== sol.lng) setLng(sol.lng.toFixed(4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sol.lat, sol.lng]);

  function commit(nLat: string, nLng: string) {
    const la = parseFloat(nLat);
    const lo = parseFloat(nLng);
    if (!Number.isNaN(la) && !Number.isNaN(lo)) onChange({ solution: { kind: "geo", lat: la, lng: lo } });
  }

  return (
    <span className="flex items-center gap-1 font-mono">
      <input
        type="number"
        step="any"
        value={lat}
        onChange={(e) => { setLat(e.target.value); commit(e.target.value, lng); }}
        className="w-24 rounded border border-gunmetal/30 px-1"
        aria-label="latitude"
      />
      <input
        type="number"
        step="any"
        value={lng}
        onChange={(e) => { setLng(e.target.value); commit(lat, e.target.value); }}
        className="w-24 rounded border border-gunmetal/30 px-1"
        aria-label="longitude"
      />
    </span>
  );
}
