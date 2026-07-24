import { useCallback, useEffect, useRef, useState } from "react";
import type { SurfacePoint } from "../lib/surfacePoint";

// Image authoring surface (CLAUDE.md §7): pan/zoom via pointer events, click places
// the solution as a NORMALISED {x,y} in 0..1 (device-independent). We handle all
// gestures ourselves; the container sets touch-action:none.

type Transform = { scale: number; tx: number; ty: number };
type Props = { src: string; solution: SurfacePoint | null; onPick: (p: SurfacePoint) => void };

const CLICK_MOVE_PX = 8; // pointerup that moved more than this = pan, not a pick

export function ImageSurface({ src, solution, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [t, setT] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });

  // Active pointers, plus movement bookkeeping for click detection.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const fit = useCallback(() => {
    const c = containerRef.current;
    const img = imgRef.current;
    if (!c || !img || !img.naturalWidth) return;
    const scale = Math.min(c.clientWidth / img.naturalWidth, c.clientHeight / img.naturalHeight);
    const tx = (c.clientWidth - img.naturalWidth * scale) / 2;
    const ty = (c.clientHeight - img.naturalHeight * scale) / 2;
    setT({ scale, tx, ty });
  }, []);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  function zoomAround(cx: number, cy: number, ratio: number) {
    setT((prev) => {
      const scale = Math.min(20, Math.max(0.05, prev.scale * ratio));
      const r = scale / prev.scale;
      return { scale, tx: cx - (cx - prev.tx) * r, ty: cy - (cy - prev.ty) * r };
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    zoomAround(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);

    if (downAt.current) {
      if (Math.hypot(cur.x - downAt.current.x, cur.y - downAt.current.y) > CLICK_MOVE_PX)
        moved.current = true;
    }

    if (pointers.current.size === 1) {
      setT((p) => ({ ...p, tx: p.tx + (cur.x - prev.x), ty: p.ty + (cur.y - prev.y) }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current > 0) {
        const rect = containerRef.current!.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        zoomAround(midX, midY, dist / pinchDist.current);
      }
      pinchDist.current = dist;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = 0;

    // A tap that didn't pan → place the pin.
    if (!moved.current && pointers.current.size === 0) {
      const img = imgRef.current;
      if (img) {
        const r = img.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPick({ kind: "image", x, y });
      }
    }
    downAt.current = null;
  }

  const pin = solution && solution.kind === "image" ? solution : null;

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative h-full w-full overflow-hidden bg-gunmetal"
      style={{ touchAction: "none", userSelect: "none" }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <img
          ref={imgRef}
          src={src}
          onLoad={fit}
          draggable={false}
          alt="quiz surface"
          style={{ display: "block", maxWidth: "none" }}
        />
        {pin && (
          <div
            style={{
              position: "absolute",
              left: `${pin.x * 100}%`,
              top: `${pin.y * 100}%`,
              width: 18 / t.scale,
              height: 18 / t.scale,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: "#f8a0cb",
              border: `${3 / t.scale}px solid #424242`,
              boxShadow: `0 0 0 ${2 / t.scale}px #fff`,
            }}
          />
        )}
      </div>
    </div>
  );
}
