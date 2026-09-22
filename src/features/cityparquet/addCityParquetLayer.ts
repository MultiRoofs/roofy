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
import { openStreamingLayer } from "../streaming/openStreamingLayer";
import type { StreamPlugin } from "../streaming/streamPlugin";
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
>;

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
  const open = async (): Promise<string> =>
    openStreamingLayer({
      plugin: await deps.resolveStreamPlugin(),
      format: "cityparquet",
      source: mode.source,
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
