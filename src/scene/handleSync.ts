/**
 * Pure store -> engine reconciliation for static city model layers.
 *
 * Kept out of NavaraViewport so the add/remove/visible/LoD decisions are
 * testable against a mock handle (the R3F version of this logic lived inside
 * a 150-line useEffect and was only reachable through test-only exports).
 * `syncLayers` skips streaming layers — @cityjson/navara-flatcitybuf creates
 * and owns their meshes from M7.5 on. They are NOT absent from the app,
 * though: `interactionHandles`/`totalTriangles`/`syncHighlight` take a second
 * registry so picking, highlighting, fit and the triangle readout cover
 * streamed cells too (Shared Interface Contract -> Interaction registries).
 *
 * Engine-free by construction: every import here is `import type`, and the
 * runtime-free `@cityjson/navara-cityjson` barrel never reaches an
 * `@navaramap/*` module (NODE_IMPORT_SAFE = false — see Global Constraints).
 */
import type {
  CityModelHandle,
  GeodeticBounds,
  PickedFeatureLike,
  ScreenPoint,
  Selection,
} from "@cityjson/navara-cityjson";
import type { Layer } from "../features/layers/layerStore";

/** What the app remembers about a live static handle, so the next sync can
 *  tell an actual change from a re-render. */
export interface LiveLayer {
  readonly handle: CityModelHandle;
  lod: string | null;
  visible: boolean;
}

/**
 * The two operations `syncLayers` needs from the CityJSON plugin's registry.
 * `add` is the app's binding over `CityJSONPlugin.addCityModel(model, opts)`
 * (Task B7): it creates the handle already filtered to `layer.selectedLod`,
 * which is why the add path below records the LoD without calling `setLod`.
 * Declared structurally so this module — and its tests — stay engine-free.
 */
export interface CityModelRegistry {
  get(id: string): CityModelHandle | undefined;
  add(layer: Layer): CityModelHandle;
}

/**
 * Reconcile the layer store against the live static handles, mutating `live`
 * in place.
 *
 * - layers that disappeared (or became streaming) have their handle deleted;
 * - new static layers are added, and an add failure — the CRS gate throws
 *   `CrsUnresolvedError`/`NonMetricCrsError` for a layer we cannot
 *   georeference — is reported through `onError` and skipped, never thrown,
 *   so one bad layer cannot take the whole scene down. The entry is left
 *   absent, so a later sync retries it;
 * - visibility and LoD are pushed only when they actually changed. A LoD
 *   change is `handle.setLod`, which rebuilds the geometry in place — the
 *   handle (and therefore its mesh registration, style and highlight) is
 *   never recreated.
 */
export function syncLayers(
  registry: CityModelRegistry,
  layers: readonly Layer[],
  live: Map<string, LiveLayer>,
  onError: (layerId: string, error: unknown) => void,
): void {
  const wanted = new Set(layers.filter((l) => !l.isStreaming).map((l) => l.id));

  for (const [id, entry] of live) {
    if (wanted.has(id)) continue;
    entry.handle.delete();
    live.delete(id);
  }

  for (const layer of layers) {
    if (layer.isStreaming) continue;

    let entry = live.get(layer.id);
    if (!entry) {
      try {
        const handle = registry.add(layer);
        entry = {
          handle,
          lod: layer.selectedLod,
          visible: layer.visible,
        };
        live.set(layer.id, entry);
        handle.setVisible(layer.visible);
      } catch (e) {
        onError(layer.id, e);
        continue;
      }
    }

    if (entry.lod !== layer.selectedLod) {
      entry.lod = layer.selectedLod;
      entry.handle.setLod(layer.selectedLod);
    }
    if (entry.visible !== layer.visible) {
      entry.visible = layer.visible;
      entry.handle.setVisible(layer.visible);
    }
  }
}

/** The interaction surface static and streaming layers share. Only *styling*
 *  differs between them (Shared Interface Contract -> Streaming styling:
 *  streaming colors are worker-baked, so a SurfaceStyleEvaluator must never
 *  be routed to a streaming handle). */
export interface InteractionHandle {
  readonly id: string;
  setHighlight(sel: readonly Selection[], hovered?: Selection): void;
  /** Accepts either a screen point (own-raycast path) or an engine
   *  PickedFeature (pickable-wrapper path); both plugins' handles do. */
  resolvePick(pick: ScreenPoint | PickedFeatureLike): Selection | null;
  getBoundsGeodetic(): GeodeticBounds | null;
  triangleCount(): number;
}

const NO_STREAMS: ReadonlyMap<string, InteractionHandle> = new Map();

/** Visible layers' interaction handles, in layer order — static from `live`,
 *  streaming from `streams`. One registry, so picking, highlighting, fit and
 *  the triangle readout can never disagree about which layers exist. */
export function interactionHandles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle> = NO_STREAMS,
): readonly InteractionHandle[] {
  const out: InteractionHandle[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    // No cast: this is where the compiler checks that a static
    // `CityModelHandle` really does satisfy `InteractionHandle`.
    const handle = live.get(layer.id)?.handle ?? streams.get(layer.id);
    if (handle) out.push(handle);
  }
  return out;
}

export function totalTriangles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle> = NO_STREAMS,
): number {
  let total = 0;
  for (const handle of interactionHandles(layers, live, streams)) {
    total += handle.triangleCount();
  }
  return total;
}

/**
 * Push the current selection/hover to every handle in one pass.
 *
 * The whole selection array goes to every handle unfiltered: each handle
 * already keeps only the entries whose `layerId` is its own (`CityModelMesh`
 * -> `setHighlight`), so a handle that owns nothing in the selection clears
 * itself — which is exactly what a deselect has to do.
 */
export function syncHighlight(
  handles: readonly InteractionHandle[],
  selections: readonly Selection[],
  hovered?: Selection | null,
): void {
  for (const handle of handles) {
    handle.setHighlight(selections, hovered ?? undefined);
  }
}
