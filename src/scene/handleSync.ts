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
 * Engine-free by construction: the only runtime import is
 * `compileRuleEvaluator` (pure, `@cityjson/navara-core` underneath);
 * everything else is `import type`, and the runtime-free
 * `@cityjson/navara-cityjson` barrel never reaches an `@navaramap/*` module
 * (NODE_IMPORT_SAFE = false — see Global Constraints).
 */
import type {
  CityModelHandle,
  GeodeticBounds,
  PickedFeatureLike,
  ScreenPoint,
  Selection,
} from "@cityjson/navara-cityjson";
import type { Rule } from "../features/rules/types";
import type { Layer } from "../features/layers/layerStore";
import { compileRuleEvaluator } from "./applyRuleColors";

/** What the app remembers about a live static handle, so the next sync can
 *  tell an actual change from a re-render. */
export interface LiveLayer {
  readonly handle: CityModelHandle;
  lod: string | null;
  visible: boolean;
  /** The `rules` array last compiled into `handle.setStyle`, by IDENTITY —
   *  `undefined` means "this handle has never been styled". `layerStore`
   *  replaces the array on every rule edit, so reference equality is an exact
   *  "did the rules change?" test and costs nothing per frame. */
  styledRules?: ReadonlyArray<Rule>;
  /** The `rulesEnabled` flag that went with {@link styledRules}. */
  styledRulesEnabled?: boolean;
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

/**
 * Push each static layer's rules to its handle as a `SurfaceStyleEvaluator`
 * (spec 5's `ruleStore-per-layer --compile--> SurfaceStyleEvaluator -->
 * handle.setStyle` edge, Task B14).
 *
 * Separate from {@link syncLayers} because styling and existence change on
 * different beats: a rule edit must recolor without touching visibility, LoD
 * or the fit token, and an added layer must be styled only after its handle
 * exists. Call it right after `syncLayers`.
 *
 * Memoised on `(rules identity, rulesEnabled)`: `handle.setStyle` repaints
 * every vertex of the layer, so pushing on an unrelated store change (another
 * layer's visibility toggle, a selection) would be a full recolor per
 * keystroke.
 *
 * Two deliberate skips:
 * - **streaming layers** — their colors are baked in the FCB worker from the
 *   `Rule[]` wire payload, and a `SurfaceStyleEvaluator` must never reach a
 *   streaming handle (Shared Interface Contract -> Streaming styling). Task
 *   C13 gives them `setRules(rules, enabled)` instead;
 * - **the first push when nothing would be painted** — a layer with no rules
 *   (or `rulesEnabled: false`) leaves a freshly added handle untouched
 *   instead of calling `setStyle(null)` on a mesh that is already unstyled.
 *   The equivalent of the old `hasRules ? buildRuleColors(...) : null`.
 */
export function syncStyles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
): void {
  for (const layer of layers) {
    if (layer.isStreaming) continue;
    const entry = live.get(layer.id);
    // No entry means the add was refused (CRS gate) or has not happened yet;
    // when it does, `styledRules` is undefined on the new entry and the style
    // is pushed then.
    if (!entry) continue;
    if (
      entry.styledRules === layer.rules &&
      entry.styledRulesEnabled === layer.rulesEnabled
    ) {
      continue;
    }

    const neverStyled = entry.styledRules === undefined;
    entry.styledRules = layer.rules;
    entry.styledRulesEnabled = layer.rulesEnabled;

    const evaluator = compileRuleEvaluator(layer.rules, layer.rulesEnabled);
    if (evaluator === null && neverStyled) continue;
    entry.handle.setStyle(evaluator);
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
