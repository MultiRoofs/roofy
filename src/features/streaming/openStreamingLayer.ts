import { type TablePresentation } from "../query/tablePresentation";
import { type AttributeOrders } from "../attributes/attributeOrder";
/**
 * Opens a `.fcb` source (URL or local `File`/`Blob`) — or a large CityParquet
 * source, in its own worker (`format: "cityparquet"`) — for viewport streaming
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
 *     four reports. The plugin owns the streaming state machine and only
 *     tells us what it did; the store mirrors what the UI reads (LodSelector,
 *     LayerPanel, StatusBar, DetailsPanel).
 *
 * The **caller must pass a `Blob`, never an `ArrayBuffer`**, for a local
 * file — the worker's `openFcb` uses `FcbReader.fromBlob` for true range
 * access; `fromBytes` copies its whole input and would OOM a multi-GB file.
 * A `File` already IS a `Blob`, so passing it straight through (as this
 * module and its callers do) satisfies that without any extra step.
 */
import type { AppearanceTheme } from "@cityjson/navara-core";
import type {
  FcbStreamLayerHandle,
  StreamSource,
  WorkerFormat,
} from "@cityjson/navara-flatcitybuf";
import { useStreamStore } from "./streamStore";
import type { StreamPlugin } from "./streamPlugin";
import { useLayerStore } from "../layers/layerStore";
import type { CityModel } from "../../domain/citymodel/types";
import type { CityModelReference } from "../../persistence/types";
import type { Rule } from "../rules/types";
import {
  effectiveRules,
  effectiveRulesEnabled,
  normalizeColorBy,
  type ColorBy,
} from "../rules/colorBy";

export interface OpenStreamingLayerInput {
  /** The live `FlatCityBufPlugin`, passed in rather than read from
   *  `streamPlugin.ts` so this stays a pure function a test can drive with a
   *  fake. Call sites resolve it with `requireStreamPlugin()`. */
  readonly plugin: StreamPlugin;
  /**
   * The layer id to open under, instead of a fresh UUID.
   *
   * Supplied by a caller that has to know the id BEFORE the open: a CityParquet
   * package registers its object families against the layer id first, so the
   * table lifecycle already knows the layer has families by the time the row
   * lands (ruling S3), and a reopen keeps the id every handle lookup, every
   * table key and every selection is addressed by.
   */
  readonly id?: string;
  /** One file (`url`/`blob`) or a CityParquet package's object tables
   *  (`urls`/`blobs`). */
  readonly source: StreamSource;
  /** Which worker reads the source. Default `"flatcitybuf"`; a large
   *  CityParquet source streams with `"cityparquet"` (`streamDecision.ts`). */
  readonly format?: WorkerFormat;
  readonly name: string;
  readonly modelRef: CityModelReference;
  readonly rules?: ReadonlyArray<Rule>;
  /** A restored "Color by" choice. Absent means DERIVED from {@link rules},
   *  the same rule `layerStore.addLayer` applies — see `rules/colorBy.ts`. */
  readonly colorBy?: ColorBy;
  readonly singleColor?: string;
  readonly unmatchedColor?: string;
  readonly visible?: boolean;
  /** First-level object groups to stream without geometry, seeded into the
   *  plugin before its first commit — a restored layer's very first fetch is
   *  then already filtered, rather than fetching what it must immediately
   *  refetch without. */
  readonly hiddenTypes?: ReadonlyArray<string>;
  readonly attributeOrders?: AttributeOrders;
  readonly tablePresentation?: TablePresentation;
  /** A restored choice. `undefined` (a fresh open) means "the first texture
   *  theme the stream reports"; `null` means plain colours, deliberately. */
  readonly selectedAppearance?: AppearanceTheme | null;
}

/**
 * How many times each layer's HANDLE has been replaced (R-E′).
 *
 * The viewport's reconciler is the reader, and it needs two things from it that
 * nothing else can tell it: a reason to RE-RUN when a handle is swapped under an
 * unchanged layer id, and a way to know that the handle it is seeing for the
 * first time is a REPLACEMENT — so the sole-layer camera fit stays off. `>0`
 * answers the second question.
 *
 * Module state, not the stream store, deliberately: a FAILED reopen leaves no
 * store entry at all, and a Retry that opened at generation 0 again would earn
 * the very fit this counter exists to suppress.
 */
const handleGenerations = new Map<string, number>();

/** The handle generation a fresh `register` for `layerId` must carry. */
function nextHandleGeneration(layerId: string): number {
  const next = (handleGenerations.get(layerId) ?? 0) + 1;
  handleGenerations.set(layerId, next);
  return next;
}

export function resetHandleGenerationsForTest(): void {
  handleGenerations.clear();
}

export async function openStreamingLayer(
  input: OpenStreamingLayerInput,
): Promise<string> {
  // Minted here, not by `addLayer`, because the plugin needs it BEFORE the
  // layer exists: `openStream` registers the handle under this id, and every
  // later lookup (`getHandle`, `remove`, a pick's `layerId`) goes through it.
  // A caller that already knows the id passes it (see {@link
  // OpenStreamingLayerInput.id}).
  const id = input.id ?? crypto.randomUUID();
  // Hoisted, not defaulted twice: the plugin seed and the store record must
  // agree by IDENTITY, or the first `syncStreamState` would see a different
  // array than the one the stream was opened with and re-bake every cell it
  // had just baked.
  const rules = input.rules ?? [];
  const colorBy = normalizeColorBy({ ...input, rules });
  // `effectiveRulesEnabled` answers "does this paint?" from the mode alone,
  // and `effectiveRules` reads the mode and the two colours — the settled
  // `colorBy` is the one answer both the plugin seed and the store record
  // draw from, so a seed built from a different answer would be an
  // equal-but-distinct array the first `syncStreamState` reads as a change.
  const styling = { rules, ...colorBy };
  const format = input.format ?? "flatcitybuf";
  const handle = await input.plugin.openStream({
    id,
    source: input.source,
    format,
    // The EFFECTIVE list, so the very first cell is baked exactly like every
    // cell that arrives after it — a rule with zero conditions colours a
    // streamed roof, which is the whole premise of "Color by".
    rules: effectiveRules(styling),
    rulesEnabled: effectiveRulesEnabled(styling),
    visible: input.visible ?? true,
    hiddenTypes: input.hiddenTypes ?? [],
    // Seeded before the first commit, so a restored textured layer's first
    // cells are already baked with images.
    appearance: input.selectedAppearance ?? null,
  });

  const model: CityModel = {
    sourceEncoding: format === "cityparquet" ? "cityparquet" : "flatcitybuf",
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
    // The layer keeps the USER's rules; the synthetic catch-alls live only
    // inside `effectiveRules` and never reach the store, the editor or a
    // snapshot.
    rules,
    ...colorBy,
    hiddenTypes: input.hiddenTypes ?? [],
    attributeOrders: input.attributeOrders,
    tablePresentation: input.tablePresentation,
    isStreaming: true,
    // A streaming layer's model is a stub, so the store cannot pick a load
    // default here; `onAppearanceThemes` below does, once themes are known.
    selectedAppearance: input.selectedAppearance ?? null,
  });
  // A fresh open (no restored choice) adopts the first texture theme the
  // stream reports, exactly as a static textured layer opens textured.
  registerStreamHandle(layerId, handle, {
    autoPicked: input.selectedAppearance !== undefined,
    // A FIRST open, which is exactly what the viewport's sole-layer camera fit
    // is for — a reopen bumps this and therefore never fits.
    generation: handleGenerations.get(layerId) ?? 0,
  });

  return layerId;
}

/**
 * Subscribe a handle's four reports and publish it under `layerId`.
 *
 * Shared by the first open and by {@link reopenStreamingLayer}, because a
 * REPLACEMENT handle has to be wired exactly like an original one: the store
 * mirrors the same four reports, and a reopen that subscribed only three would
 * leave (say) the LoD ladder frozen at the previous handle's last word.
 */
function registerStreamHandle(
  layerId: string,
  handle: FcbStreamLayerHandle,
  options: { autoPicked: boolean; generation: number },
): void {
  let autoPicked = options.autoPicked;
  // The plugin owns the streaming state machine and only REPORTS; the store
  // mirrors what the UI reads (LodSelector, LayerPanel, StatusBar, Inspector).
  // Subscribed BEFORE the register below so the four unsubscribes can be
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
    // Like the ladder, discovered rather than declared: the union only grows
    // as cells are decoded, so the type toggles fill in as the user pans.
    handle.onTypes((types) =>
      useStreamStore.getState().setTypes(layerId, types),
    ),
    handle.onAppearanceThemes((themes) => {
      useStreamStore.getState().setAppearanceThemes(layerId, themes);
      if (autoPicked) return;
      const texture = themes.find((t) => t.kind === "texture");
      if (!texture) return;
      autoPicked = true;
      const layer = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId);
      if (layer && layer.selectedAppearance === null) {
        useLayerStore.getState().setLayerAppearance(layerId, texture);
      }
    }),
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
    types: handle.typesSeen,
    typesVersion: 0,
    appearanceThemes: handle.appearanceThemes,
    status: handle.status,
    message: handle.message,
    version: handle.version,
    generation: options.generation,
  });
}

/** What a reopen did — it never throws, because a toggle is not a load. */
export type ReopenOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Replace one streaming layer's handle with a stream over a NEW source list,
 * under the same layer id (ruling R-E′).
 *
 * The transaction a family toggle runs. Three properties make it one:
 *
 *  - **`plugin.remove(layerId)`, never `handle.delete()` alone.** `delete()`
 *    frees the worker and the cell meshes but leaves the plugin's registry
 *    entry, so the `openStream` below would fail its duplicate-id check and the
 *    layer would be left with no geometry at all.
 *  - **Nothing but the stream moves.** No `layerStore` write, no `queryStore`
 *    write, no selection change and no table touched: the layer row carries the
 *    rules, the LoD, the hidden types and the camera the user arranged, and a
 *    family's table is a view over the FILE that does not care what is resident.
 *    The new stream is SEEDED from that row, so its first commit is baked
 *    exactly as the previous handle's cells were.
 *  - **A superseded completion is disposed.** `isSuperseded` is asked again once
 *    the open resolves; a handle for a layer that has gone (or for a reopen a
 *    later one replaced) is removed through the plugin rather than registered.
 *
 * Serialisation is the CALLER's (`familyStore`'s per-layer queue): this function
 * runs one transaction and says how it went.
 */
export async function reopenStreamingLayer(
  plugin: StreamPlugin,
  layerId: string,
  source: StreamSource,
  options: {
    /** Asked twice — before the open and after it resolves. */
    readonly isSuperseded?: () => boolean;
  } = {},
): Promise<ReopenOutcome> {
  const isSuperseded = options.isSuperseded ?? (() => false);
  const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
  if (!layer) {
    return { ok: false, message: "That layer is no longer open." };
  }
  if (isSuperseded()) {
    return { ok: false, message: SUPERSEDED_MESSAGE };
  }

  // The OLD stream goes first and completely: its store closures are
  // unsubscribed (a handle's listener sets survive `delete()`), its worker and
  // cell meshes go through the plugin, and the store entry is cleared so a
  // report still in flight lands on nothing rather than on the wrong handle.
  const previous = useStreamStore.getState().streams[layerId];
  if (previous) {
    for (const off of previous.disposers) off();
  }
  plugin.remove(layerId);
  useStreamStore.getState().unregister(layerId);

  const generation = nextHandleGeneration(layerId);
  let handle: FcbStreamLayerHandle;
  try {
    handle = await plugin.openStream({
      id: layerId,
      source,
      // A reopen is only ever a CityParquet family change; a `.fcb` has one
      // file and no families to toggle.
      format: "cityparquet",
      // From the ROW, so the reopened stream paints and hides exactly what the
      // layer was showing. `effectiveRules` compiles the same catch-alls the
      // static path does, which is what makes a "Color by" choice survive.
      rules: effectiveRules(layer),
      rulesEnabled: effectiveRulesEnabled(layer),
      visible: layer.visible,
      hiddenTypes: layer.hiddenTypes,
      appearance: layer.selectedAppearance,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The layer's object families could not be reopened.",
    };
  }

  // Asked AGAIN: the open is a worker boot and a header read, and a layer can be
  // removed inside it. Registering here would publish a handle for a row that
  // has gone, and the viewport's own sweep would then be the only thing that
  // could stop its worker.
  if (
    isSuperseded() ||
    !useLayerStore.getState().layers.some((l) => l.id === layerId)
  ) {
    plugin.remove(layerId);
    return { ok: false, message: SUPERSEDED_MESSAGE };
  }

  registerStreamHandle(layerId, handle, {
    // The row already HAS an appearance answer (it opened with one, or the user
    // chose one); a reopen must not re-pick the first texture theme the new
    // stream happens to report.
    autoPicked: true,
    generation,
  });
  return { ok: true };
}

const SUPERSEDED_MESSAGE =
  "The layer's object families changed again before this reopen finished.";

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
  // The layer is gone for good (ids are fresh UUIDs), so its handle generation
  // has nothing left to count.
  handleGenerations.delete(layerId);
}

/** Every streaming layer at once, for "close the project" / "restore a
 *  snapshot over the top". Iterates a snapshot of the ids, since each close
 *  mutates the map it would otherwise be read from. */
export function closeAllStreamingLayers(plugin: StreamPlugin | null): void {
  for (const layerId of Object.keys(useStreamStore.getState().streams)) {
    closeStreamingLayer(plugin, layerId);
  }
}
