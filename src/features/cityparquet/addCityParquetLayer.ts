/**
 * Add a CityParquet source as a layer — read whole, or streamed by viewport.
 *
 * ONE implementation for every door a CityParquet source comes through: the
 * loader hook (a pasted URL, a dropped file, a picked folder) and `App.tsx`'s
 * snapshot restore and share-link arms. `modelRef` records only what the user
 * gave (`{type:"url"}` / `{type:"file"}`), so every restore re-runs
 * {@link decideCityParquetMode} here rather than pinning an earlier answer.
 *
 * Static: `loadCityParquet` reads the object tables into one resident model
 * (the table panel and processing see all of it). Stream: the source's object
 * tables open in the CityParquet stream worker behind the FlatCityBuf plugin,
 * and the layer is a stub model filled by viewport commits.
 */
import type { CityModelReference } from "../../persistence/types";
import { browserPlatform } from "../../platform/browser";
import { addCityLayer, type AddCityLayerInput } from "../layers/addCityLayer";
import { ensureModelCrsLoadable } from "../layers/ensureCrs";
import {
  buildLayerFamilies,
  restoredFamilyChoice,
  streamSourceOf,
  useFamilyStore,
} from "../layers/familyStore";
import { dropFamilyViews } from "../../insights/familyViews";
import { openStreamingLayer } from "../streaming/openStreamingLayer";
import type { StreamPlugin } from "../streaming/streamPlugin";
import { useStreamStore } from "../streaming/streamStore";
import {
  loadCityParquetFromFiles,
  loadCityParquetFromUrl,
} from "./loadCityParquet";
import { browserFooterSize, browserHeadLength } from "./sourceSizes";
import { decideCityParquetMode, type CityParquetMode } from "./streamDecision";

/** A layer's settings: everything {@link addCityLayer} takes but the model
 *  and where it came from. A streamed layer takes all of them but
 *  `selectedLods` (its LoDs are discovered as cells arrive). */
export type CityParquetLayerSettings = Omit<
  AddCityLayerInput,
  "model" | "modelRef" | "duckdb"
> & {
  /**
   * A restored workspace's or share link's family choice (ruling S4): which
   * object families were open, and which one the table panel was showing.
   *
   * Absent on a fresh add, which is what the R-D default is for. The keys are
   * validated against the families this open actually resolved
   * (`restoredFamilyChoice`), because the source may have been repackaged since.
   * Ignored on the static path: a below-threshold package is one merged layer
   * with one table, and this milestone is streamed-only.
   */
  readonly families?: {
    readonly enabled: ReadonlyArray<string>;
    readonly active: string | null;
  };
};

export interface CityParquetLayerDeps {
  /** The live stream plugin, resolved only when the source streams. */
  readonly resolveStreamPlugin: () => Promise<StreamPlugin>;
  /**
   * Run a streamed open with the 3D engine held up (App's boot hold). A
   * stream cannot exist without the engine, and a large source added from
   * the landing page has no viewport yet; a static load mounts one as a
   * consequence and needs no hold. Absent: the open runs as is.
   */
  readonly holdEngine?: <T>(open: () => Promise<T>) => Promise<T>;
}

function openStream(
  mode: Extract<CityParquetMode, { mode: "stream" }>,
  modelRef: CityModelReference,
  settings: CityParquetLayerSettings,
  deps: CityParquetLayerDeps,
): Promise<string> {
  const open = async (): Promise<string> => {
    const plugin = await deps.resolveStreamPlugin();
    // MINTED HERE, not by `openStreamingLayer`, because the families have to be
    // published against the layer id BEFORE the row lands: the table lifecycle
    // subscribes to `layerStore` and would otherwise give this layer a bare
    // resident table that nothing may ever refresh once a family view exists
    // (ruling S3).
    const id = crypto.randomUUID();
    const families = buildLayerFamilies(mode.families);
    // A restored choice, validated against what this package actually has — an
    // unknown key is dropped, and a choice that survives as nothing at all reads
    // as `undefined`, which is the R-D default rather than a layer with no
    // stream (ruling S4).
    const restored = restoredFamilyChoice(families, settings.families);
    useFamilyStore.getState().setFamilies(id, families, restored.enabled);
    if (restored.active !== null) {
      useFamilyStore.getState().setActiveFamily(id, restored.active);
    }
    const opened = useFamilyStore.getState().layers[id]?.opened ?? [];
    // ONLY the enabled families' files — Building alone for a PLATEAU package
    // (R-D). The rest are available, and each still gets a table on demand.
    const source = streamSourceOf(
      families.filter((family) => opened.includes(family.key)),
    );
    try {
      const layerId = await openStreamingLayer({
        id,
        plugin,
        format: "cityparquet",
        source,
        name: settings.name,
        modelRef,
        rules: settings.rules,
        colorBy: settings.colorBy,
        singleColor: settings.singleColor,
        unmatchedColor: settings.unmatchedColor,
        visible: settings.visible,
        hiddenTypes: settings.hiddenTypes,
        attributeOrders: settings.attributeOrders,
        tablePresentation: settings.tablePresentation,
        selectedAppearance: settings.selectedAppearance,
      });
      // The header's per-table counts, paired with the families the stream was
      // opened with STRICTLY BY ORDER: `tables[i].name` is a label the reader
      // chose, never an identity.
      const tables = useStreamStore.getState().streams[layerId]?.header.tables;
      if (tables !== undefined) {
        useFamilyStore.getState().applyStreamTables(layerId, opened, tables);
      }
      return layerId;
    } catch (error) {
      // No row was added, so nothing may be left claiming this id has families —
      // and the active family's view, which `setFamilies` started, goes with it.
      useFamilyStore.getState().forgetLayer(id);
      void dropFamilyViews(id);
      throw error;
    }
  };
  return deps.holdEngine ? deps.holdEngine(open) : open();
}

/** Add a CityParquet URL (a table, a package directory, a bucket pattern)
 *  as a layer, streamed when it is large. Resolves the layer id; throws the
 *  loader's own sentences. */
export async function addCityParquetLayerFromUrl(
  url: string,
  settings: CityParquetLayerSettings,
  deps: CityParquetLayerDeps,
): Promise<string> {
  const modelRef: CityModelReference = { type: "url", url };
  const mode = await decideCityParquetMode({
    kind: "url",
    url,
    http: browserPlatform.http,
    headLength: browserHeadLength,
    footerSize: browserFooterSize,
  });
  if (mode.mode === "stream") {
    return openStream(mode, modelRef, settings, deps);
  }
  const model = await loadCityParquetFromUrl(url);
  await ensureModelCrsLoadable(model);
  return addCityLayer({
    ...settings,
    model,
    modelRef,
    duckdb: { kind: "model", model },
  });
}

/** Add picked CityParquet files (one table, or a package folder) as a
 *  layer, streamed when large. `fileName` is what a snapshot records as
 *  needing re-selection. */
export async function addCityParquetLayerFromFiles(
  files: ReadonlyArray<File>,
  fileName: string,
  settings: CityParquetLayerSettings,
  deps: CityParquetLayerDeps,
): Promise<string> {
  const modelRef: CityModelReference = { type: "file", fileName };
  const mode = await decideCityParquetMode({ kind: "files", files });
  if (mode.mode === "stream") {
    return openStream(mode, modelRef, settings, deps);
  }
  const model = await loadCityParquetFromFiles(files);
  await ensureModelCrsLoadable(model);
  return addCityLayer({
    ...settings,
    model,
    modelRef,
    duckdb: { kind: "model", model },
  });
}
