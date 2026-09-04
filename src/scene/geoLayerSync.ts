/**
 * Store -> engine reconciliation for geospatial layers.
 *
 * The `handleSync.ts` of the geo side, and split out for the same reason: the
 * decisions — add, rebuild, re-describe, delete, and in which ORDER — are pure
 * and belong in a module a test can drive with a fake view instead of a live
 * Navara. `NavaraViewport` supplies the real `view` and owns the registry.
 *
 * Three engine facts shape everything below (audited against `@navaramap/three`
 * 0.0.5 and re-checked unchanged on 0.1.1):
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
import { styleColorNumber } from "../features/geoLayers/geoLayerStyle";
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

/**
 * The half of the engine's `FeatureEvaluator` this module uses.
 *
 * The contract that shapes every call below (`@navaramap/three` 0.0.5's d.ts,
 * `FeatureEvaluator.evaluate`): the callback runs per feature batch and the
 * fields it returns OVERRIDE the layer's own defaults. Crucially an OMITTED
 * field does NOT reset a previous override — the d.ts spells it out for
 * `image` ("omit the key to leave it unchanged") and the same applies to every
 * key — so clearing a highlight means returning the layer's own colour
 * explicitly, never `{}`.
 */
export interface GeoFeatureEvaluator {
  evaluate(
    cb: (info: { readonly batchId: number }) => Record<string, unknown>,
  ): void;
}

/** The half of `Layer` this module uses. */
export interface GeoLayerHandle {
  update(description: Record<string, unknown>): void;
  delete(): void;
  /** The engine layer id (`Layer.id`), which a pick result carries and
   *  {@link geoLayerIdForEngineLayerId} maps back to a store record. Optional
   *  because nothing here needs it to run. */
  readonly id?: unknown;
  /** Engine `Layer.on`. A vector layer creates one feature set PER MATERIAL
   *  (point / polyline / polygon), each with its own evaluator and
   *  `featureSetId`, so a mixed-geometry GeoJSON fires this several times —
   *  and features are (re)created on `update()` too, which is why the
   *  subscription lives on the handle and is installed once, in `addPair`. */
  on?(
    type: "featureCreated" | "featureUpdated",
    cb: (params: {
      readonly featureSetId?: unknown;
      readonly evaluator: GeoFeatureEvaluator;
    }) => void,
  ): void;
  /** Engine `Layer.forceUpdate` — asks for one re-evaluation pass. */
  forceUpdate?(): void;
}

/**
 * The accent a picked geospatial feature is drawn in — the SAME orange the
 * city meshes highlight a selected surface with
 * (`HIGHLIGHT_COLOR_HEX` in `navara-cityjson/src/surfaceColorLayers.ts`).
 * Deliberately shared: a user selects a building and a GeoJSON polygon in the
 * same viewport, and two different "this is selected" colours would read as two
 * different states.
 */
export const GEO_HIGHLIGHT_COLOR_HEX = 0xe8973f;

/** Engine `Color` factory. `EvaluatedValue.color` must be a `Color` INSTANCE
 *  and this module is engine-free, so the viewport passes the constructor in
 *  (`(hex) => new Color().setHex(hex)`). */
type GeoColorFactory = (hex: number) => unknown;

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
  /** The record's human name AS IT WAS when the pair was added — what the
   *  highlight failures are reported against. Not the store UUID: every other
   *  engine-failure message here names the layer the user can see, and the
   *  highlight path has no record in hand to read it from. Captured, not kept
   *  current, exactly like the name the feature-set subscription closes over;
   *  a rename between the add and a failure is a stale word in a console
   *  message, not a wrong layer. */
  readonly name: string;
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
  /** One evaluator per feature set, keyed by `featureSetId` (or by the
   *  evaluator itself when the engine sends none) — a vector layer makes one
   *  per material, and a highlight has to reach all of them. */
  evaluators: Map<unknown, GeoFeatureEvaluator>;
  /** The DESIRED highlight, kept on the entry so a feature set created later
   *  (an `update()` recreates them) can be brought up to date immediately. */
  highlightedBatchId: number | null;
  /** Whether this layer ever carried an evaluated colour. A layer that never
   *  did is never touched on a clear: an evaluated colour OVERRIDES the layer
   *  default, so writing one would shadow every future style edit. */
  hadHighlight: boolean;
  /** The `Color` factory from the last {@link syncGeoHighlight} pass, kept so
   *  the feature-set subscription can re-apply a live highlight on its own.
   *  Per ENTRY rather than module-global: a factory belongs to a view's
   *  lifetime, and the entries die with the view. */
  colorFactory: GeoColorFactory | null;
}

/**
 * Push the desired highlight into ONE evaluator.
 *
 * The else-branch returns the layer's own colour rather than omitting `color`,
 * because an omitted key leaves a previous override in place — see
 * {@link GeoFeatureEvaluator}. `entry.highlightedBatchId` is read inside the
 * callback, not captured, so an evaluation the engine re-runs later still
 * answers the current state.
 */
function evaluateHighlight(
  entry: LiveGeoLayer,
  evaluator: GeoFeatureEvaluator,
  highlight: unknown,
  base: unknown,
): void {
  evaluator.evaluate((info) => ({
    color: info.batchId === entry.highlightedBatchId ? highlight : base,
  }));
}

/**
 * Re-evaluate every feature set of one layer against `entry.highlightedBatchId`
 * and ask for one update.
 *
 * Skipped entirely for a layer that is not highlighted and never was — see
 * `hadHighlight`. Reported and swallowed like every other engine call here.
 */
function applyHighlight(
  entry: LiveGeoLayer,
  name: string,
  makeColor: GeoColorFactory,
  highlight: () => unknown,
): void {
  if (entry.highlightedBatchId === null && !entry.hadHighlight) return;
  if (entry.highlightedBatchId !== null) entry.hadHighlight = true;
  try {
    const base = makeColor(styleColorNumber(entry.style));
    const accent = highlight();
    for (const evaluator of entry.evaluators.values()) {
      evaluateHighlight(entry, evaluator, accent, base);
    }
    entry.layer.forceUpdate?.();
  } catch (error) {
    console.error(
      `NavaraViewport: the geospatial layer "${name}" could not be highlighted.`,
      error,
    );
  }
}

/**
 * Which store record a picked engine layer belongs to, or `null`.
 *
 * `===` against the handle's own `id`; a handle that carries none never
 * matches, not even an `undefined` argument — "no id" is not an identity.
 */
export function geoLayerIdForEngineLayerId(
  live: Map<string, LiveGeoLayer>,
  engineLayerId: unknown,
): string | null {
  // The one comparison `===` gets wrong for this purpose: a handle carrying no
  // id would match an argument that is equally absent.
  if (engineLayerId === undefined) return null;
  for (const [id, entry] of live) {
    if (entry.layer.id === engineLayerId) return id;
  }
  return null;
}

/**
 * Reconcile the picked feature against the live pairs: at most one layer holds
 * a highlight, and the rest are cleared back to their own colour.
 *
 * An entry whose desired state already matches costs no engine call — which is
 * what keeps a re-render, or a selection in another layer, from re-evaluating
 * every feature in the scene.
 */
export function syncGeoHighlight(
  selection: { readonly geoLayerId: string; readonly batchId: number } | null,
  live: Map<string, LiveGeoLayer>,
  makeColor: GeoColorFactory,
): void {
  // Made at most once per pass, and only if something really changed: the
  // factory belongs to the view, the VALUE does not outlive this call.
  let highlight: unknown;
  let made = false;
  const highlightColor = (): unknown => {
    if (!made) {
      highlight = makeColor(GEO_HIGHLIGHT_COLOR_HEX);
      made = true;
    }
    return highlight;
  };

  for (const [id, entry] of live) {
    // Kept current even for an entry nothing changed about: the feature-set
    // subscription re-applies through it, whenever the engine gets round to
    // recreating features.
    entry.colorFactory = makeColor;
    const desired =
      selection !== null && selection.geoLayerId === id
        ? selection.batchId
        : null;
    if (desired === entry.highlightedBatchId) continue;
    entry.highlightedBatchId = desired;
    // The layer's NAME, not the store id `id`: the same identity every other
    // engine-failure message in this module reports, and the same one the
    // feature-set subscription's own highlight failure uses.
    applyHighlight(entry, entry.name, makeColor, highlightColor);
  }
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
    const entry: LiveGeoLayer = {
      source,
      layer: handle,
      name: layer.name,
      config: layer.config,
      kind: layer.kind,
      visible: layer.visible,
      opacity: layer.opacity,
      style: layer.style,
      evaluators: new Map(),
      highlightedBatchId: null,
      hadHighlight: false,
      colorFactory: null,
    };

    // One subscription per PAIR, for the lifetime of the pair: the engine
    // creates a feature set per material and recreates them on `update()`, so
    // this fires several times and again after every re-describe. A fresh
    // feature set carries no stale override, so a live highlight is pushed
    // into it and nothing needs clearing.
    const remember = (params: {
      readonly featureSetId?: unknown;
      readonly evaluator: GeoFeatureEvaluator;
    }): void => {
      const { evaluator } = params;
      if (evaluator === undefined || evaluator === null) return;
      entry.evaluators.set(params.featureSetId ?? evaluator, evaluator);
      if (entry.highlightedBatchId === null || entry.colorFactory === null) {
        return;
      }
      const makeColor = entry.colorFactory;
      try {
        evaluateHighlight(
          entry,
          evaluator,
          makeColor(GEO_HIGHLIGHT_COLOR_HEX),
          makeColor(styleColorNumber(entry.style)),
        );
        entry.layer.forceUpdate?.();
      } catch (error) {
        console.error(
          `NavaraViewport: the geospatial layer "${entry.name}" could not be highlighted.`,
          error,
        );
      }
    };
    handle.on?.("featureCreated", remember);
    handle.on?.("featureUpdated", remember);

    return entry;
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
