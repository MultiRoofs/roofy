import { geoidHeightAt } from "@cityjson/navara-core";
import { prepareDrawing } from "../../features/drawing/prepareDrawing";
import { useState, useEffect, useRef, type RefObject } from "react";
import type { CitySceneHandle } from "../../scene/NavaraViewport";
import type { Vec3 } from "../../domain/citymodel/types";
import { useDrawStore } from "../../features/drawing/drawStore";
import {
  drawnModel,
  modelDataUrl,
  drawingEdgeLength,
} from "../../features/drawing/geometry";
import { addCityLayer } from "../../features/layers/addCityLayer";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { activateLayer } from "../../features/workspace/layerCoordination";
export function DrawOverlay({
  scene,
}: {
  scene: RefObject<CitySceneHandle | null>;
}) {
  const [points, setPoints] = useState<{ world: Vec3; x: number; y: number }[]>(
    [],
  );
  const [cursor, setCursor] = useState<{
    world: Vec3;
    x: number;
    y: number;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    alive.current = true;
    root.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);
  const [extruding, setExtruding] = useState(false);
  const [height, setHeight] = useState(10);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (
        !useGeoLayerStore
          .getState()
          .layers.some((l) => l.id === useDrawStore.getState().layerId)
      ) {
        useDrawStore.getState().finish();
        return;
      }
      setPoints((current) => {
        const projected = current.map((p) => {
          const screen = scene.current?.projectDrawingPoint?.([
            p.world[0],
            p.world[1],
            current[0]!.world[2],
          ]);
          return screen ? { ...p, ...screen } : p;
        });
        return projected.some(
          (p, i) =>
            Math.abs(p.x - current[i]!.x) > 0.1 ||
            Math.abs(p.y - current[i]!.y) > 0.1,
        )
          ? projected
          : current;
      });
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [scene]);
  const finish = async (h: number) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const placeholder = useDrawStore.getState().layerId;
    try {
      const model = await prepareDrawing(
        points.map((p) => p.world),
        h,
        geoidHeightAt,
      );
      if (
        !alive.current ||
        !useDrawStore.getState().active ||
        useDrawStore.getState().layerId !== placeholder ||
        !useGeoLayerStore.getState().layers.some((l) => l.id === placeholder)
      )
        return;
      const id = addCityLayer({
        name: h ? "Drawn solid" : "Drawn polygon",
        model,
        modelRef: { type: "url", url: modelDataUrl(model) },
        duckdb: { kind: "model", model },
      });
      if (placeholder) useGeoLayerStore.getState().removeGeoLayer(placeholder);
      activateLayer(id);
      useDrawStore.getState().finish();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Could not finish drawing.");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const finishFootprint = () => {
    try {
      drawnModel(
        points.map((p) => p.world),
        0,
      );
      setExtruding(true);
      setCursor(points.at(-1) ?? null);
      setHeight(10);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const roof = points.map(
    (p) =>
      scene.current?.projectDrawingPoint?.([
        p.world[0],
        p.world[1],
        points[0]!.world[2] + height,
      ]) ?? { x: p.x, y: p.y - height * 2 },
  );
  return (
    <div
      ref={root}
      className="draw-overlay"
      tabIndex={0}
      aria-label="Draw model. Double-click or Enter finishes the footprint. Up and Down adjust height; Shift changes it by ten metres. Enter saves. Escape cancels."
      onKeyDown={(e) => {
        if (
          extruding &&
          !busy &&
          (e.key === "ArrowUp" || e.key === "ArrowDown")
        ) {
          e.preventDefault();
          const next = Math.max(
            0,
            Math.min(
              1000,
              height + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1),
            ),
          );
          setHeight(next);
          setAnnouncement(`Height ${next} metres`);
        }
        if (e.key === "Escape") useDrawStore.getState().stop();
        if (
          !extruding &&
          (e.key === "Backspace" || e.key === "Delete") &&
          e.target === e.currentTarget
        ) {
          e.preventDefault();
          setPoints((current) => current.slice(0, -1));
        }
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          if (extruding) void finish(height);
          else finishFootprint();
        }
      }}
    >
      <svg
        className="draw-canvas"
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy && !extruding) finishFootprint();
        }}
        onPointerMove={(e) => {
          if (busy) return;
          if (extruding) {
            const rect = e.currentTarget.getBoundingClientRect();
            const last = points.at(-1)!;
            setCursor({
              world: last.world,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
            setHeight(
              Math.max(
                0,
                Math.min(
                  1000,
                  Math.round(10 + (last.y - (e.clientY - rect.top)) * 2),
                ),
              ),
            );
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left,
              y = e.clientY - rect.top;
            const world = scene.current?.pickDrawingPoint?.(x, y);
            setCursor(world ? { world, x, y } : null);
          }
        }}
        onClick={(e) => {
          // A double-click's second click must not add a duplicate vertex or
          // immediately commit the extrusion that the gesture is opening.
          if (busy || e.detail > 1) return;
          if (extruding) {
            void finish(height);
            return;
          }
          if (points.length >= 64) {
            setError("A footprint can have up to 64 corners.");
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left,
            y = e.clientY - rect.top;
          const world = scene.current?.pickDrawingPoint?.(x, y);
          if (!world) {
            setError("Click a visible ground surface, not the sky.");
            return;
          }
          setError("");
          setPoints([...points, { world, x, y }]);
        }}
      >
        {!extruding && cursor && points.length > 0 && (
          <line
            x1={points.at(-1)!.x}
            y1={points.at(-1)!.y}
            x2={cursor.x}
            y2={cursor.y}
            stroke="#486f2c"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}
        <polygon
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="#a7e32b33"
          stroke="#486f2c"
          strokeWidth="2"
        />
        {extruding && (
          <>
            <polygon
              points={roof.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="#a7e32b55"
              stroke="#486f2c"
              strokeWidth="2"
            />
            {points.map((p, i) => (
              <line
                key={i}
                x1={p.x}
                y1={p.y}
                x2={roof[i]!.x}
                y2={roof[i]!.y}
                stroke="#486f2c"
              />
            ))}
          </>
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="5"
            fill="white"
            stroke="#486f2c"
            strokeWidth="2"
          />
        ))}
      </svg>
      {cursor && points.length > 0 && (
        <div
          className="draw-edge-length"
          role="tooltip"
          style={{
            left: Math.max(
              8,
              Math.min(
                cursor.x + 14,
                (root.current?.clientWidth ?? 1000) - 100,
              ),
            ),
            top: Math.max(
              8,
              Math.min(
                cursor.y + 14,
                (root.current?.clientHeight ?? 1000) - 40,
              ),
            ),
          }}
        >
          {(extruding
            ? height
            : drawingEdgeLength(points.at(-1)!.world, cursor.world)
          ).toFixed(1)}{" "}
          m
        </div>
      )}
      <span className="draw-announcement" role="status">
        {announcement}
      </span>
      {error && (
        <p className="draw-feedback" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="draw-feedback" role="status">
          Placing your model…
        </p>
      )}
    </div>
  );
}
