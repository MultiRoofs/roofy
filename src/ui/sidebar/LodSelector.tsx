/**
 * Per-layer LoD selector.
 *
 * For a static (non-streaming) layer this is unchanged from before: a
 * plain, always-interactive dropdown of the LoDs present in the model.
 * `Layer.lodMode` has no effect on a static layer's rendering — `handleSync`
 * only ever pushes `selectedLod` into `CityModelHandle.setLod` — so the
 * dropdown ignores it rather than gating on a mode that does nothing here.
 *
 * For a streaming layer, `lodMode` DOES matter: "auto" hands the choice to
 * the viewport-streaming driver (commitPlanner.ts's `resolveLod`), which
 * re-derives it every commit from the current cell size via
 * `lodForCellSize` (levelPolicy.ts) — the same call this component makes to
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
} from "../../features/streaming/levelPolicy";

interface LodSelectorProps {
  readonly layerId: string;
  readonly availableLods: ReadonlyArray<string>;
  readonly selectedLod: string | null;
  readonly isStreaming: boolean;
  readonly lodMode: "auto" | "manual";
}

export function LodSelector({
  layerId,
  availableLods,
  selectedLod,
  isStreaming,
  lodMode,
}: LodSelectorProps) {
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
    return (
      <select
        className="lod-select"
        value={selectedLod ?? ""}
        onChange={(e) => setLayerLod(layerId, e.target.value || null)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title="Level of Detail"
      >
        {availableLods.map((lod) => (
          <option key={lod} value={lod}>
            LoD {lod}
          </option>
        ))}
      </select>
    );
  }

  if (lodMode === "manual") {
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
          {availableLods.map((lod) => (
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
