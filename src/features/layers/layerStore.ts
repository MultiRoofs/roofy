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
import type { AppearanceTheme, CityModel } from "../../domain/citymodel/types";
import type { CityModelReference } from "../../persistence/types";
import type { Rule } from "../rules/types";

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly model: CityModel;
  readonly modelRef: CityModelReference;
  readonly visible: boolean;
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
  readonly selectedLod: string | null;
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
}

export interface LayerStoreState {
  readonly layers: ReadonlyArray<Layer>;
  readonly activeLayerId: string | null;
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
      | "cameraSync"
      | "hiddenTypes"
      | "visibleObjectIds"
      | "availableObjectTypes"
      | "appearanceThemes"
      | "selectedAppearance"
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
      /** Defaults to nothing hidden. Supplied by a RESTORE, where the same
       *  value was seeded into the plugin at add/open time so the layer never
       *  renders one frame of the geometry it was saved without. */
      readonly hiddenTypes?: ReadonlyArray<string>;
      /** Supplied by a RESTORE. Applied only when the (possibly different)
       *  model actually carries that theme; `undefined` means "choose the
       *  load default", `null` means "plain colours, deliberately". */
      readonly selectedAppearance?: AppearanceTheme | null;
    },
  ) => string;
  removeLayer: (id: string) => void;
  updateLayer: (
    id: string,
    patch: Partial<Pick<Layer, "name" | "visible">>,
  ) => void;
  setActiveLayer: (id: string | null) => void;
  removeAllLayers: () => void;
  setLayerLod: (layerId: string, lod: string | null) => void;
  setLodMode: (layerId: string, mode: "auto" | "manual") => void;
  /** Draw `theme` (one of {@link Layer.appearanceThemes}) or `null` for
   *  plain colours. */
  setLayerAppearance: (layerId: string, theme: AppearanceTheme | null) => void;
  /** Streaming layers only in practice — a static layer has nothing to
   *  follow the camera with. See {@link Layer.cameraSync}. */
  setCameraSync: (layerId: string, enabled: boolean) => void;
  /** Replaces {@link Layer.hiddenTypes} — never mutates it, because the sync
   *  layer's "did this change?" test is array identity. */
  setHiddenTypes: (layerId: string, types: ReadonlyArray<string>) => void;
  /** Replaces {@link Layer.visibleObjectIds} — never mutates it, because the
   *  sync layer's "did this change?" test is set IDENTITY. */
  setVisibleObjectIds: (
    layerId: string,
    ids: ReadonlySet<string> | null,
  ) => void;

  // Per-layer rule actions
  addRule: (layerId: string, rule: Rule) => void;
  updateRule: (
    layerId: string,
    ruleId: string,
    patch: Partial<Omit<Rule, "id">>,
  ) => void;
  deleteRule: (layerId: string, ruleId: string) => void;
  reorderRules: (layerId: string, fromIdx: number, toIdx: number) => void;
  toggleRulesEnabled: (layerId: string) => void;
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
  activeLayerId: null,

  addLayer: (input) => {
    const id = input.id ?? crypto.randomUUID();
    const availableLods = computeAvailableLods(input.model);
    const selectedLod = availableLods[0] ?? null;
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
    set((state) => ({
      layers: [
        ...state.layers,
        {
          ...input,
          id,
          selectedLod,
          availableLods,
          lodMode: "auto",
          // Every layer starts following the camera: that is what streaming
          // has always done, and freezing an extract is a deliberate act.
          cameraSync: true,
          isStreaming: input.isStreaming ?? false,
          hiddenTypes: input.hiddenTypes ?? [],
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
        },
      ],
      activeLayerId: state.activeLayerId ?? id,
    }));
    return id;
  },

  removeLayer: (id) =>
    set((state) => {
      const layers = state.layers.filter((l) => l.id !== id);
      const activeLayerId =
        state.activeLayerId === id
          ? (layers[layers.length - 1]?.id ?? null)
          : state.activeLayerId;
      return { layers, activeLayerId };
    }),

  updateLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  setActiveLayer: (id) => set({ activeLayerId: id }),

  removeAllLayers: () => set({ layers: [], activeLayerId: null }),

  setLayerLod: (layerId, lod) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, selectedLod: lod } : l,
      ),
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

  toggleRulesEnabled: (layerId) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, rulesEnabled: !l.rulesEnabled } : l,
      ),
    })),

  clearRules: (layerId) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, rules: [] } : l,
      ),
    })),
}));
