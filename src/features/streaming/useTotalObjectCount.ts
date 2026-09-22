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
 */
import { useLayerStore } from "../layers/layerStore";
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
  const versionSum = useStreamStore((s) => {
    let sum = 0;
    for (const entry of Object.values(s.streams)) sum += entry.version;
    return sum;
  });
  const streamedTotal = useStreamStore((s): number | null => {
    let sum = 0;
    for (const entry of Object.values(s.streams)) {
      const count = entry.header.objectsCount;
      if (count === undefined) return null;
      sum += count;
    }
    return sum;
  });

  let loaded = 0;
  let staticTotal = 0;
  let streamsKnown = streamedTotal !== null;
  const streams = useStreamStore.getState().streams;
  for (const layer of layers) {
    if (layer.isStreaming) {
      loaded += getResidentModel(layer.id, versionSum).featureCount;
      // A streaming layer whose stream is not registered yet has no header
      // to read a size from.
      if (!(layer.id in streams)) streamsKnown = false;
    } else {
      const count = Object.keys(layer.model.objects).length;
      loaded += count;
      staticTotal += count;
    }
  }
  return {
    loaded,
    total: streamsKnown ? staticTotal + (streamedTotal ?? 0) : null,
  };
}
