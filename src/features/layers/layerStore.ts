import { normalizeSelectedLods } from "./selectedLods";
import { useQueryStore } from "../query/queryStore";
import { type TablePresentation } from "../query/tablePresentation";
import {
  normalizeAttributeOrders,
  type AttributeOrders,
} from "../attributes/attributeOrder";
/**
 * Zustand store for the layer system.
 *
 * Each layer holds a CityModel, its source reference, visibility,
 * per-layer colorization rules, and LoD selection.
 */

import { create } from "zustand";
import {
  appearanceThemesEqual,
  toplevelCityObjectType,
} from "@cityjson/navara-core";
import type {
  AppearanceTheme,
  CityModel,
  CityObject,
} from "../../domain/citymodel/types";
import type { CityModelReference } from "../../persistence/types";
import type { Rule } from "../rules/types";
import { normalizeColorBy, type ColorBy } from "../rules/colorBy";

/**
 * Where a DERIVED layer came from (spec §6, "What a derived layer is").
 *
 * `layerName` is a COPY of the parent's name at publication, not a live read:
 * §6.2's state line says "Derived from Delft" and the parent may be renamed or
 * removed afterwards — "a derived layer is independent of its parent from
 * publication on". `runId` is what the layer row's "Show run log" opens, and
 * what §6.2's Undo block scans the history for.
 */
export interface DerivedFrom {
  readonly layerId: string;
  readonly layerName: string;
  readonly runId: string;
}

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly model: CityModel;
  readonly modelRef: CityModelReference;
  readonly visible: boolean;
  readonly rules: ReadonlyArray<Rule>;
  /**
   * What the layer's roof surfaces are coloured by: the semantic surface
   * palette, the user's rules (with {@link unmatchedColor} under them), or one
   * {@link singleColor} for the whole layer.
   *
   * All three are ONE `Rule[]` by the time a renderer sees them — see
   * `features/rules/colorBy.ts`, which is the only thing that should ever read
   * these three fields together.
   */
  readonly colorBy: ColorBy;
  /** The colour "Color by a single colour" paints with. Kept while another
   *  mode is active, so switching away and back does not lose the choice. */
  readonly singleColor: string;
  /** The colour a roof no rule matches wears in "Color by rules". Kept for the
   *  same reason as {@link singleColor}. */
  readonly unmatchedColor: string;
  readonly selectedLod: string | null;
  /** Static layers: highest available selected LoD per object. Absent is legacy single-LoD. */
  readonly selectedLods?: readonly string[];
  readonly availableLods: ReadonlyArray<string>;
  /** "auto": the viewport-streaming driver (Task 14) picks the LoD ladder
   *  rung from zoom level. "manual": the user's `selectedLod` choice pins
   *  it, same as a non-streaming layer. Defaults to "auto" so a freshly
   *  loaded streaming layer follows zoom without extra user action.
   *
   *  STATIC layers only, as of the global streaming-LoD control: a streaming
   *  layer's LoD comes from `useStreamLodStore` (see `streamLod.ts` for why
   *  a per-layer choice cannot work for a ladder discovered at stream time),
   *  and `syncStreamState` pushes that instead of this field. Kept because
   *  the field is captured in snapshots and read by `useLayerFileLoader`. */
  readonly lodMode: "auto" | "manual";
  /**
   * Whether a STREAMING layer follows the camera. `true` (the default, and
   * the only value a static layer ever has) is the behaviour every streaming
   * layer has always had: each camera settle re-queries the source for the
   * new viewport. `false` freezes the resident set where it is — the plugin
   * handle stops committing entirely (`FcbStreamLayerHandle.setCameraSync`).
   *
   * Per-layer rather than global, unlike the LoD choice above, because the
   * two answer different questions: "which detail level" is a property of how
   * you want to look at data, while "keep THIS extract" is a property of one
   * dataset — a user comparing a frozen reference area against a second layer
   * they keep panning is the whole point of having it.
   */
  readonly cameraSync: boolean;
  /** True once a layer's stream has been opened and admitted (Task 8's
   *  `checkAdmission`) for viewport streaming, i.e. it has per-cell state
   *  in `useStreamStore` rather than one resident `model`. Defaults to
   *  false: every layer starts as a plain, fully-resident layer. */
  readonly isStreaming: boolean;
  /**
   * First-level object groups whose geometry this layer leaves out — hiding
   * "Building" hides its BuildingParts too, because in real data the
   * `Building` carries no geometry at all (`toplevelCityObjectType`).
   *
   * Hiding shapes GEOMETRY, not styling: rules, DuckDB, the table and the
   * inspector still see every object; only meshes (and so raycast picking)
   * lose them. Replaced wholesale on every edit — the sync layer compares
   * identity, same convention as {@link Layer.rules}.
   */
  readonly hiddenTypes: ReadonlyArray<string>;
  readonly attributeOrders?: AttributeOrders;
  readonly tablePresentation?: TablePresentation;
  /**
   * Only these objects are DRAWN, or `null` for all of them — the table
   * panel's "Filter map" toggle, pushed to the plugin by `handleSync`.
   *
   * An EMPTY set is a real, distinct value: it means the filter matched
   * nothing, and nothing is what must be drawn. `null` means there is no
   * filter at all.
   *
   * SESSION state, like the query it comes from: never captured in a snapshot
   * or a share link, and reset to `null` whenever the layer's table is rebuilt.
   */
  readonly visibleObjectIds: ReadonlySet<string> | null;
  /**
   * The first-level groups present in the model, sorted — what the layer's
   * type toggles list.
   *
   * Empty for a STREAMING layer: its objects arrive cell by cell, so the list
   * comes from `useStreamStore`'s `types` (the handle's `onTypes` union)
   * instead, for the same reason its LoD ladder does.
   */
  readonly availableObjectTypes: ReadonlyArray<string>;
  /**
   * The CityJSON appearance themes the model carries — texture themes first,
   * then material themes, each by the name the file gave it. Empty for a
   * model without appearance, and for a streaming layer (its model is a
   * stub; the stream learns its themes cell by cell, like its LoD ladder).
   */
  readonly appearanceThemes: ReadonlyArray<AppearanceTheme>;
  /**
   * Which theme the layer draws, or `null` for the plain semantic / rule
   * colours. Defaults at load to the file's own default texture theme, else
   * its first texture theme, else its default/first material theme — so a
   * textured dataset shows its textures without a click. Pushed to the
   * plugin's `setAppearance` by `handleSync`; captured in snapshots.
   */
  readonly selectedAppearance: AppearanceTheme | null;
  /**
   * Null for every ordinary layer. REQUIRED rather than optional, so the
   * snapshot filter, the state line and the layer-list marker are all reading
   * a field the compiler made every fixture answer for. NOT added to
   * `App.tsx`'s explicit serialisation list — a derived layer is omitted from
   * the snapshot entirely (§8), so this field is not persisted by
   * construction.
   */
  readonly derivedFrom: DerivedFrom | null;
}

export interface LayerStoreState {
  readonly layers: ReadonlyArray<Layer>;
}

export interface LayerStoreActions {
  addLayer: (
    layer: Omit<
      Layer,
      | "id"
      | "selectedLod"
      | "availableLods"
      | "lodMode"
      | "isStreaming"
      | "derivedFrom"
      | "cameraSync"
      | "hiddenTypes"
      | "visibleObjectIds"
      | "availableObjectTypes"
      | "appearanceThemes"
      | "selectedAppearance"
      | "colorBy"
      | "singleColor"
      | "unmatchedColor"
    > & {
      /** Defaults to a fresh UUID. Supplied only by `openStreamingLayer`,
       *  where the plugin has already registered its handle under an id it
       *  minted first — the layer and the handle must share one id or every
       *  `plugin.getHandle(layer.id)` lookup misses. */
      readonly id?: string;
      /** Defaults to false. Set true for a layer opened via viewport
       *  streaming (Task 17's `openStreamingLayer`) — its `model` is a stub
       *  (bbox only, empty objects) rather than a fully-parsed model. */
      readonly isStreaming?: boolean;
      /** Defaults to null. Supplied only by a New-layer run's publication
       *  (Tasks 21 and 23). */
      readonly derivedFrom?: DerivedFrom | null;
      /**
       * Insert directly AFTER this layer instead of appending (spec §6.2: the
       * derived layer is "inserted directly under its target in the layer
       * list"). An id that is not in the list appends, which is what a target
       * removed between Run and publication leaves behind.
       */
      readonly insertAfterId?: string;
      /** Defaults to nothing hidden. Supplied by a RESTORE, where the same
       *  value was seeded into the plugin at add/open time so the layer never
       *  renders one frame of the geometry it was saved without. */
      readonly hiddenTypes?: ReadonlyArray<string>;
      readonly attributeOrders?: AttributeOrders;
      readonly tablePresentation?: TablePresentation;
      /** Supplied by a RESTORE. Applied only when the (possibly different)
       *  model actually carries that theme; `undefined` means "choose the
       *  load default", `null` means "plain colours, deliberately". */
      readonly selectedAppearance?: AppearanceTheme | null;
      /**
       * Supplied by a RESTORE or a share link. Absent means DERIVED from
       * {@link rules} — a layer that arrives carrying rules opens on those
       * rules, because that is the rendering it was saved from; a fresh
       * layer, which arrives with none, opens on "surface". An unreadable
       * colour falls back to the `cityColors` default.
       */
      readonly colorBy?: ColorBy;
      readonly singleColor?: string;
      readonly unmatchedColor?: string;
    },
  ) => string;
  removeLayer: (id: string) => void;
  updateLayer: (
    id: string,
    patch: Partial<
      Pick<
        Layer,
        "name" | "visible" | "colorBy" | "singleColor" | "unmatchedColor"
      >
    >,
  ) => void;
  /**
   * Merge computed attributes into one layer's model.
   *
   * A processing tool's output lands here: `byObjectId` maps a city object id
   * to the keys to write on it, and an `undefined` VALUE deletes a key — which
   * is what Undo of a computed column is, and why the value type is not simply
   * "the new value".
   *
   * Produces a NEW model with a NEW object for each touched id, and leaves
   * every untouched object at its old identity. Both halves matter: the new
   * model identity is what `syncLayers` pushes to `handle.setModel`, and the
   * preserved object identities are what keeps that push a repaint rather than
   * an invalidation of everything memoised per object. A merge that would
   * change nothing (empty map, unknown layer, no id present on the layer)
   * leaves the store's identity alone.
   */
  mergeAttributes: (
    layerId: string,
    byObjectId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ) => void;
  removeAllLayers: () => void;
  setLayerLod: (layerId: string, lod: string | null) => void;
  setLayerLods: (layerId: string, lods: readonly string[]) => void;
  setLodMode: (layerId: string, mode: "auto" | "manual") => void;
  /** Draw `theme` (one of {@link Layer.appearanceThemes}) or `null` for
   *  plain colours. */
  setLayerAppearance: (layerId: string, theme: AppearanceTheme | null) => void;
  /** Streaming layers only in practice — a static layer has nothing to
   *  follow the camera with. See {@link Layer.cameraSync}. */
  setCameraSync: (layerId: string, enabled: boolean) => void;
  /** Replaces {@link Layer.hiddenTypes} — never mutates it, because the sync
   *  layer's "did this change?" test is array identity. */
  setAttributeOrder: (
    layerId: string,
    objectType: string,
    order: ReadonlyArray<string>,
  ) => void;
  setHiddenTypes: (layerId: string, types: ReadonlyArray<string>) => void;
  /** Replaces {@link Layer.visibleObjectIds} — never mutates it, because the
   *  sync layer's "did this change?" test is set IDENTITY. */
  setVisibleObjectIds: (
    layerId: string,
    ids: ReadonlySet<string> | null,
  ) => void;

  copyStyle: (targetId: string, sourceId: string) => void;
  // Per-layer rule actions
  addRule: (layerId: string, rule: Rule) => void;
  updateRule: (
    layerId: string,
    ruleId: string,
    patch: Partial<Omit<Rule, "id">>,
  ) => void;
  deleteRule: (layerId: string, ruleId: string) => void;
  reorderRules: (layerId: string, fromIdx: number, toIdx: number) => void;
  clearRules: (layerId: string) => void;
}

export type LayerStore = LayerStoreState & LayerStoreActions;

/**
 * Collect unique LoD values from all surfaces in a model,
 * sorted numerically descending (highest first).
 */
export function computeAvailableLods(model: CityModel): string[] {
  const set = new Set<string>();
  for (const obj of Object.values(model.objects)) {
    for (const surface of obj?.surfaces ?? []) {
      if (surface.lod) set.add(surface.lod);
    }
  }
  return [...set].sort((a, b) => parseFloat(b) - parseFloat(a));
}

/**
 * The first-level object groups present in a model, sorted alphabetically.
 *
 * Every `objectType` is folded through `toplevelCityObjectType` first, so a
 * file of 66 Buildings and 66 BuildingParts offers ONE "Building" toggle —
 * which is also the only toggle that can hide anything, since the geometry
 * hangs off the parts.
 */
export function computeAvailableObjectTypes(model: CityModel): string[] {
  const set = new Set<string>();
  for (const obj of Object.values(model.objects)) {
    if (obj) set.add(toplevelCityObjectType(obj.objectType));
  }
  return [...set].sort();
}

/**
 * The themes a model offers, texture themes first — the order the selector
 * lists them in, and the order the load default is chosen from.
 */
export function computeAppearanceThemes(model: CityModel): AppearanceTheme[] {
  const appearance = model.appearance;
  if (!appearance) return [];
  return [
    ...appearance.textureThemes.map(
      (name): AppearanceTheme => ({ kind: "texture", name }),
    ),
    ...appearance.materialThemes.map(
      (name): AppearanceTheme => ({ kind: "material", name }),
    ),
  ];
}

/**
 * What a freshly loaded layer draws: the file's declared default texture
 * theme, else its first texture theme, else the declared/first material
 * theme, else nothing. Textures win over materials because a file that
 * carries photos of its facades is asking to be seen that way.
 */
export function defaultAppearanceTheme(
  model: CityModel,
): AppearanceTheme | null {
  const appearance = model.appearance;
  if (!appearance) return null;
  const texture =
    appearance.defaultTextureTheme ?? appearance.textureThemes[0] ?? null;
  if (texture !== null) return { kind: "texture", name: texture };
  const material =
    appearance.defaultMaterialTheme ?? appearance.materialThemes[0] ?? null;
  return material !== null ? { kind: "material", name: material } : null;
}

export const useLayerStore = create<LayerStore>((set) => ({
  layers: [],

  addLayer: (input) => {
    const id = input.id ?? crypto.randomUUID();
    const availableLods = computeAvailableLods(input.model);
    const selectedLods =
      input.isStreaming || availableLods.length === 0
        ? undefined
        : (normalizeSelectedLods(input.selectedLods) ?? availableLods).filter(
            (lod) => availableLods.includes(lod),
          );
    const selectedLod = (selectedLods ?? availableLods)[0] ?? null;
    const appearanceThemes = input.isStreaming
      ? []
      : computeAppearanceThemes(input.model);
    // A restored choice survives only if this model has that theme — a
    // re-linked file may differ; an explicit null is honoured as-is.
    const restored = input.selectedAppearance;
    const selectedAppearance =
      restored === undefined
        ? defaultAppearanceTheme(input.model)
        : restored === null ||
            appearanceThemes.some((t) => appearanceThemesEqual(t, restored))
          ? restored
          : defaultAppearanceTheme(input.model);
    // Validated and DERIVED in one place, the same function both restore paths
    // use — so a layer added from a snapshot, a share link or a fresh file all
    // reach the store through one answer.
    const colorBy = normalizeColorBy(input);
    // An INSTRUCTION to the store, not a field of a layer — pulled out of the
    // input so the spread below cannot carry it into the record (and thence
    // into every `Layer` comparison and the snapshot's field list).
    const { insertAfterId, ...rest } = input;
    set((state) => {
      // Typed `: Layer`, not `as Layer`: this is the one construction site of
      // the record, and the annotation is what makes a new REQUIRED field
      // (`derivedFrom`) a compile error here rather than an undefined at
      // runtime.
      const record: Layer = {
        ...rest,
        id,
        selectedLod,
        selectedLods,
        availableLods,
        lodMode: "auto",
        // Every layer starts following the camera: that is what streaming
        // has always done, and freezing an extract is a deliberate act.
        cameraSync: true,
        isStreaming: input.isStreaming ?? false,
        derivedFrom: input.derivedFrom ?? null,
        hiddenTypes: input.hiddenTypes ?? [],
        attributeOrders: normalizeAttributeOrders(input.attributeOrders),
        // Session state, and never an add-time input: a fresh layer is
        // unfiltered until a query says otherwise.
        visibleObjectIds: null,
        // A streaming layer's `model` is a stub (bbox only), so there is
        // nothing to fold here; `useStreamStore`'s `types` carries its
        // groups instead.
        availableObjectTypes: input.isStreaming
          ? []
          : computeAvailableObjectTypes(input.model),
        appearanceThemes,
        selectedAppearance,
        ...colorBy,
      };
      // §6.2: a derived layer is "inserted directly under its target in the
      // layer list". `insertAfterId` is the ONLY way this is not an append, so
      // every existing caller keeps append semantics and there is exactly one
      // splice site. An id that is not in the list appends — which is what a
      // target removed between Run and publication leaves behind.
      const at =
        insertAfterId === undefined
          ? -1
          : state.layers.findIndex((l) => l.id === insertAfterId);
      if (at < 0) return { layers: [...state.layers, record] };
      const next = [...state.layers];
      next.splice(at + 1, 0, record);
      return { layers: next };
    });
    useQueryStore.getState().restorePresentation(id, input.tablePresentation);
    return id;
  },

  removeLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
    })),

  updateLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id
          ? {
              ...l,
              ...patch,
            }
          : l,
      ),
    })),

  mergeAttributes: (layerId, byObjectId) =>
    set((state) => {
      if (byObjectId.size === 0) return state;
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return state;
      const objects: Record<string, CityObject> = { ...layer.model.objects };
      let touched = false;
      for (const [id, patch] of byObjectId) {
        const object = objects[id];
        // An id the tool computed for but this model does not have (a stale
        // result, a BuildingPart rolled up under its parent) is skipped, not
        // invented — `objects` must stay a faithful index of the model.
        if (!object) continue;
        const attributes: Record<string, unknown> = { ...object.attributes };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete attributes[key];
          else attributes[key] = value;
        }
        objects[id] = { ...object, attributes };
        touched = true;
      }
      // No id matched: return the SAME state, so nothing re-renders and
      // `syncLayers` does not push a new-but-identical model into a repaint.
      if (!touched) return state;
      const model: CityModel = { ...layer.model, objects };
      return {
        layers: state.layers.map((l) =>
          l.id === layerId ? { ...l, model } : l,
        ),
      };
    }),

  removeAllLayers: () => set({ layers: [] }),

  setLayerLod: (layerId, lod) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId
          ? { ...l, selectedLod: lod, selectedLods: undefined }
          : l,
      ),
    })),

  setLayerLods: (layerId, lods) =>
    set((state) => ({
      layers: state.layers.map((l) => {
        if (l.id !== layerId || l.isStreaming) return l;
        const selectedLods = l.availableLods.filter((lod) =>
          lods.includes(lod),
        );
        return { ...l, selectedLods, selectedLod: selectedLods[0] ?? null };
      }),
    })),

  setLayerAppearance: (layerId, theme) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, selectedAppearance: theme } : l,
      ),
    })),

  setLodMode: (layerId, mode) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, lodMode: mode } : l,
      ),
    })),

  setCameraSync: (layerId, enabled) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, cameraSync: enabled } : l,
      ),
    })),

  setAttributeOrder: (layerId, objectType, order) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              attributeOrders: {
                ...layer.attributeOrders,
                [objectType]: [...new Set(order)],
              },
            }
          : layer,
      ),
    })),
  setHiddenTypes: (layerId, types) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, hiddenTypes: types } : l,
      ),
    })),

  setVisibleObjectIds: (layerId, ids) =>
    set((state) => {
      // No-op on IDENTITY (null over null, or the same Set again). The map
      // filter recomputes on every Apply, every toggle and every table
      // rebuild, and the common answer is "still null" — without this guard
      // each of those mints a fresh `layers` array, re-renders every
      // subscriber, and re-runs `syncLayers`, whose test for this field is
      // reference identity: a churned identical set rebuilds the mesh's
      // geometry for nothing.
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer === undefined || layer.visibleObjectIds === ids) return state;
      return {
        layers: state.layers.map((l) =>
          l.id === layerId ? { ...l, visibleObjectIds: ids } : l,
        ),
      };
    }),

  copyStyle: (targetId, sourceId) =>
    set((state) => {
      const source = state.layers.find((l) => l.id === sourceId);
      if (!source || targetId === sourceId) return state;
      return {
        layers: state.layers.map((layer) =>
          layer.id === targetId
            ? {
                ...layer,
                colorBy: source.colorBy,
                singleColor: source.singleColor,
                unmatchedColor: source.unmatchedColor,
                rules: structuredClone(source.rules).map((rule) => ({
                  ...rule,
                  id: crypto.randomUUID(),
                })),
              }
            : layer,
        ),
      };
    }),
  // --- Per-layer rule actions ---

  addRule: (layerId, rule) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, rules: [...l.rules, rule] } : l,
      ),
    })),

  updateRule: (layerId, ruleId, patch) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              rules: l.rules.map((r) =>
                r.id === ruleId ? { ...r, ...patch } : r,
              ),
            }
          : l,
      ),
    })),

  deleteRule: (layerId, ruleId) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId
          ? { ...l, rules: l.rules.filter((r) => r.id !== ruleId) }
          : l,
      ),
    })),

  reorderRules: (layerId, fromIdx, toIdx) =>
    set((state) => ({
      layers: state.layers.map((l) => {
        if (l.id !== layerId) return l;
        const rules = [...l.rules];
        const [moved] = rules.splice(fromIdx, 1);
        if (moved) rules.splice(toIdx, 0, moved);
        return { ...l, rules };
      }),
    })),

  clearRules: (layerId) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, rules: [] } : l,
      ),
    })),
}));
