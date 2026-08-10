/**
 * Store -> engine reconciliation for geospatial layers.
 *
 * The `handleSync.ts` of the geo side, and split out for the same reason: the
 * decisions — add, rebuild, re-describe, delete, and in which ORDER — are pure
 * and belong in a module a test can drive with a fake view instead of a live
 * Navara. `NavaraViewport` supplies the real `view` and owns the registry.
 *
 * Three engine facts shape everything below (all audited against
 * `@navaramap/three` 0.0.5):
 *
 *  1. `Layer.update()` REPLACES the whole description. A visibility, opacity or
 *     style change therefore re-sends a description rebuilt from scratch out of
 *     the store record — never a patch, which would drop every field it
 *     omitted.
 *  2. `Source.update()` merges, but a source is where the URL, the tile bounds
 *     and the inline document live, and changing any of them resets every
 *     layer that references it anyway. A config change is answered with an
 *     honest rebuild of the pair instead.
 *  3. `Source.delete()` is REFERENCE-COUNTED: it removes nothing and answers
 *     `false` while a layer still points at the source. So the layer goes
 *     first, always — the same rule `removeSourceLayer` encodes for the
 *     backdrops in `NavaraViewport`.
 *
 * Failure policy, also inherited from the backdrops: an add the engine refuses
 * is REPORTED and answered with nothing (`console.error`, no entry in the
 * registry, no throw). One bad URL must not take the viewport down, and
 * leaving the entry absent means the next pass retries it.
 */
import type { GeoLayer } from "../features/geoLayers/geoLayerStore";
import {
  geoLayerDescription,
  geoSourceDescription,
} from "./geoLayerDescriptions";

/** The half of `Source` this module uses. `delete()` answers `false` while a
 *  layer still references the source; nothing here reads that, because the
 *  ordering below makes it impossible. */
export interface GeoSourceHandle {
  delete(): unknown;
}

/** The half of `Layer` this module uses. */
export interface GeoLayerHandle {
  update(description: Record<string, unknown>): void;
  delete(): void;
}

/** The half of `ThreeView` this module uses. */
export interface GeoLayerView {
  addSource(description: Record<string, unknown>): GeoSourceHandle;
  addLayer(description: Record<string, unknown>): GeoLayerHandle;
}

/**
 * One live source+layer pair, plus what the store record looked like when it
 * was built — so the next pass can tell a rebuild (config) from a re-describe
 * (visibility, opacity, style) from nothing at all (a rename).
 */
export interface LiveGeoLayer {
  readonly source: GeoSourceHandle;
  readonly layer: GeoLayerHandle;
  /** By IDENTITY: the store replaces this object whenever the source really
   *  changes, and never otherwise. */
  config: GeoLayer["config"];
  kind: GeoLayer["kind"];
  visible: boolean;
  opacity: number;
  /** By IDENTITY too, and for the same reason `config` is: the store replaces
   *  the whole style object on every edit, so one comparison answers "did any
   *  of the four fields change" without walking them. */
  style: GeoLayer["style"];
}

/** Take a pair back out, LAYER FIRST — see fact 3 above. Reported and
 *  swallowed: a layer that will not go away must not take the viewer with
 *  it, and the registry entry is dropped either way. */
function removePair(entry: LiveGeoLayer, name: string): void {
  try {
    entry.layer.delete();
    entry.source.delete();
  } catch (error) {
    console.error(
      `NavaraViewport: the geospatial layer "${name}" could not be removed.`,
      error,
    );
  }
}

/**
 * Add one pair, or `null`.
 *
 * `null` covers both "there is nothing to add" (a GeoJSON layer whose file did
 * not survive a reload — see `isGeoLayerUnavailable`) and "the engine refused",
 * because the caller treats them identically: no entry, no crash, retried on
 * the next pass.
 */
function addPair(view: GeoLayerView, layer: GeoLayer): LiveGeoLayer | null {
  const sourceDesc = geoSourceDescription(layer);
  if (sourceDesc === null) return null;

  let source: GeoSourceHandle | null = null;
  try {
    source = view.addSource(sourceDesc);
    const handle = view.addLayer(geoLayerDescription(layer, source));
    return {
      source,
      layer: handle,
      config: layer.config,
      kind: layer.kind,
      visible: layer.visible,
      opacity: layer.opacity,
      style: layer.style,
    };
  } catch (error) {
    console.error(
      `NavaraViewport: the geospatial layer "${layer.name}" could not be added; ` +
        "the rest of the scene is unaffected.",
      error,
    );
    // The source may already be registered — `addLayer` is the throw seen in
    // practice — and nothing else holds a reference to it, so returning here
    // without this would leak one per failed attempt.
    if (source !== null) {
      try {
        source.delete();
      } catch (deleteError) {
        console.error(
          "NavaraViewport: an orphaned geospatial source could not be deleted.",
          deleteError,
        );
      }
    }
    return null;
  }
}

/**
 * Reconcile the geo layer store against the live engine pairs, mutating
 * `live` in place.
 *
 * - records that disappeared have their pair deleted (layer, then source);
 * - a record whose `config` (or `kind`) changed has its pair REBUILT: the
 *   source carries the URL/document, and there is no honest partial update;
 * - a record whose visibility, opacity or style changed gets one
 *   `Layer.update()` with a freshly built FULL description;
 * - anything else — a rename, another layer's edit — costs one identity
 *   comparison and no engine call.
 */
export function syncGeoLayers(
  view: GeoLayerView,
  layers: readonly GeoLayer[],
  live: Map<string, LiveGeoLayer>,
): void {
  const wanted = new Set(layers.map((l) => l.id));
  for (const [id, entry] of live) {
    if (wanted.has(id)) continue;
    removePair(entry, id);
    live.delete(id);
  }

  for (const layer of layers) {
    let entry = live.get(layer.id);

    if (entry && (entry.config !== layer.config || entry.kind !== layer.kind)) {
      removePair(entry, layer.name);
      live.delete(layer.id);
      entry = undefined;
    }

    if (!entry) {
      const added = addPair(view, layer);
      // Nothing to add, or the engine refused: leave the entry absent so the
      // next pass tries again (a re-linked file is exactly that pass).
      if (added === null) continue;
      live.set(layer.id, added);
      continue;
    }

    if (
      entry.visible !== layer.visible ||
      entry.opacity !== layer.opacity ||
      entry.style !== layer.style
    ) {
      entry.visible = layer.visible;
      entry.opacity = layer.opacity;
      entry.style = layer.style;
      try {
        // The FULL description, rebuilt — `Layer.update()` replaces, it does
        // not merge.
        entry.layer.update(geoLayerDescription(layer, entry.source));
      } catch (error) {
        console.error(
          `NavaraViewport: the geospatial layer "${layer.name}" could not be updated.`,
          error,
        );
      }
    }
  }
}

/**
 * Drop every live pair — what the viewport's teardown calls.
 *
 * Separate from `syncGeoLayers(view, [], live)` because teardown happens when
 * the engine is going away, not when the store emptied: the store keeps its
 * layers across an unmount, and the next mount re-adds them from it.
 */
export function removeAllGeoLayerHandles(
  live: Map<string, LiveGeoLayer>,
): void {
  for (const [id, entry] of live) removePair(entry, id);
  live.clear();
}
