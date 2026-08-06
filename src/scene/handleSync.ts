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
 * `compileRuleEvaluator` (pure, from `@cityjson/navara-core`);
 * everything else is `import type`, and the runtime-free
 * `@cityjson/navara-cityjson` barrel never reaches an `@navaramap/*` module
 * (NODE_IMPORT_SAFE = false — see Global Constraints).
 */
import { compileRuleEvaluator } from "@cityjson/navara-core";
import type {
  CityModelHandle,
  EcefRay,
  GeodeticBounds,
  PickedFeatureLike,
  RaycastHit,
  ScreenPoint,
  Selection,
  ThemeStyle,
} from "@cityjson/navara-cityjson";
import type { QueryRegion } from "@cityjson/navara-flatcitybuf";
import type { Rule } from "../features/rules/types";
import type { Layer } from "../features/layers/layerStore";

/** What the app remembers about a live static handle, so the next sync can
 *  tell an actual change from a re-render. */
export interface LiveLayer {
  readonly handle: CityModelHandle;
  lod: string | null;
  visible: boolean;
  /** The `hiddenTypes` array last pushed, by IDENTITY — `layerStore` replaces
   *  it on every edit. Recorded (not pushed) on the add path: `registry.add`
   *  passes it to `addCityModel`, so a new handle is built filtered. */
  hiddenTypes: ReadonlyArray<string>;
  /** The `rules` array last compiled into `handle.setStyle`, by IDENTITY —
   *  `undefined` means "this handle has never been styled". `layerStore`
   *  replaces the array on every rule edit, so reference equality is an exact
   *  "did the rules change?" test and costs nothing per frame. */
  styledRules?: ReadonlyArray<Rule>;
  /** The `rulesEnabled` flag that went with {@link styledRules}. */
  styledRulesEnabled?: boolean;
  /** The scene theme's `ThemeStyle` last pushed, by IDENTITY —
   *  `sceneThemePolicy` hands out one frozen object per theme, so reference
   *  equality is an exact "did the theme change?" test. `undefined` means this
   *  handle has never been themed, which is also the mesh's own initial state
   *  (`DEFAULT_THEME_STYLE`). Pushing is NOT cheap: `setThemeStyle` re-extracts
   *  every structural edge of the layer. */
  themeStyle?: ThemeStyle;
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
 * - visibility, LoD and hidden object types are pushed only when they actually
 *   changed. A LoD or hidden-types change is `handle.setLod`/`setHiddenTypes`,
 *   which rebuilds the geometry in place — the handle (and therefore its mesh
 *   registration, style and highlight) is never recreated;
 * - the active scene theme's mesh style is pushed on the same beat, so a layer
 *   added while a theme is on comes up themed rather than photoreal for a
 *   frame. See {@link LiveLayer.themeStyle} for why it is compared by identity.
 *
 * `themeStyle` is optional and `undefined` means "this caller has no theme to
 * push" — which is what photoreal amounts to for a handle that has never been
 * themed, and what keeps a caller that does not care about themes (a test, a
 * one-shot resync) from having to invent one. `NavaraViewport` always passes
 * the active policy's style.
 */
export function syncLayers(
  registry: CityModelRegistry,
  layers: readonly Layer[],
  live: Map<string, LiveLayer>,
  onError: (layerId: string, error: unknown) => void,
  themeStyle?: ThemeStyle,
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
          hiddenTypes: layer.hiddenTypes,
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
    if (entry.hiddenTypes !== layer.hiddenTypes) {
      entry.hiddenTypes = layer.hiddenTypes;
      entry.handle.setHiddenTypes(layer.hiddenTypes);
    }
    if (themeStyle !== undefined && entry.themeStyle !== themeStyle) {
      entry.themeStyle = themeStyle;
      entry.handle.setThemeStyle(themeStyle);
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
  /** The raw form of the same path: distance included, so the router can pick
   *  the NEAREST hit across layers instead of the first layer that answers. */
  resolveRaycast(ray: EcefRay): RaycastHit | null;
  getBoundsGeodetic(): GeodeticBounds | null;
  triangleCount(): number;
  /** Metres of geoid undulation baked into this layer's placement, for turning
   *  an ellipsoidal height back into the source file's orthometric z. Both
   *  handle kinds publish it (Task C13 added the streaming one, whose cells are
   *  placed with exactly this offset); optional only so a hand-rolled or future
   *  handle need not, in which case it reads as 0. */
  heightOffset?(): number;
}

/**
 * A streaming layer's handle: everything an {@link InteractionHandle} does,
 * plus the three per-layer setters that replace `syncLayers`/`syncStyles` for
 * a layer whose meshes the FlatCityBuf plugin owns.
 *
 * `setRules` is the whole of the difference between the two layer kinds:
 * streaming colors are baked in the worker from the `Rule[]` wire payload, so
 * a compiled `SurfaceStyleEvaluator` must never reach one (Shared Interface
 * Contract -> Streaming styling). Everything else — highlight, pick, fit,
 * triangles — goes through the shared registry above.
 *
 * Structural, like every other type in this module, so it stays engine-free
 * and its tests need no plugin.
 */
export interface StreamInteractionHandle extends InteractionHandle {
  setRules(rules: ReadonlyArray<Rule>, enabled: boolean): void;
  setLod(mode: "auto" | "manual", lod: string | null): void;
  setVisible(visible: boolean): void;
  /** Whether the layer re-queries its source as the camera settles. See
   *  `Layer.cameraSync`. */
  setCameraSync(enabled: boolean): void;
  /** The scene theme's presentation style. Stored by the handle and applied to
   *  every resident cell AND to each cell installed later, which is what makes
   *  a stream that keeps arriving stay in the theme it was opened in. */
  setThemeStyle(style: ThemeStyle): void;
  /** First-level object groups to stream without geometry. Forces a commit,
   *  so every affected cell is refetched — the same cost as a LoD change. */
  setHiddenTypes(types: ReadonlyArray<string>): void;
  /** Fires after each cell commit; returns its own unsubscribe. Cells arrive
   *  long after any store change, so this — not a React dependency — is what
   *  tells the app to re-count triangles and re-apply the highlight. */
  onCommit(cb: (version: number) => void): () => void;
  /**
   * The ground rectangle the layer's last DISPATCHED fetch queried, and an
   * event that republishes it — the diagnostic seam behind the streaming
   * fetch-bbox outline.
   *
   * Deliberately not derivable app-side: the region is the plugin's own
   * `viewportFootprint` result, the very value its `probe`/`fetch` messages
   * carry, so re-deriving it here from the camera would be a second
   * computation free to disagree with the one that actually fetched. Declared
   * on this structural interface (rather than reached for on the concrete
   * handle) so the compiler checks the plugin still provides it.
   */
  lastQueryRegion(): QueryRegion | null;
  onQueryRegion(cb: (region: QueryRegion | null) => void): () => void;
}

/** What one streaming handle was last told, so an unrelated store change does
 *  not re-push. Keyed by layer id and carrying the handle IDENTITY, so a layer
 *  that was closed and re-opened is pushed to afresh. Every field is
 *  `undefined` until its first push, which is what makes that first pass
 *  unconditional without a separate flag. */
export interface StreamSyncMemo {
  readonly handle: StreamInteractionHandle;
  rules?: ReadonlyArray<Rule>;
  rulesEnabled?: boolean;
  visible?: boolean;
  lodMode?: "auto" | "manual";
  selectedLod?: string | null;
  cameraSync?: boolean;
  hiddenTypes?: ReadonlyArray<string>;
  /** The scene theme's style last pushed, by identity — see
   *  {@link LiveLayer.themeStyle}. */
  themeStyle?: ThemeStyle;
}

/**
 * Push one streaming layer's rules, LoD, visibility, camera sync and hidden
 * object types to its handle — the streaming counterpart of `syncLayers` +
 * `syncStyles`, which both skip these layers by design.
 *
 * Memoised on the values actually pushed, because none of them is free:
 * `setRules` re-bakes every resident cell in the worker, `setLod` and
 * `setHiddenTypes` force a commit (so either refetches even for a camera that
 * has not moved), and `setVisible` fans out to every resident cell mesh. The
 * viewport's reconciliation effect re-runs on every `layers` change — a hover,
 * a rename, another layer's toggle — so without the memo each of those would
 * cost a full round trip per streaming layer.
 *
 * The plugin-side setters are additionally no-op-on-unchanged (Task C10b), so
 * this memo is defence in depth rather than the only guard; what it does add is
 * that an app-side re-push is not even attempted.
 *
 * NOTE the deliberate asymmetry with the first push: unlike `syncStyles`,
 * which skips styling a never-styled handle whose rules would paint nothing,
 * every field here IS pushed on the first pass for a handle the memo has not
 * seen. `openStream` seeds rules/visibility from the same layer values before
 * the first commit, so that push is a no-op at the plugin — but it is what
 * records the memo, and it is what makes a handle adopted from a store the app
 * did not open (a re-registered layer) correct rather than merely likely.
 */
export function syncStreamState(
  layer: Layer,
  handle: StreamInteractionHandle,
  memos: Map<string, StreamSyncMemo>,
  themeStyle?: ThemeStyle,
): void {
  let memo = memos.get(layer.id);
  if (!memo || memo.handle !== handle) {
    memo = { handle };
    memos.set(layer.id, memo);
  }

  if (memo.rules !== layer.rules || memo.rulesEnabled !== layer.rulesEnabled) {
    memo.rules = layer.rules;
    memo.rulesEnabled = layer.rulesEnabled;
    handle.setRules(layer.rules, layer.rulesEnabled);
  }
  if (
    memo.lodMode !== layer.lodMode ||
    memo.selectedLod !== layer.selectedLod
  ) {
    memo.lodMode = layer.lodMode;
    memo.selectedLod = layer.selectedLod;
    handle.setLod(layer.lodMode, layer.selectedLod);
  }
  if (memo.visible !== layer.visible) {
    memo.visible = layer.visible;
    handle.setVisible(layer.visible);
  }
  if (memo.cameraSync !== layer.cameraSync) {
    memo.cameraSync = layer.cameraSync;
    handle.setCameraSync(layer.cameraSync);
  }
  if (memo.hiddenTypes !== layer.hiddenTypes) {
    memo.hiddenTypes = layer.hiddenTypes;
    handle.setHiddenTypes(layer.hiddenTypes);
  }
  // Same optional-means-"no theme to push" contract as `syncLayers`, and the
  // same identity comparison: one frozen style object per theme.
  if (themeStyle !== undefined && memo.themeStyle !== themeStyle) {
    memo.themeStyle = themeStyle;
    handle.setThemeStyle(themeStyle);
  }
}

const NO_STREAMS: ReadonlyMap<string, InteractionHandle> = new Map();

function gatherHandles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle>,
  visibleOnly: boolean,
): readonly InteractionHandle[] {
  const out: InteractionHandle[] = [];
  for (const layer of layers) {
    if (visibleOnly && !layer.visible) continue;
    // No cast: this is where the compiler checks that a static
    // `CityModelHandle` really does satisfy `InteractionHandle`.
    const handle = live.get(layer.id)?.handle ?? streams.get(layer.id);
    if (handle) out.push(handle);
  }
  return out;
}

/** Visible layers' interaction handles, in layer order — static from `live`,
 *  streaming from `streams`. One registry, so picking, fit and the triangle
 *  readout can never disagree about which layers exist. */
export function interactionHandles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle> = NO_STREAMS,
): readonly InteractionHandle[] {
  return gatherHandles(layers, live, streams, true);
}

/**
 * The same registry, hidden layers included — what {@link syncHighlight} runs
 * over.
 *
 * Highlight is state that OUTLIVES a visibility toggle: skipping a hidden layer
 * would leave last week's selection painted on it, and re-showing it would
 * reveal that instead of the current one. Picking and the triangle readout have
 * the opposite need, which is why they get {@link interactionHandles}.
 */
export function allInteractionHandles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle> = NO_STREAMS,
): readonly InteractionHandle[] {
  return gatherHandles(layers, live, streams, false);
}

/**
 * Metres of geoid undulation baked into one layer's placement, or 0.
 *
 * The cursor readout converts an ECEF point to an ELLIPSOIDAL height, while the
 * source file's z is ORTHOMETRIC: `orthometric = geodetic - heightOffset`
 * (Global Constraints -> Vertical datum). Without this the status bar reports a
 * Delft model ~43 m high — the exact error the offset exists to remove, only
 * in the other direction.
 */
export function layerHeightOffset(
  layerId: string | undefined,
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle> = NO_STREAMS,
): number {
  if (layerId === undefined) return 0;
  const handle: InteractionHandle | undefined =
    live.get(layerId)?.handle ?? streams.get(layerId);
  const offset = handle?.heightOffset?.();
  return typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
}

/**
 * Route an engine `pick` event to the handle that owns the hit mesh.
 *
 * Unlike a screen point — which is legitimately tried against every visible
 * layer to find the nearest hit — a `PickedFeature` already identifies its
 * mesh. Handing it to the first handle in the list would be worse than useless:
 * a `batchId` (or an index pair) is only meaningful inside the mesh that
 * produced it, so another layer would map it to a real-looking but WRONG
 * surface. Unknown layer => null, never a guess.
 *
 * Three carriers, in order of how explicit they are: `properties.layerId` (what
 * a replayed or synthesised pick stamps), the Object3D's `userData.layerId`
 * (what `CityModelMesh` actually writes, and the only one that survives an
 * engine pick — `PickedFeature.properties` is null for custom meshes, Task B7
 * review), and finally the engine's own `layerId` field.
 *
 * Unwired in Part B by design: `PICK_PATH = "own-raycast"` (Task B1), so no
 * `view.on("pick")` listener exists and clicks travel the screen-point path
 * above. It is kept — and tested — because it is the contract Task C10b's
 * streaming router and any future per-triangle-batch-id engine plug into.
 */
export function resolvePickedFeature(
  handles: readonly InteractionHandle[],
  feature: PickedFeatureLike & {
    readonly object3d?: { readonly userData?: Record<string, unknown> };
  },
): Selection | null {
  const stamped = feature.object3d?.userData?.layerId;
  const layerId =
    feature.properties?.layerId ??
    (typeof stamped === "string" ? stamped : undefined) ??
    feature.layerId;
  if (layerId === undefined) return null;
  const owner = handles.find((h) => h.id === layerId);
  if (!owner) return null;
  return owner.resolvePick(feature);
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
 * What each handle was last told, keyed by handle IDENTITY.
 *
 * A `WeakMap` rather than a `Map` keyed by layer id, for two reasons: a deleted
 * handle takes its entry with it (nothing to clear, no leak), and a layer that
 * is removed and re-added gets a FRESH handle whose new mesh is unhighlighted —
 * identity keying means it is pushed to, where an id key would wrongly report
 * "already up to date".
 */
export type HighlightMemo = WeakMap<InteractionHandle, string>;

function selectionKey(s: Selection): string {
  return s.kind === "surface"
    ? `s:${s.layerId}:${s.objectId}:${s.surfaceIndex}`
    : `o:${s.layerId}:${s.objectId}`;
}

/**
 * The part of `(selections, hovered)` that can change what ONE handle paints.
 *
 * Everything else in the arguments belongs to other layers and is discarded by
 * `CityModelMesh.setHighlight` anyway, so two pushes with the same value here
 * are indistinguishable on screen.
 */
function highlightKey(
  handle: InteractionHandle,
  selections: readonly Selection[],
  hovered: Selection | null,
): string {
  const own: string[] = [];
  for (const s of selections) {
    if (s.layerId === handle.id) own.push(selectionKey(s));
  }
  const hover =
    hovered !== null && hovered.layerId === handle.id
      ? selectionKey(hovered)
      : "-";
  return `${own.join(",")}#${hover}`;
}

/**
 * Push the current selection/hover to every handle in one pass.
 *
 * The whole selection array goes to every handle unfiltered: each handle
 * already keeps only the entries whose `layerId` is its own (`CityModelMesh`
 * -> `setHighlight`, the Task B5 per-layer filter), so a handle that owns
 * nothing in the selection clears itself — which is exactly what a deselect has
 * to do. That is also why the caller must pass {@link allInteractionHandles}
 * and not {@link interactionHandles}: a hidden layer still has to be cleared.
 *
 * `memo` makes that cheap. `setHighlight` is not a cheap setter — it re-runs
 * `computeStyleColors` over the whole layer and repaints every vertex — so
 * hovering one building in layer A must not repaint layers B and C, whose own
 * filtered view of `(selections, hovered)` did not move. Without a memo every
 * hover step costs one full recolor PER LAYER, at pointer rate.
 *
 * Omitting `memo` pushes unconditionally, which is what a caller that has no
 * state to keep (a one-shot resync) wants.
 */
export function syncHighlight(
  handles: readonly InteractionHandle[],
  selections: readonly Selection[],
  hovered?: Selection | null,
  memo?: HighlightMemo,
): void {
  for (const handle of handles) {
    if (memo) {
      const key = highlightKey(handle, selections, hovered ?? null);
      if (memo.get(handle) === key) continue;
      memo.set(handle, key);
    }
    handle.setHighlight(selections, hovered ?? undefined);
  }
}
