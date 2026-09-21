/**
 * Per-layer LoD selector.
 *
 * Static layers select multiple LoDs; each object draws only its highest
 * selected representation. Streaming keeps its existing zoom-driven policy.
 *
 * For a streaming layer, `lodMode` DOES matter: "auto" hands the choice to
 * the viewport-streaming driver (commitPlanner.ts's `resolveLod`), which
 * re-derives it every commit from the current cell size via
 * `lodForCellSize` (the plugin's levelPolicy.ts) — the same call this makes to
 * describe it. Because the user isn't choosing in that mode, the control
 * becomes a read-out instead of a `<select>`: it shows the LoD actually in
 * use and the cell size that produced it, so a user can tell *why* they're
 * seeing that detail level, plus a button to switch to "manual" (pins one
 * LoD everywhere, same as a static layer).
 */

import { useLayerStore } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import {
  cellSize,
  lodForCellSize,
  type LodSelection,
} from "@cityjson/navara-flatcitybuf";

interface LodSelectorProps {
  readonly layerId: string;
  readonly availableLods: ReadonlyArray<string>;
  readonly selectedLod: string | null;
  readonly selectedLods?: readonly string[];
  readonly isStreaming: boolean;
  readonly lodMode: "auto" | "manual";
}

export function LodSelector({
  layerId,
  availableLods,
  selectedLod,
  selectedLods,
  isStreaming,
  lodMode,
}: LodSelectorProps) {
  const setLayerLods = useLayerStore((s) => s.setLayerLods);
  const setLayerLod = useLayerStore((s) => s.setLayerLod);
  const setLodMode = useLayerStore((s) => s.setLodMode);

  // Only meaningful for a streaming layer, but always subscribed (not
  // conditionally, per Rules of Hooks) — individual primitive/reference
  // fields rather than the whole `StreamState` object, so this component
  // doesn't re-render on fields it doesn't read (e.g. every cell commit's
  // `version` bump). None of these are ever reassigned by a commit, only by
  // a level/ladder change, per streamStore.ts's reducers.
  const level = useStreamStore((s) => s.streams[layerId]?.level);
  const grid = useStreamStore((s) => s.streams[layerId]?.grid);
  const ladder = useStreamStore((s) => s.streams[layerId]?.ladder);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  if (!isStreaming) {
    if (availableLods.length === 0) return null;
    const selected =
      selectedLods ?? (selectedLod === null ? availableLods : [selectedLod]);
    return (
      <div className="lod-multiselect" onClick={stop} onPointerDown={stop}>
        <div
          className="layer-types-list"
          role="group"
          aria-label="Levels of detail"
        >
          {availableLods.map((lod) => (
            <label className="layer-types-item" key={lod}>
              <input
                type="checkbox"
                checked={selected.includes(lod)}
                onChange={() =>
                  setLayerLods(
                    layerId,
                    selected.includes(lod)
                      ? selected.filter((value) => value !== lod)
                      : [...selected, lod],
                  )
                }
              />
              LoD {lod}
            </label>
          ))}
        </div>
        <p className="active-layer-note">
          {selected.length === 0
            ? "No LoDs selected. Nothing is shown."
            : "Shows each object's highest selected LoD available."}
        </p>
      </div>
    );
  }

  if (lodMode === "manual") {
    // The LADDER, not `availableLods`. A streaming layer's `Layer.model` is an
    // empty stub — `computeAvailableLods` has nothing to read — so the layer
    // store's list is permanently `[]` and this select used to offer "All" and
    // nothing else, i.e. a manual mode with no LoD to pin. The labels a
    // streaming layer really has are LEARNED from the cells the worker
    // returns and published on `streamStore.ladder` (openStreamingLayer.ts),
    // which is the same source the Auto read-out below already reads.
    const lods = ladder ?? availableLods;
    return (
      <div
        className="lod-selector-streaming"
        onClick={stop}
        onMouseDown={stop}
        onPointerDown={stop}
      >
        <select
          className="lod-select"
          value={selectedLod ?? ""}
          onChange={(e) => setLayerLod(layerId, e.target.value || null)}
          title="Level of Detail (manual — pinned everywhere)"
        >
          <option value="">All</option>
          {lods.map((lod) => (
            <option key={lod} value={lod}>
              LoD {lod}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="lod-mode-btn"
          title="Switch to automatic LoD (follows zoom / cell size)"
          onClick={() => setLodMode(layerId, "auto")}
        >
          Auto
        </button>
      </div>
    );
  }

  // auto: a read-out, not an editable control.
  const cellSizeM =
    typeof level === "number" && grid ? cellSize(grid, level) : null;
  const selection: LodSelection | null =
    cellSizeM !== null ? lodForCellSize(ladder ?? [], cellSizeM) : null;

  return (
    <div
      className="lod-selector-streaming lod-readout"
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      title="Automatic — LoD follows the current cell size. Switch to Manual to pin one LoD everywhere."
    >
      <span className="lod-readout-value">
        {selection ? describeLodSelection(selection) : "Auto"}
      </span>
      {cellSizeM !== null && (
        <span className="lod-readout-cellsize">
          {formatCellSize(cellSizeM)} cells
        </span>
      )}
      <button
        type="button"
        className="lod-mode-btn"
        title="Switch to manual LoD"
        onClick={() => setLodMode(layerId, "manual")}
      >
        Manual
      </button>
    </div>
  );
}

function describeLodSelection(sel: LodSelection): string {
  if (sel.kind === "exact") return `LoD ${sel.lod}`;
  // `{kind:"unlabelled"}` is unreachable from `lodForCellSize` today (see
  // commitPlanner.ts's `lodToWireLabel` doc comment — a ladder of length
  // 0 already maps to "all") but handled here rather than silently
  // mismatching `LodSelection`'s full type.
  if (sel.kind === "unlabelled") return "Unlabelled";
  return "All LoDs";
}

function formatCellSize(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}
