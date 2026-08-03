/**
 * Opens a `.fcb` source (URL or local `File`/`Blob`) for viewport streaming
 * and registers it with the two stores the UI reads.
 *
 * Everything that used to happen here — spinning up a `WorkerClient`, the
 * `open` round trip, admission, the grid, the cell cache, the CRS gate, the
 * vertical datum — now happens inside `FlatCityBufPlugin.openStream`, which
 * resolves a `FcbStreamLayerHandle` that owns all of it. What is left is
 * exactly the app-side half:
 *
 *  1. Ask the plugin to open the source. It throws on a worker error, an
 *     admission refusal, a missing extent or an unusable CRS, terminating its
 *     own worker on the way out — the same "throws, caller catches and shows
 *     it" contract `loadFromUrl`/`parseText` use, so callers need no second
 *     error-handling shape for streaming vs. non-streaming layers.
 *  2. Register a `Layer` whose `model` is a stub (bbox from the header,
 *     `objects: {}` — see `streamStore.ts`'s doc comment for why a streaming
 *     layer's model is intentionally never materialized) under the SAME id
 *     the plugin knows the layer by, so `plugin.getHandle(layerId)` works and
 *     removal needs no second mapping.
 *  3. Register the `StreamState` and subscribe the store to the handle's
 *     three reports. The plugin owns the streaming state machine and only
 *     tells us what it did; the store mirrors what the UI reads (LodSelector,
 *     LayerPanel, StatusBar, InspectorPanel).
 *
 * The **caller must pass a `Blob`, never an `ArrayBuffer`**, for a local
 * file — the worker's `openFcb` uses `FcbReader.fromBlob` for true range
 * access; `fromBytes` copies its whole input and would OOM a multi-GB file.
 * A `File` already IS a `Blob`, so passing it straight through (as this
 * module and its callers do) satisfies that without any extra step.
 */
import { useStreamStore } from "./streamStore";
import type { StreamPlugin } from "./streamPlugin";
import { useLayerStore } from "../layers/layerStore";
import type { CityModel } from "../../domain/citymodel/types";
import type { CityModelReference } from "../../persistence/types";
import type { Rule } from "../rules/types";

export interface OpenStreamingLayerInput {
  /** The live `FlatCityBufPlugin`, passed in rather than read from
   *  `streamPlugin.ts` so this stays a pure function a test can drive with a
   *  fake. Call sites resolve it with `requireStreamPlugin()`. */
  readonly plugin: StreamPlugin;
  readonly source: { readonly url: string } | { readonly blob: Blob };
  readonly name: string;
  readonly modelRef: CityModelReference;
  readonly rules?: ReadonlyArray<Rule>;
  readonly rulesEnabled?: boolean;
  readonly visible?: boolean;
}

export async function openStreamingLayer(
  input: OpenStreamingLayerInput,
): Promise<string> {
  // Minted here, not by `addLayer`, because the plugin needs it BEFORE the
  // layer exists: `openStream` registers the handle under this id, and every
  // later lookup (`getHandle`, `remove`, a pick's `layerId`) goes through it.
  const id = crypto.randomUUID();
  const handle = await input.plugin.openStream({
    id,
    source: input.source,
    rules: input.rules ?? [],
    rulesEnabled: input.rulesEnabled ?? true,
    visible: input.visible ?? true,
  });

  const model: CityModel = {
    sourceEncoding: "flatcitybuf",
    metadata: { referenceSystem: handle.header.referenceSystem },
    bbox: handle.header.extent ?? null,
    objects: {},
    vertexCount: 0,
  };

  const layerId = useLayerStore.getState().addLayer({
    id,
    name: input.name,
    model,
    modelRef: input.modelRef,
    visible: input.visible ?? true,
    rules: input.rules ?? [],
    rulesEnabled: input.rulesEnabled ?? true,
    isStreaming: true,
  });

  // The plugin owns the streaming state machine and only REPORTS; the store
  // mirrors what the UI reads (LodSelector, LayerPanel, StatusBar, Inspector).
  // Subscribed BEFORE the register below so the three unsubscribes can be
  // stored with the entry — `handle.delete()` does not clear the handle's
  // listener sets, so `closeStreamingLayer` is the only thing that can
  // (streamStore.ts -> `StreamState.disposers`). A report that fired between
  // here and the register would find no entry and be dropped, which is the
  // same no-op every one of these actions already is for an unknown layer id.
  const disposers = [
    handle.onStatus((status, message) =>
      useStreamStore.getState().setStatus(layerId, status, message),
    ),
    handle.onLadder((ladder) =>
      useStreamStore.getState().setLadder(layerId, ladder),
    ),
    handle.onCommit(() => {
      const store = useStreamStore.getState();
      // Level first: `LodSelector` reads it alongside the ladder, and updating
      // it after the version bump would render one frame of the new commit's
      // cell count against the old commit's cell size.
      store.setLevel(layerId, handle.level);
      store.bumpVersion(layerId);
    }),
  ];

  // Seeded from the handle's CURRENT values rather than from constants,
  // because `openStream` already commits the layer once before it resolves:
  // by the time we get here the first cells may be resident, and hard-coding
  // "idle" / level null / version 0 would publish a state the handle has
  // already moved past — with no further event to correct it until the user
  // pans. Reading them and subscribing below are consecutive SYNCHRONOUS
  // statements, so there is no window in which a report can fall between the
  // two and be lost.
  useStreamStore.getState().register(layerId, {
    handle,
    disposers,
    grid: handle.grid,
    header: handle.header,
    level: handle.level,
    ladder: handle.ladder,
    ladderVersion: 0,
    status: handle.status,
    message: handle.message,
    version: handle.version,
  });

  return layerId;
}

/**
 * Tear a streaming layer down: stop its worker, drop its cell meshes, forget
 * its store entry.
 *
 * Split from `useLayerStore.removeLayer` deliberately — the layer store is a
 * plain data store with no engine knowledge, and a streaming layer's real
 * resources (a worker thread, GPU meshes) belong to the plugin. A layer id
 * with no stream registered is ignored, so a caller removing layers in bulk
 * need not know which of them were streaming.
 */
export function closeStreamingLayer(
  plugin: StreamPlugin | null,
  layerId: string,
): void {
  const entry = useStreamStore.getState().streams[layerId];
  if (!entry) return;

  // Listeners first: `handle.delete()` does not clear the handle's listener
  // sets, so a store closure left subscribed stays reachable from the handle
  // for as long as anything holds it (`NavaraViewport`'s `streamsRef` does).
  for (const off of entry.disposers) off();

  // Resources BEFORE the store entry, so a plugin-less close (the engine is
  // already gone) cannot drop the only reference to a live worker. `remove` is
  // what calls `handle.delete()`, and it also drops the layer from the
  // plugin's settle loop — calling `handle.delete()` directly would leave a
  // dead layer being committed on every camera settle, so it is the FALLBACK
  // for "there is no plugin any more", not the normal path.
  if (plugin) plugin.remove(layerId);
  else entry.handle.delete();

  useStreamStore.getState().unregister(layerId);
}

/** Every streaming layer at once, for "close the project" / "restore a
 *  snapshot over the top". Iterates a snapshot of the ids, since each close
 *  mutates the map it would otherwise be read from. */
export function closeAllStreamingLayers(plugin: StreamPlugin | null): void {
  for (const layerId of Object.keys(useStreamStore.getState().streams)) {
    closeStreamingLayer(plugin, layerId);
  }
}
