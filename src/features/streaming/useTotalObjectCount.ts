/**
 * "How many city objects are on screen", across static and streaming layers.
 *
 * A streaming layer's `model` is a deliberate STUB — bbox from the header,
 * `objects: {}`, never materialised (see `streamStore.ts`) — so the obvious
 * `Object.keys(layer.model.objects).length` reports 0 for it no matter how
 * many features are resident. The toolbar badge and the status bar both did
 * exactly that, and read "Objects 0" next to two thousand rendered buildings
 * (found by Task C14's browser smoke). This is the object-count counterpart of
 * `totalTriangles`, which already unions the streaming handles.
 *
 * Resident, not total: the same number the layer panel shows, and the honest
 * one — the file may hold a million features, and the viewer has fetched the
 * ones near the camera.
 */
import { useLayerStore } from "../layers/layerStore";
import { useStreamStore } from "./streamStore";
import { getResidentModel } from "./residentModel";

/**
 * Subscribes to the layer list AND to every streaming layer's commit counter,
 * because a commit is precisely what changes the resident count.
 *
 * The subscription selector reduces the versions to ONE number rather than
 * returning an object: Zustand re-runs it on every store notification, so a
 * fresh array or record would re-render on every commit of every layer even
 * when the sum is unchanged. `getResidentModel` is memoised inside the handle
 * on that same counter, so the merge it reads is not rebuilt per call.
 */
export function useTotalObjectCount(): number {
  const layers = useLayerStore((s) => s.layers);
  const versionSum = useStreamStore((s) => {
    let sum = 0;
    for (const entry of Object.values(s.streams)) sum += entry.version;
    return sum;
  });

  let total = 0;
  for (const layer of layers) {
    total += layer.isStreaming
      ? getResidentModel(layer.id, versionSum).featureCount
      : Object.keys(layer.model.objects).length;
  }
  return total;
}
