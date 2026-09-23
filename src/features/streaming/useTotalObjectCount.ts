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
 * Resident AND total: `loaded` is the same number the layer panel shows —
 * the file may hold a million features, and the viewer has fetched the ones
 * near the camera — and `total` is the dataset's size where the stream's
 * header states it, so the status bar can say "12.3K of 884.1K".
 *
 * THE TOTAL IS THE OPENED FAMILIES'. A CityParquet package is a set of object
 * families and only the enabled ones are streaming (ruling R-D opens Building
 * alone), so measuring the loaded objects against the whole package would read
 * as a stream that has barely started — and would never reach its own total. The
 * opened families' own row counts are the honest denominator, and the stream
 * header is the fallback for a layer whose families have not reported theirs yet
 * (and for every layer that has no families at all).
 */
import { useLayerStore } from "../layers/layerStore";
import { openedFamilyRows, useFamilyStore } from "../layers/familyStore";
import { useStreamStore } from "./streamStore";
import { getResidentModel } from "./residentModel";

/** Loaded objects, and the objects the layers' datasets hold in total. */
export interface TotalObjectCount {
  /** Static layers' objects plus every stream's resident objects. */
  readonly loaded: number;
  /** Static layers' objects plus every stream's `header.objectsCount`, or
   *  `null` when any streamed layer does not know its dataset's size — every
   *  FlatCityBuf layer, whose header counts features, not objects. */
  readonly total: number | null;
}

/**
 * Subscribes to the layer list AND to every streaming layer's commit counter,
 * because a commit is precisely what changes the resident count.
 *
 * The subscription selectors reduce the streams to ONE primitive each rather
 * than returning an object: Zustand re-runs them on every store notification,
 * so a fresh array or record would re-render on every commit of every layer
 * even when the sum is unchanged. `getResidentModel` is memoised inside the
 * handle on that same counter, so the merge it reads is not rebuilt per call.
 */
export function useTotalObjectCount(): TotalObjectCount {
  const layers = useLayerStore((s) => s.layers);
  const families = useFamilyStore((s) => s.layers);
  const versionSum = useStreamStore((s) => {
    let sum = 0;
    for (const entry of Object.values(s.streams)) sum += entry.version;
    return sum;
  });
  // Scoped to the layer list, not to `streams`: the stream store is not
  // cleared in the same tick a layer leaves `layers` (the viewport reconciles
  // one effect cycle later, and an undone run removes its layer without
  // closing a stream), so iterating `streams` would count a departed layer's
  // dataset in the total while `loaded` no longer counts its objects. A
  // layer whose stream is not registered yet, or whose header states no
  // object count (FlatCityBuf), makes the total unknown.
  const streamedTotal = useStreamStore((s): number | null => {
    let sum = 0;
    for (const layer of layers) {
      if (!layer.isStreaming) continue;
      // The OPENED families first: the header of a package opened with Building
      // alone already counts only that file, but the families are the app's own
      // answer and the one that survives a reopen the header has not caught up
      // with.
      const opened = openedFamilyRows(families[layer.id]);
      const count = opened ?? s.streams[layer.id]?.header.objectsCount;
      if (count === undefined) return null;
      sum += count;
    }
    return sum;
  });

  let loaded = 0;
  let staticTotal = 0;
  for (const layer of layers) {
    if (layer.isStreaming) {
      loaded += getResidentModel(layer.id, versionSum).featureCount;
    } else {
      const count = Object.keys(layer.model.objects).length;
      loaded += count;
      staticTotal += count;
    }
  }
  return {
    loaded,
    total: streamedTotal === null ? null : staticTotal + streamedTotal,
  };
}
