import { geoidHeightAt } from "@cityjson/navara-core";
import { prepareDrawing } from "../../features/drawing/prepareDrawing";
import { useState, useEffect, useRef, type RefObject } from "react";
import type { CitySceneHandle } from "../../scene/NavaraViewport";
import type { Vec3 } from "../../domain/citymodel/types";
import { useDrawStore } from "../../features/drawing/drawStore";
import { drawnModel, modelDataUrl } from "../../features/drawing/geometry";
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
      onKeyDown={(e) => {
        if (e.key === "Escape") useDrawStore.getState().stop();
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          if (extruding) void finish(height);
          else finishFootprint();
        }
      }}
    >
      <svg
        className="draw-canvas"
        onPointerMove={(e) => {
          if (busy) return;
          if (extruding) {
            const rect = e.currentTarget.getBoundingClientRect();
            const last = points.at(-1)!;
            setHeight(
              Math.max(
                0,
                Math.min(
                  1000,
                  Math.round((last.y - (e.clientY - rect.top)) * 0.5),
                ),
              ),
            );
          }
        }}
        onClick={(e) => {
          if (busy) return;
          if (extruding) {
            finish(height);
            return;
          }
          if (points.length >= 64) {
            setError("A footprint can have up to 64 corners.");
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left,
            y = e.clientY - rect.top;
          if (
            points.length >= 3 &&
            Math.hypot(x - points[0]!.x, y - points[0]!.y) < 12
          ) {
            finishFootprint();
            return;
          }
          const world = scene.current?.pickDrawingPoint?.(x, y);
          if (!world) {
            setError("Click a visible ground surface, not the sky.");
            return;
          }
          setError("");
          setPoints([...points, { world, x, y }]);
        }}
      >
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
      <div
        className="draw-instructions"
        role="region"
        aria-label="Drawing controls"
      >
        <strong>{extruding ? "Set height" : "Draw footprint"}</strong>
        <p>
          {extruding
            ? "Move up to raise the preview, then click the map to finish."
            : "Click to add corners. Click the first corner or Finish footprint to close."}
        </p>
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Placing your model…</p>}
        <fieldset disabled={busy} className="button-group">
          {extruding ? (
            <>
              <label>
                Height (m){" "}
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </label>
              <button onClick={() => finish(height)}>Finish solid</button>
              <button onClick={() => setExtruding(false)}>
                Edit footprint
              </button>
            </>
          ) : (
            <>
              <button disabled={points.length < 3} onClick={finishFootprint}>
                Finish footprint
              </button>
              <button disabled={points.length < 3} onClick={() => finish(0)}>
                Finish as 2D
              </button>
              <button
                disabled={!points.length}
                onClick={() => setPoints(points.slice(0, -1))}
              >
                Undo corner
              </button>
            </>
          )}
          <button onClick={() => useDrawStore.getState().stop()}>Cancel</button>
        </fieldset>
      </div>
    </div>
  );
}
