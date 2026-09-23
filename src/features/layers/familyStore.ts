/**
 * What a streamed CityParquet package offers, what is open, and the reopen a
 * toggle runs.
 *
 * A CityParquet package is a SET of object families (building, bridge,
 * water_body, transportation, vegetation, city_furniture) — one Parquet file
 * each. The milestone's premise is that the user picks which families' geometry
 * to render (Building by default, ruling R-D) while EVERY family keeps its own
 * queryable table, read straight from the file. This store is the app-side half
 * of that: the families a layer has, which of them are open, which one the table
 * panel is showing, and the four states the handoff insists stay distinct —
 * _available_ (in the manifest), _opened_ (its geometry is streaming), its
 * table's own `absent / creating / ready / failed`, and _visible_ (hidden types,
 * filters), which is not here at all because it is the layer row's business.
 *
 * WHY A SEPARATE STORE from `layerStore`. Changing families neither adds nor
 * removes a layer, and `layerStore.layers` is subscribed to WHOLE by the
 * viewport, the details panel and the table panel — the same reason
 * `streamStore` is separate (see its doc comment). A family's table going
 * `creating` → `ready` must not re-render the scene.
 *
 * THE REOPEN (ruling R-E′) is here rather than in the UI because it is a
 * TRANSACTION over three things that must agree: the enabled set, the stream's
 * handle, and the layer row that must not move. It is serialised per layer, and
 * a queued job reads the LATEST desired set rather than the one it was enqueued
 * with — two rapid toggles then cost ONE reopen, and there is never an in-flight
 * open for a later toggle to supersede. The only supersession left is the layer
 * going away mid-open, which the generation guard disposes.
 */

import { create } from "zustand";
import {
  dropFamilyView,
  ensureFamilyView,
  type FamilySource,
} from "../../insights/familyViews";
import { getLayerTable, layerTableKey } from "../../insights/layerTables";
import { useQueryStore } from "../query/queryStore";
import { familySourceCrs } from "../cityparquet/familySourceCrs";
import { reopenStreamingLayer } from "../streaming/openStreamingLayer";
import type { StreamPlugin } from "../streaming/streamPlugin";
import { useStreamStore } from "../streaming/streamStore";
import type { StreamSource } from "@cityjson/navara-flatcitybuf";

export type { FamilySource };

/** Whether a family's GEOMETRY is being streamed. Distinct from its table's
 *  state and from its objects' visibility — the handoff requires all three to
 *  stay tellable apart. */
export type FamilyGeometryState = "closed" | "opening" | "open" | "failed";

/** Whether a family's queryable table (a VIEW over the file, R-B′) exists. */
export type FamilyTableState = "absent" | "creating" | "ready" | "failed";

/** One object family of one layer. */
export interface LayerFamily {
  /**
   * The family's identity WITHIN THIS LAYER, and the second half of its table
   * key (`${layerId}::${key}`, R-C′).
   *
   * Normally the manifest's own family key. It is disambiguated when two tables
   * yield the same one (`east/building.parquet`, `west/building.parquet`):
   * distinct tables must not collide on one registry key, or enabling both would
   * be inexpressible and one family's view would replace the other's.
   */
  readonly key: string;
  /** The key BEFORE disambiguation — what the Building default is tested
   *  against (R-D), so a package with two building tables opens both. */
  readonly rawKey: string;
  /** For the UI: the key with `_` as a space and each word capitalised, plus the
   *  href when the raw key alone would not tell two families apart. */
  readonly label: string;
  /** The manifest href (or object name) — the family's SOURCE identity in human
   *  terms, and what disambiguates a duplicate label. */
  readonly href: string;
  /** Where DuckDB and the stream worker read the family's rows: a resolved URL,
   *  or the picked `File` itself. */
  readonly source: FamilySource;
  /** The declared byte size, or `null` when the source never said. */
  readonly size: number | null;
  /**
   * Rows in the family's file, from the stream header's `tables` — `null` until
   * the family has been opened at least once.
   *
   * `header.tables[i].name` is a LABEL, not an identity, so the pairing is
   * strictly by ARRAY ORDER against the families the stream was opened with
   * (see {@link FamilyStoreActions.applyStreamTables}).
   */
  readonly rowCount: number | null;
}

/** The reopen's own state — what a failed toggle leaves for a Retry to act on
 *  (the button is the UI's; this is the state behind it). */
export type FamilyReopenState =
  | { readonly state: "idle" }
  | { readonly state: "reopening" }
  | { readonly state: "failed"; readonly message: string };

export interface LayerFamilyState {
  /** Available families, in manifest order. */
  readonly families: ReadonlyArray<LayerFamily>;
  /** The families whose geometry the user wants open. The DESIRED set: a reopen
   *  in flight may not have caught up with it yet, which is exactly why
   *  {@link opened} is recorded separately. */
  readonly enabled: ReadonlySet<string>;
  /**
   * The families the LIVE STREAM is actually open with, in source order.
   *
   * Empty when there is no stream — including after a FAILED reopen, which
   * removed the old handle before trying the new one. That matters: a reopen job
   * whose desired set equals `opened` is a no-op, so claiming the previous set
   * here would let a toggle-on-then-off clear the failure and leave a layer with
   * no geometry and no Retry.
   */
  readonly opened: ReadonlyArray<string>;
  /** Which family the table panel is showing. `null` only for a layer with no
   *  families at all. */
  readonly active: string | null;
  readonly geometry: Readonly<Record<string, FamilyGeometryState>>;
  readonly table: Readonly<Record<string, FamilyTableState>>;
  readonly reopen: FamilyReopenState;
  /**
   * Bumped when this layer's families are (re)published and when the layer is
   * FORGOTTEN — not by an ordinary reopen, which the per-layer chain already
   * serialises.
   *
   * The cancellation that chain cannot give on its own: an open that is still
   * booting its worker when the layer is removed has to be told that what it is
   * about to register is not wanted, and a number is the only thing that
   * survives the store entry being deleted (see `farewells`).
   */
  readonly generation: number;
}

export interface FamilyStoreState {
  readonly layers: Readonly<Record<string, LayerFamilyState>>;
}

/** One family as the loader resolves it, before this store gives it a unique
 *  key, a label and a row count. */
export interface FamilyInput {
  readonly key: string;
  readonly href: string;
  readonly size: number | null;
  readonly source: FamilySource;
}

export interface FamilyStoreActions {
  /**
   * Publish a layer's families and seed the R-D default.
   *
   * Called BEFORE the layer row lands, so the table lifecycle already knows this
   * layer has families and never builds it a bare resident table to freeze
   * (ruling S3). It also kicks off the ACTIVE family's view, for the same
   * reason: a reader must have the whole-file answer to resolve to.
   */
  setFamilies: (
    layerId: string,
    families: ReadonlyArray<LayerFamily>,
    enabled?: ReadonlyArray<string>,
  ) => void;
  /** Forget a layer: it was removed, or its open failed. Bumps the generation,
   *  so an open still in flight disposes rather than registers. */
  forgetLayer: (layerId: string) => void;
  /** Which family the table panel shows. Ensures its view if it has none. */
  setActiveFamily: (layerId: string, family: string) => void;
  setFamilyTableState: (
    layerId: string,
    family: string,
    state: FamilyTableState,
  ) => void;
  setFamilyGeometryState: (
    layerId: string,
    family: string,
    state: FamilyGeometryState,
  ) => void;
  /**
   * Record the stream header's per-table row counts against the families the
   * stream was OPENED with, strictly by array order.
   *
   * `tables[i].name` is whatever the reader labelled the file — never an
   * identity — so matching on it is the one thing this must not do.
   */
  applyStreamTables: (
    layerId: string,
    openedKeys: ReadonlyArray<string>,
    tables: ReadonlyArray<{ readonly name: string; readonly rowCount: number }>,
  ) => void;
}

export type FamilyStore = FamilyStoreState & FamilyStoreActions;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** The family key a file name yields: its last path segment without the
 *  `.parquet` extension (R-A′'s fallback, used when no manifest asset key
 *  named the table). */
export function familyKeyFromName(name: string): string {
  const segments = name.split("/");
  const base = segments[segments.length - 1] ?? name;
  const stripped = base.replace(/\.parquet$/i, "");
  return stripped === "" ? base : stripped;
}

/** `water_body` -> `Water Body`. The keys are writer-chosen snake_case in every
 *  package seen so far; anything else is shown as it came, capitalised. */
export function familyLabel(key: string): string {
  const words = key.split(/[_\s]+/).filter((w) => w.length > 0);
  if (words.length === 0) return key;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Give each resolved family a UNIQUE key and a label that tells it from its
 * namesakes (R-A′).
 *
 * The key is the manifest's when it is unique and `key#2`, `key#3` … when it is
 * not. `#` cannot appear in a key a `.parquet` basename produced and is not
 * legal in a STAC asset key either, so a suffixed key cannot be mistaken for a
 * real one — and because it is only ever the SECOND of a colliding pair, the
 * common package's keys read exactly as the manifest wrote them.
 */
export function buildLayerFamilies(
  input: ReadonlyArray<FamilyInput>,
): LayerFamily[] {
  const duplicated = new Set<string>();
  const seen = new Set<string>();
  for (const family of input) {
    if (seen.has(family.key)) duplicated.add(family.key);
    seen.add(family.key);
  }
  const used = new Map<string, number>();
  return input.map((family) => {
    const count = (used.get(family.key) ?? 0) + 1;
    used.set(family.key, count);
    return {
      key: count === 1 ? family.key : `${family.key}#${String(count)}`,
      rawKey: family.key,
      label: duplicated.has(family.key)
        ? `${familyLabel(family.key)} (${family.href})`
        : familyLabel(family.key),
      href: family.href,
      source: family.source,
      size: family.size,
      rowCount: null,
    };
  });
}

/** The family key a Building default looks for, after extension stripping and
 *  case folding. */
const BUILDING_KEY = "building";

/**
 * Ruling R-D: Building alone when the package HAS a building table, else every
 * available family.
 *
 * Tested against the RAW key, so a package with `east/building.parquet` and
 * `west/building.parquet` opens both — they are both Building, whatever their
 * disambiguated keys read as. A single-table source has one family and gets it.
 */
export function defaultEnabledKeys(
  families: ReadonlyArray<LayerFamily>,
): string[] {
  // CASE-FOLDED: a writer who spelt the asset key `Building`, or shipped
  // `Building.parquet` with no manifest key, means the same family — and an
  // exact-match test would silently open the WHOLE package instead of one table.
  // Only this test folds; the label keeps the writer's own casing.
  const buildings = families.filter(
    (f) => f.rawKey.toLowerCase() === BUILDING_KEY,
  );
  return (buildings.length > 0 ? buildings : families).map((f) => f.key);
}

/**
 * Could this family hold ROOT Buildings — the rows the table panel's "Buildings"
 * reading counts?
 *
 * The SAME test the Building default uses (R-D): the raw key, case-folded. A
 * bridge or water-body table has no root Building in it, so offering that
 * reading would answer every question with zero — "All 0 buildings" over a table
 * of 12 000 bridges. The panel therefore browses such a family raw and does not
 * offer the switch at all.
 *
 * It is a statement about the family's KIND, not a query: asking the table would
 * cost a round trip per family switch and would still be a guess before the view
 * exists.
 */
export function familyOffersBuildings(family: LayerFamily): boolean {
  return family.rawKey.toLowerCase() === BUILDING_KEY;
}

/**
 * A layer's family choice, for a workspace snapshot or a share link (ruling S4)
 * — or `undefined` for a layer that has none, which writes nothing.
 *
 * The DESIRED set (`enabled`), not what happens to be open: a save taken while a
 * reopen is in flight, or just after one failed, should restore what the user
 * asked for rather than the state the failure left behind.
 */
export function familiesSnapshotOf(layerId: string):
  | {
      readonly enabled: ReadonlyArray<string>;
      readonly active: string | null;
    }
  | undefined {
  const entry = useFamilyStore.getState().layers[layerId];
  if (entry === undefined || entry.families.length === 0) return undefined;
  return { enabled: [...entry.enabled], active: entry.active };
}

/**
 * What a restored choice means for the families this open actually resolved
 * (ruling S4).
 *
 * The saved keys are NOT trusted: a package can be repackaged between the save
 * and the restore, so a key that no longer exists is dropped — and if nothing
 * survives, `enabled` is `undefined`, which means "the R-D default". Restoring an
 * empty set would open a layer with no stream at all, which `openStream` cannot
 * even express.
 *
 * `active: null` means "whichever family opens first", the same thing a fresh
 * open means by it.
 */
export function restoredFamilyChoice(
  families: ReadonlyArray<LayerFamily>,
  saved:
    | {
        readonly enabled: ReadonlyArray<string>;
        readonly active: string | null;
      }
    | undefined,
): {
  readonly enabled: string[] | undefined;
  readonly active: string | null;
} {
  if (saved === undefined) return { enabled: undefined, active: null };
  const keys = new Set(families.map((f) => f.key));
  const enabled = saved.enabled.filter((key) => keys.has(key));
  return {
    enabled: enabled.length === 0 ? undefined : enabled,
    active:
      saved.active !== null && keys.has(saved.active) ? saved.active : null,
  };
}

/** The stream source for a list of families, in their own order. The shape the
 *  worker was verified against: ONE file is `{url}`/`{blob}`, several are
 *  `{urls}`/`{blobs}`. */
export function streamSourceOf(
  families: ReadonlyArray<LayerFamily>,
): StreamSource {
  const urls: string[] = [];
  const blobs: File[] = [];
  for (const family of families) {
    if ("url" in family.source) urls.push(family.source.url);
    else blobs.push(family.source.file);
  }
  // A package is one or the other — a manifest's tables are all URLs, a picked
  // folder's are all files — so a mixed list is a bug here, not a shape the
  // worker has to answer for.
  if (blobs.length === 0) {
    return urls.length === 1 ? { url: urls[0]! } : { urls };
  }
  return blobs.length === 1 ? { blob: blobs[0]! } : { blobs };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

function patchLayer(
  state: FamilyStoreState,
  layerId: string,
  patch: (entry: LayerFamilyState) => LayerFamilyState,
): FamilyStoreState {
  const entry = state.layers[layerId];
  if (!entry) return state;
  return { layers: { ...state.layers, [layerId]: patch(entry) } };
}

export const useFamilyStore = create<FamilyStore>((set) => ({
  layers: {},

  setFamilies: (layerId, families, enabled) => {
    const enabledKeys = enabled ?? defaultEnabledKeys(families);
    const open = families
      .filter((f) => enabledKeys.includes(f.key))
      .map((f) => f.key);
    const geometry: Record<string, FamilyGeometryState> = {};
    const table: Record<string, FamilyTableState> = {};
    for (const family of families) {
      geometry[family.key] = open.includes(family.key) ? "open" : "closed";
      table[family.key] = "absent";
    }
    const active = open[0] ?? families[0]?.key ?? null;
    set((s) => ({
      layers: {
        ...s.layers,
        [layerId]: {
          families,
          enabled: new Set(open),
          opened: open,
          active,
          geometry,
          table,
          reopen: { state: "idle" },
          generation: (s.layers[layerId]?.generation ?? 0) + 1,
        },
      },
    }));
    // Ruling S3: the active family's whole-file answer must exist before any
    // reader could have shown a resident snapshot instead. Fire-and-forget —
    // `ensureFamilyView` never throws and records its own failure.
    if (active !== null) {
      seedFamilyView(layerId, active);
      void ensureActiveFamilyView(layerId, active);
    }
  },

  forgetLayer: (layerId) =>
    set((s) => {
      const entry = s.layers[layerId];
      if (!entry) return s;
      const layers = { ...s.layers };
      delete layers[layerId];
      // The generation the removed entry held is remembered in `farewells`, so a
      // reopen still in flight can tell that its layer went.
      farewells.set(layerId, entry.generation + 1);
      return { layers };
    }),

  setActiveFamily: (layerId, family) => {
    set((s) =>
      patchLayer(s, layerId, (entry) => ({ ...entry, active: family })),
    );
    seedFamilyView(layerId, family);
    void ensureActiveFamilyView(layerId, family);
  },

  setFamilyTableState: (layerId, family, state) =>
    set((s) =>
      patchLayer(s, layerId, (entry) => ({
        ...entry,
        table: { ...entry.table, [family]: state },
      })),
    ),

  setFamilyGeometryState: (layerId, family, state) =>
    set((s) =>
      patchLayer(s, layerId, (entry) => ({
        ...entry,
        geometry: { ...entry.geometry, [family]: state },
      })),
    ),

  applyStreamTables: (layerId, openedKeys, tables) =>
    set((s) =>
      patchLayer(s, layerId, (entry) => {
        const counts = new Map<string, number>();
        openedKeys.forEach((key, index) => {
          const row = tables[index];
          if (row !== undefined) counts.set(key, row.rowCount);
        });
        return {
          ...entry,
          families: entry.families.map((family) =>
            counts.has(family.key)
              ? { ...family, rowCount: counts.get(family.key)! }
              : family,
          ),
        };
      }),
    ),
}));

/**
 * Give a family's query state the only reading that can be true of it.
 *
 * The table panel defaults to "Buildings", which filters to root Buildings — a
 * bridge or vegetation table has none, so a family that cannot hold Buildings
 * would open on an empty grid with a footer claiming zero of everything. Written
 * ONCE per family (only while the stored reading is not already raw), so
 * switching away and back keeps the columns the user chose.
 *
 * Here rather than in the panel because the panel is not the only reader: the
 * counts hook, the filter chip and an export all read the same query state, and
 * a default applied in one of them would be a different default in the others.
 *
 * Exported because a RESTORED presentation is written after the family is
 * active, and a saved (or hand-edited) "buildings" reading has to be corrected
 * the same way — an empty grid with no switch to leave it by is the worst of
 * both.
 */
export function seedFamilyView(layerId: string, family: string): void {
  const entry = useFamilyStore.getState().layers[layerId];
  const found = entry?.families.find((f) => f.key === family);
  if (!found || familyOffersBuildings(found)) return;
  const key = layerTableKey(layerId, family);
  if (useQueryStore.getState().queries[key]?.view === "raw") return;
  useQueryStore.getState().setView(key, "raw");
}

/**
 * The generation a layer that has been FORGOTTEN was last at.
 *
 * `forgetLayer` deletes the store entry, so a reopen in flight has nothing left
 * to read its generation from — and "no entry" is indistinguishable from "this
 * layer was never registered", which is the state a reopen for a plain `.fcb`
 * layer would be in. Kept small: one number per removed streaming layer for the
 * life of the page.
 */
const farewells = new Map<string, number>();

/** The generation `layerId` is at, whether or not it still has an entry. */
function generationOf(layerId: string): number {
  const entry = useFamilyStore.getState().layers[layerId];
  if (entry) return entry.generation;
  return farewells.get(layerId) ?? 0;
}

export function resetFamilyStoreForTest(): void {
  useFamilyStore.setState({ layers: {} });
  farewells.clear();
  queues.clear();
}

// ---------------------------------------------------------------------------
// Reading the store
// ---------------------------------------------------------------------------

/** Does `layerId` have object families? The question the table lifecycle asks
 *  before it builds a bare resident table nothing would ever refresh. */
export function hasFamilies(layerId: string): boolean {
  const entry = useFamilyStore.getState().layers[layerId];
  return entry !== undefined && entry.families.length > 0;
}

/**
 * The family every reader for `layerId` must resolve through — `null` for a
 * layer with no families, which is every other layer in the app.
 *
 * `null` is the BARE table key, so a single-table layer keeps the key it has
 * always had and nothing about it changes.
 *
 * PURE in the store's `layers` record, because a consumer that resolves tables
 * for MANY layers at once (the toolbox's candidate list, the eligibility
 * context) has to hold one referentially stable input rather than derive a fresh
 * object per render.
 */
export function activeFamilyOf(
  layers: Readonly<Record<string, LayerFamilyState>>,
  layerId: string,
): string | null {
  const entry = layers[layerId];
  if (!entry || entry.families.length === 0) return null;
  return entry.active;
}

/** {@link activeFamilyOf} against the live store. */
export function getActiveFamily(layerId: string): string | null {
  return activeFamilyOf(useFamilyStore.getState().layers, layerId);
}

/** {@link getActiveFamily} as a hook, for the readers React renders. */
export function useActiveFamily(layerId: string | null): string | null {
  return useFamilyStore((s) =>
    layerId === null ? null : activeFamilyOf(s.layers, layerId),
  );
}

/**
 * The rows the OPENED families hold, or `null` when this layer has no families —
 * or when one opened family has not learnt its size yet, which is a total nobody
 * can state rather than a smaller one.
 *
 * The honest denominator of "N of M" for a package: ruling R-D opens Building
 * alone, so measuring the loaded objects against every family would read as a
 * stream that has barely started and would never reach its own total. ONE rule,
 * exported, because the status bar and the details panel both need it and two
 * copies is how they come to disagree.
 */
export function openedFamilyRows(
  entry: LayerFamilyState | undefined,
): number | null {
  if (entry === undefined || entry.families.length === 0) return null;
  // NOTHING open — a failed reopen — is not a total of zero: the stream header
  // still describes what this layer had, and a "0 of 0" beside a scene being
  // rebuilt says less than the number it replaces.
  if (entry.opened.length === 0) return null;
  let sum = 0;
  for (const key of entry.opened) {
    const family = entry.families.find((f) => f.key === key);
    if (family?.rowCount === undefined || family.rowCount === null) return null;
    sum += family.rowCount;
  }
  return sum;
}

/** Does this layer have object families at all? The reactive form of
 *  {@link hasFamilies}, for a component that words itself differently for a
 *  file-backed family table than for a resident one. */
export function useHasFamilies(layerId: string | null): boolean {
  return useFamilyStore((s) =>
    layerId === null ? false : (s.layers[layerId]?.families.length ?? 0) > 0,
  );
}

/** {@link openedFamilyRows} for one layer, as a hook. */
export function useOpenedFamilyRows(layerId: string | null): number | null {
  return useFamilyStore((s) =>
    layerId === null ? null : openedFamilyRows(s.layers[layerId]),
  );
}

/**
 * One family's TABLE state, or `null` when the layer has no families (or that
 * family is not one of them).
 *
 * `null` is what every other layer in the app answers, and it is what tells a
 * reader "the registry is the whole story here" — a family, by contrast, can have
 * no table at all until somebody asks for one.
 */
export function useFamilyTableState(
  layerId: string | null,
  family: string | null,
): FamilyTableState | null {
  return useFamilyStore((s) =>
    layerId === null || family === null
      ? null
      : (s.layers[layerId]?.table[family] ?? null),
  );
}

/**
 * The key a layer's TABLE and its QUERY are both kept under (R-C′):
 * `${layerId}::${family}` for a CityParquet family, the bare layer id for every
 * other layer.
 *
 * ONE spelling for both registries on purpose. Two families of one layer are two
 * tables with two column lists, so they need two query states — a sort or a
 * predicate written against one family's columns is meaningless against the
 * other's — and a second way of naming "this layer's current table" is how the
 * grid and the footer come to disagree about which one they are describing.
 */
export function getActiveTableKey(layerId: string): string {
  return layerTableKey(layerId, getActiveFamily(layerId));
}

/** {@link getActiveTableKey} as a hook. `null` in, `null` out, so a component
 *  with no active layer needs no placeholder key. */
export function useActiveTableKey(layerId: string | null): string | null {
  return useFamilyStore((s) =>
    layerId === null
      ? null
      : layerTableKey(layerId, activeFamilyOf(s.layers, layerId)),
  );
}

// ---------------------------------------------------------------------------
// The family's view
// ---------------------------------------------------------------------------

/**
 * Make sure `family`'s table exists, and record what happened on the family.
 *
 * Idempotent: `ensureFamilyView` replaces a view in place, and a family whose
 * view is already there — or already being built — is left alone, so a table
 * button pressed twice does not queue two DESCRIBEs behind the one FIFO every
 * table build shares.
 *
 * THE REGISTRY IS THE AUTHORITY on "already there", never this store's own
 * `table` state. An engine death condemns every view
 * (`layerTables.invalidateTablesOnEngineDeath`) without telling the family
 * store, whose entry goes on reading `ready` — and since ruling S3 took the bare
 * resident table away, gating on that would leave a streamed CityParquet layer
 * with NO table at all for the rest of the session, through a Retry and
 * everything after it. `creating` is still read from here, because it is the only
 * record of a build in flight.
 */
export async function ensureActiveFamilyView(
  layerId: string,
  family: string,
): Promise<void> {
  const entry = useFamilyStore.getState().layers[layerId];
  const found = entry?.families.find((f) => f.key === family);
  if (!entry || !found) return;
  if (getLayerTable(layerId, family)?.fileBacked === true) {
    // The view really is there. Say so, in case a death-and-revival left this
    // store's own record behind.
    if (entry.table[family] !== "ready") {
      useFamilyStore.getState().setFamilyTableState(layerId, family, "ready");
    }
    return;
  }
  if (entry.table[family] === "creating") return;
  const generation = entry.generation;
  useFamilyStore.getState().setFamilyTableState(layerId, family, "creating");
  // THE FILE's own CRS, never the stream's (ruling S2). The view reads the file,
  // so its `bbox` is in the file's coordinates — degrees for PLATEAU — while the
  // stream header and the layer's metadata both carry the PROJECTED target the
  // scene is drawn in. Recording that one would claim metres for a table
  // measured in degrees, which is precisely what the metric-bounds refusal
  // exists to prevent. Cached per source, and `null` when the file does not say.
  const sourceCrs = await familySourceCrs(found.source);
  // CHECKED BEFORE the ensure, not only after it. `ensureFamilyView` captures
  // its own supersession baselines when it is CALLED, so a removal that landed
  // during the footer read is invisible to it: it would register the file,
  // create the view and publish a `ready` table for a layer that is gone, and
  // the guard below would only suppress the store write. This is the one window
  // the awaited CRS opened.
  if (generationOf(layerId) !== generation) return;
  const outcome = await ensureFamilyView({
    layerId,
    family,
    source: found.source,
    sourceCrs,
  });
  // The layer may have gone, or its families been republished, while the view
  // was being built; `setFamilyTableState` is a no-op for a missing layer, but a
  // stale generation would otherwise mark a DIFFERENT package's family ready.
  if (generationOf(layerId) !== generation) return;
  useFamilyStore
    .getState()
    .setFamilyTableState(layerId, family, outcome.ok ? "ready" : "failed");
}

// ---------------------------------------------------------------------------
// The transactional reopen (R-E′)
// ---------------------------------------------------------------------------

export type FamilyToggleOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * One promise chain per layer.
 *
 * Strictly serialised, and the queued job re-reads the DESIRED set when its turn
 * comes: two rapid toggles therefore cost ONE reopen (the first job opens what
 * the user ended up asking for, the second finds nothing to do), and there is
 * never an in-flight open for a later toggle to supersede. The alternative —
 * letting a second toggle overtake the first — would need the first's completion
 * disposed, and the only safe disposal is `plugin.remove`, which would also tear
 * down the layer the second open had just registered.
 */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(layerId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(layerId) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    layerId,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

const NOT_FOUND: FamilyToggleOutcome = {
  ok: false,
  message: "That layer has no object families.",
};

/**
 * Open or close one family's geometry, reopening the stream under the same
 * layer id (R-E′).
 *
 * The enabled set moves SYNCHRONOUSLY, so the UI answers the click immediately
 * and a second click is taken against the state the user can see; the reopen
 * then follows on the layer's own queue. A failure rolls the set back to what is
 * actually open and leaves a `failed` reopen for {@link retryFamilyReopen}.
 */
export function setFamilyEnabled(input: {
  readonly plugin: StreamPlugin;
  readonly layerId: string;
  readonly family: string;
  readonly enabled: boolean;
}): Promise<FamilyToggleOutcome> {
  const { plugin, layerId, family, enabled } = input;
  const entry = useFamilyStore.getState().layers[layerId];
  if (!entry || !entry.families.some((f) => f.key === family)) {
    return Promise.resolve(NOT_FOUND);
  }
  const wanted = new Set(entry.enabled);
  if (enabled) wanted.add(family);
  else wanted.delete(family);
  if (wanted.size === 0) {
    // A layer with nothing open has no stream to reopen: `openStream` over an
    // empty source list fails, and a "failed reopen" is the wrong story for a
    // click that simply cannot be honoured. The UI keeps the last family's
    // toggle disabled; this is the guard behind it.
    return Promise.resolve({
      ok: false,
      message: "At least one object family has to stay open.",
    });
  }
  useFamilyStore.setState((s) =>
    patchLayer(s, layerId, (current) => ({
      ...current,
      enabled: wanted,
      geometry: {
        ...current.geometry,
        [family]: enabled ? "opening" : "closed",
      },
    })),
  );
  return enqueue(layerId, () => runReopen(plugin, layerId));
}

/** Try a failed reopen again, with the enabled set as it stands. */
export function retryFamilyReopen(input: {
  readonly plugin: StreamPlugin;
  readonly layerId: string;
}): Promise<FamilyToggleOutcome> {
  const { plugin, layerId } = input;
  if (useFamilyStore.getState().layers[layerId] === undefined) {
    return Promise.resolve(NOT_FOUND);
  }
  return enqueue(layerId, () => runReopen(plugin, layerId));
}

/**
 * Bring the stream into line with the DESIRED set — the queued half of a toggle.
 *
 * Reads the store when its turn comes, not when it was enqueued, so it is the
 * one place that knows what the user actually ended up asking for.
 */
async function runReopen(
  plugin: StreamPlugin,
  layerId: string,
): Promise<FamilyToggleOutcome> {
  const entry = useFamilyStore.getState().layers[layerId];
  if (!entry) return NOT_FOUND;
  const wanted = entry.families
    .filter((f) => entry.enabled.has(f.key))
    .map((f) => f.key);
  if (wanted.length === 0) return NOT_FOUND;
  // Nothing to do: an earlier job in this chain already opened what the user
  // wants (two rapid toggles), or they toggled back before its turn came.
  const sameAsOpen =
    wanted.length === entry.opened.length &&
    wanted.every((key, i) => entry.opened[i] === key);
  if (sameAsOpen) {
    // A FAILURE cannot reach here: it sets `opened` to `[]`, so a desired set
    // that matches what is open really is open. Still worth clearing a stale
    // reopen state — a `reopening` left by a superseded job, say.
    if (entry.reopen.state !== "idle") {
      useFamilyStore.setState((s) =>
        patchLayer(s, layerId, (current) => ({
          ...current,
          reopen: { state: "idle" },
        })),
      );
    }
    return { ok: true };
  }

  const generation = entry.generation;
  useFamilyStore.setState((s) =>
    patchLayer(s, layerId, (current) => ({
      ...current,
      reopen: { state: "reopening" },
    })),
  );
  const families = entry.families.filter((f) => wanted.includes(f.key));
  const outcome = await reopenStreamingLayer(
    plugin,
    layerId,
    streamSourceOf(families),
    { isSuperseded: () => generationOf(layerId) !== generation },
  );

  if (generationOf(layerId) !== generation) {
    // The layer went while the worker was booting. `reopenStreamingLayer` has
    // already disposed the handle it made; there is no state left to write.
    return { ok: false, message: outcome.ok ? "" : outcome.message };
  }

  if (!outcome.ok) {
    // A failed reopen leaves NO stream: the old handle was removed before the
    // open was attempted, so nothing is rendering. `opened` says so — it is
    // "what the live stream is open with", and claiming the previous set here
    // would make a toggle-on-then-off read as "the desired set is already open"
    // and quietly clear the failure, leaving a layer with no geometry, no
    // `failed` state and no Retry.
    //
    // The ROLLBACK is `enabled`, which goes back to the set that was working, so
    // the UI never claims a family is on that the user never asked for and Retry
    // has a coherent set to reopen. Those families read `failed` rather than
    // `closed`: nothing is drawing them, and that is not the user's doing.
    //
    // WHEN NOTHING WAS OPEN — a SECOND consecutive failure, over a flaky server —
    // the rollback target is the DESIRED set instead. Rolling back to the empty
    // `opened` the first failure left would empty `enabled` too, and the next
    // attempt would find no families to open at all: `runReopen` bails with "that
    // layer has no object families", writing no state, so Retry is inert for the
    // rest of the session and closing a family answers "at least one has to stay
    // open" while nothing is open.
    const rolledBack = entry.opened.length > 0 ? entry.opened : wanted;
    useFamilyStore.setState((s) =>
      patchLayer(s, layerId, (current) => ({
        ...current,
        enabled: new Set(rolledBack),
        opened: [],
        geometry: geometryFor(current.families, [], rolledBack),
        reopen: { state: "failed", message: outcome.message },
      })),
    );
    return outcome;
  }

  useFamilyStore.setState((s) =>
    patchLayer(s, layerId, (current) => ({
      ...current,
      opened: wanted,
      geometry: geometryFor(current.families, wanted),
      reopen: { state: "idle" },
    })),
  );
  // The header the reopen got carries a row count PER OPENED FILE, so a family
  // enabled after the first open learns its size here — otherwise it would read
  // as unknown for the rest of the session. By ARRAY ORDER against `wanted`,
  // which is the order the source list was built in.
  const tables = useStreamStore.getState().streams[layerId]?.header.tables;
  if (tables !== undefined) {
    useFamilyStore.getState().applyStreamTables(layerId, wanted, tables);
  }
  // A family that is open now can have its table browsed without waiting for a
  // button; the newly active one, if the user had never opened it, gets its view
  // here.
  const active = useFamilyStore.getState().layers[layerId]?.active ?? null;
  if (active !== null) void ensureActiveFamilyView(layerId, active);
  return { ok: true };
}

/**
 * Every family's geometry state for a given open list.
 *
 * `failedKeys` are the families a FAILED reopen was meant to be showing: nothing
 * is drawing them and the user did not close them, so `failed` is the honest
 * answer and `closed` would be a lie the Retry button then contradicts.
 */
function geometryFor(
  families: ReadonlyArray<LayerFamily>,
  open: ReadonlyArray<string>,
  failedKeys: ReadonlyArray<string> = [],
): Record<string, FamilyGeometryState> {
  const out: Record<string, FamilyGeometryState> = {};
  for (const family of families) {
    out[family.key] = open.includes(family.key)
      ? "open"
      : failedKeys.includes(family.key)
        ? "failed"
        : "closed";
  }
  return out;
}

/**
 * Give up one family's table without touching its geometry.
 *
 * The other half of "a family's table is independent of what is resident": a
 * user who closed a family's geometry may still be reading its table, so
 * dropping the view is a separate, explicit act (Task 4's panel). Routed through
 * `dropFamilyView` so the file registration behind the view goes with it —
 * dropping through `layerTables` alone would leave a dropped VFS name cached,
 * and the next ensure would build a view over zero bytes.
 */
export async function dropFamilyTable(
  layerId: string,
  family: string,
): Promise<void> {
  useFamilyStore.getState().setFamilyTableState(layerId, family, "absent");
  await dropFamilyView(layerId, family);
}
