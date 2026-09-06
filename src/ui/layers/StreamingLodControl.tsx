/**
 * The LoD control for STREAMING layers — one control for all of them, not one
 * per layer.
 *
 * A streaming layer's available LoDs are not knowable when the layer is
 * created: the ladder is discovered from the cells the worker actually decodes
 * (`onLadder` → `streamStore.ladder`), so it starts empty and grows as the
 * user flies around. A per-layer dropdown populated at load time is therefore
 * a dropdown that is empty exactly when the user first looks at it — which is
 * why the per-layer selector is gone from the streaming rows in `LayerPanel`
 * and this stands in its place.
 *
 * Global for the same reason it is a discovery problem: the detail level is a
 * property of how you want to LOOK at the scene, not of one dataset, and two
 * streaming layers of the same city rendered at different LoDs is a comparison
 * nobody asked for. (Camera-sync, by contrast, IS per-layer — freezing one
 * extract while panning another is the whole point of it.)
 *
 * The control offers only LoDs actually observed, unioned across every open
 * streaming layer, plus `Auto` — which is both the default and the honest
 * answer while nothing has been discovered yet, because in that mode the
 * plugin re-derives the LoD every commit from the current cell size
 * (`commitPlanner`'s `resolveLod`).
 */

import { useLayerStore } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";

export interface StreamingLodControlProps {
  /** The control's visible label. It defaults to the compact "Streaming LoD"
   *  the dense layer row wants; the active layer's Details section passes the
   *  long form, because there the control sits among PER-LAYER settings and
   *  has to say out loud that it is not one of them. */
  readonly label?: string;
}

export function StreamingLodControl({
  label = "Streaming LoD",
}: StreamingLodControlProps = {}) {
  const layers = useLayerStore((s) => s.layers);
  const setLayerLod = useLayerStore((s) => s.setLayerLod);
  const setLodMode = useLayerStore((s) => s.setLodMode);
  const streams = useStreamStore((s) => s.streams);

  const streamingLayers = layers.filter((l) => l.isStreaming);
  if (streamingLayers.length === 0) return null;

  // The union of every ladder discovered so far, highest detail first — the
  // same ordering `computeAvailableLods` uses for static layers, so the two
  // controls do not disagree about which end of the list is "more detail".
  const discovered = new Set<string>();
  for (const layer of streamingLayers) {
    for (const lod of streams[layer.id]?.ladder ?? []) discovered.add(lod);
  }
  const ladder = [...discovered].sort(
    (a, b) => Number.parseFloat(b) - Number.parseFloat(a),
  );

  // One control drives every streaming layer, so it can only show a single
  // value honestly. Mixed state (possible only if something set them apart
  // outside this control) reads as Auto rather than silently claiming one of
  // the two.
  const allManual = streamingLayers.every((l) => l.lodMode === "manual");
  const pinned = allManual ? streamingLayers[0]!.selectedLod : null;
  const value =
    allManual &&
    pinned !== null &&
    streamingLayers.every((l) => l.selectedLod === pinned)
      ? pinned
      : "auto";

  const apply = (next: string) => {
    for (const layer of streamingLayers) {
      if (next === "auto") {
        setLodMode(layer.id, "auto");
      } else {
        setLodMode(layer.id, "manual");
        setLayerLod(layer.id, next);
      }
    }
  };

  return (
    <div className="streaming-lod-control">
      <label htmlFor="streaming-lod">{label}</label>
      <select
        id="streaming-lod"
        className="advanced-select"
        value={value}
        title={
          ladder.length === 0
            ? "Levels of detail appear here as they are discovered in the stream"
            : "Level of detail for every streaming layer"
        }
        onChange={(e) => apply(e.target.value)}
      >
        <option value="auto">Auto</option>
        {ladder.map((lod) => (
          <option key={lod} value={lod}>
            LoD {lod}
          </option>
        ))}
      </select>
    </div>
  );
}
