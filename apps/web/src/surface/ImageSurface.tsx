import { useCallback, useEffect, useRef, useState } from "react";
import type { SurfacePoint, SurfacePin } from "../lib/surfacePoint";

// Image surface (CLAUDE.md §7): pan/zoom pointer handling, renders coloured pins
// at normalised {x,y}. Clicking picks a point when onPick is supplied.

type Transform = { scale: number; tx: number; ty: number };
type Props = { src: string; pins: SurfacePin[]; onPick?: (p: SurfacePoint) => void };

const CLICK_MOVE_PX = 8;

export function ImageSurface({ src, pins, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [t, setT] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const fit = useCallback(() => {
    const c = containerRef.current;
    const img = imgRef.current;
    if (!c || !img || !img.naturalWidth) return;
    const scale = Math.min(c.clientWidth / img.naturalWidth, c.clientHeight / img.naturalHeight);
    setT({
      scale,
      tx: (c.clientWidth - img.naturalWidth * scale) / 2,
      ty: (c.clientHeight - img.naturalHeight * scale) / 2,
    });
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
    if (downAt.current && Math.hypot(cur.x - downAt.current.x, cur.y - downAt.current.y) > CLICK_MOVE_PX)
      moved.current = true;

    if (pointers.current.size === 1) {
      setT((p) => ({ ...p, tx: p.tx + (cur.x - prev.x), ty: p.ty + (cur.y - prev.y) }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current > 0) {
        const rect = containerRef.current!.getBoundingClientRect();
        zoomAround((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, dist / pinchDist.current);
      }
      pinchDist.current = dist;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = 0;
    if (onPick && !moved.current && pointers.current.size === 0) {
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
      <div style={{ position: "absolute", top: 0, left: 0, transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`, transformOrigin: "0 0" }}>
        <img ref={imgRef} src={src} onLoad={fit} draggable={false} alt="quiz surface" style={{ display: "block", maxWidth: "none" }} />
        {pins
          .filter((p) => p.point.kind === "image")
          .map((pin) => {
            const ip = pin.point as { kind: "image"; x: number; y: number };
            const size = 16 / t.scale;
            return (
              <div
                key={pin.id}
                style={{
                  position: "absolute",
                  left: `${ip.x * 100}%`,
                  top: `${ip.y * 100}%`,
                  transform: pin.solution ? "translate(-50%,-50%) rotate(45deg)" : "translate(-50%,-50%)",
                  width: size,
                  height: size,
                  borderRadius: pin.solution ? 0 : "50%",
                  background: pin.solution ? "#fff" : pin.color,
                  border: `${(pin.solution ? 4 : 2) / t.scale}px solid ${pin.solution ? "#424242" : "#fff"}`,
                  boxShadow: `0 0 0 ${1 / t.scale}px #424242`,
                }}
                title={pin.label}
              />
            );
          })}
      </div>
    </div>
  );
}
