/**
 * The ONE door every city layer opens through.
 *
 * A dropped file, a picked package folder, the Add Layer dialog, a pasted URL,
 * a STAC asset, a snapshot restore, a share link and a re-linked unavailable
 * layer all describe what they want as a {@link CityLayerDescriptor} and hand
 * it here. Each used to carry its own copy of the routing (which format, which
 * loader, which engine hold), and the copies drifted: a restore re-detected
 * from the name and lost the user's correction, a share link applied its LoD
 * on one path and not another.
 *
 * What happens here, in order:
 *  1. the format is decided (`detectFormat`: the descriptor's `encoding`, then
 *     a file's first bytes, then the name);
 *  2. the model reference is built, carrying that format, so a restore opens
 *     the layer the same way;
 *  3. the format's opener runs: streamed (FlatCityBuf, held behind the 3D
 *     engine), by size (CityParquet), or read whole and parsed;
 *  4. the saved LoD choice is applied.
 *
 * A URL read whole whose BYTES turn out to be a streamed format re-routes once
 * to that format's opener (`FormatMismatchError`), unless the user chose the
 * format: their word stands, and the parser then says what is wrong.
 */

import type { AppearanceTheme, CityModelEncoding } from "@cityjson/navara-core";
import {
  SNIFF_BYTES,
  cityFormat,
  detectFormat,
  formatFromName,
} from "../../domain/citymodel/formats";
import type { CityModel } from "../../domain/citymodel/types";
import {
  FormatMismatchError,
  decodeModelBytes,
  fileNameFromUrl,
  isGzipBytes,
  loadFromUrl,
  parseText,
} from "../../domain/citymodel/loadCityModel";
import {
  isZipBytes,
  parseCityGmlArchive,
} from "../../domain/citymodel/cityGmlArchive";
import type { CityModelReference } from "../../persistence/types";
import type { AttributeOrders } from "../attributes/attributeOrder";
import {
  addCityParquetLayerFromFiles,
  addCityParquetLayerFromUrl,
  type CityParquetLayerDeps,
} from "../cityparquet/addCityParquetLayer";
import { cityParquetLayerNameFromUrl } from "../cityparquet/loadCityParquet";
import type { TablePresentation } from "../query/tablePresentation";
import type { ColorBy } from "../rules/colorBy";
import type { Rule } from "../rules/types";
import { openStreamingLayer } from "../streaming/openStreamingLayer";
import type { StreamPlugin } from "../streaming/streamPlugin";
import {
  addCityLayer,
  fileSourceProvider,
  modelTableSource,
  urlSourceProvider,
} from "./addCityLayer";
import { ensureModelCrsLoadable } from "./ensureCrs";
import { useLayerStore } from "./layerStore";

/** Where a city layer's bytes are. */
export type CitySource =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly file: File }
  /** Several picked files as ONE layer: a CityParquet package folder. */
  | {
      readonly kind: "files";
      readonly files: ReadonlyArray<File>;
      /** The folder's name, which a snapshot records for the re-link. */
      readonly name: string;
    };

/**
 * A layer's settings, applied at creation. Every field optional: absent means
 * the fresh-layer default. A restore, a share link and a re-link pass what was
 * saved; a fresh add passes little or nothing.
 */
export interface CityLayerSettings {
  readonly name?: string;
  readonly rules?: ReadonlyArray<Rule>;
  /** Absent means DERIVED from {@link rules} (`rules/colorBy.ts`). */
  readonly colorBy?: ColorBy;
  readonly singleColor?: string;
  readonly unmatchedColor?: string;
  readonly visible?: boolean;
  readonly lodMode?: "auto" | "manual";
  readonly selectedLod?: string | null;
  readonly selectedLods?: readonly string[];
  /** Applied at creation, so the layer is built (or its first cell fetched)
   *  already filtered. */
  readonly hiddenTypes?: ReadonlyArray<string>;
  readonly attributeOrders?: AttributeOrders;
  readonly tablePresentation?: TablePresentation;
  /** Kept only if the source carries that theme. */
  readonly selectedAppearance?: AppearanceTheme | null;
  /** A CityParquet package's object-family choice (ruling S4), validated
   *  against the families the open resolves. */
  readonly families?: {
    readonly enabled: ReadonlyArray<string>;
    readonly active: string | null;
  };
}

export interface CityLayerDescriptor {
  readonly source: CitySource;
  /**
   * What the source IS, when someone has said so: the Add Layer dialog's
   * detection or correction, or the format a saved layer was opened as. No
   * byte overrules it.
   */
  readonly encoding?: CityModelEncoding;
  readonly settings?: CityLayerSettings;
}

export interface OpenCityLayerDeps {
  /** The live stream plugin, resolved only when the source streams. */
  readonly resolveStreamPlugin: () => Promise<StreamPlugin>;
  /** Run a streamed open with the 3D engine held up (App's boot hold).
   *  Absent: the open runs as is. */
  readonly holdEngine?: CityParquetLayerDeps["holdEngine"];
}

/** The first bytes of a file, or `null` when they cannot be read (the caller
 *  then decides from the name alone). A `File` slice reads only that much. */
async function readHead(file: Blob): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * The first bytes of a URL, by one ranged request — for a URL whose name says
 * nothing (`https://host/api/asset/42`), so a streamed format is recognised
 * BEFORE anything downloads it whole. `null` when the server cannot answer a
 * range (its body is cancelled, not read) or the request fails: the whole read
 * then decides, as before. A named URL is not probed: its name routes it, and
 * the whole read's own sniff still re-routes a name that lied.
 */
async function readUrlHead(url: string): Promise<Uint8Array | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
    });
    if (response.status !== 206) {
      await response.body?.cancel();
      return null;
    }
    return new Uint8Array(await response.arrayBuffer()).subarray(
      0,
      SNIFF_BYTES,
    );
  } catch {
    return null;
  }
}

function sourceName(source: CitySource, encoding: CityModelEncoding): string {
  switch (source.kind) {
    case "files":
      return source.name;
    case "file":
      return source.file.name;
    case "url":
      return encoding === "cityparquet"
        ? cityParquetLayerNameFromUrl(source.url)
        : fileNameFromUrl(source.url);
  }
}

function modelRefOf(
  source: CitySource,
  encoding: CityModelEncoding,
): CityModelReference {
  switch (source.kind) {
    case "url":
      return { type: "url", url: source.url, encoding };
    case "file":
      return { type: "file", fileName: source.file.name, encoding };
    case "files":
      // The FOLDER is the source, so that is what a snapshot records as
      // needing re-selection — no single file could re-link this layer.
      return { type: "file", fileName: source.name, encoding };
  }
}

async function decideEncoding(
  descriptor: CityLayerDescriptor,
): Promise<CityModelEncoding> {
  const { source, encoding } = descriptor;
  switch (source.kind) {
    case "files":
      // Only a package is several files; nothing else is offered for a group.
      return encoding ?? "cityparquet";
    case "file":
      return detectFormat({
        name: source.file.name,
        head: encoding === undefined ? await readHead(source.file) : null,
        override: encoding,
      });
    case "url": {
      const probe =
        encoding === undefined && formatFromName(source.url) === null;
      return detectFormat({
        name: source.url,
        head: probe ? await readUrlHead(source.url) : null,
        override: encoding,
      });
    }
  }
}

/** Every settings field the layer stores at creation — the part of
 *  {@link CityLayerSettings} that is not applied afterwards. */
function creationSettings(settings: CityLayerSettings) {
  return {
    rules: settings.rules,
    colorBy: settings.colorBy,
    singleColor: settings.singleColor,
    unmatchedColor: settings.unmatchedColor,
    visible: settings.visible,
    hiddenTypes: settings.hiddenTypes,
    attributeOrders: settings.attributeOrders,
    tablePresentation: settings.tablePresentation,
    selectedAppearance: settings.selectedAppearance,
  };
}

/** The saved LoD choice, applied once the layer exists. A single saved LoD is
 *  applied only if the source has it: a re-linked file may differ. */
function applyLodSettings(layerId: string, settings: CityLayerSettings): void {
  const store = useLayerStore.getState();
  if (settings.selectedLods !== undefined) {
    store.setLayerLods(layerId, settings.selectedLods);
  } else if (
    settings.selectedLod !== undefined &&
    settings.selectedLod !== null
  ) {
    const layer = store.layers.find((l) => l.id === layerId);
    if (layer?.availableLods.includes(settings.selectedLod)) {
      store.setLayerLod(layerId, settings.selectedLod);
    }
  }
  if (settings.lodMode === "manual") {
    useLayerStore.getState().setLodMode(layerId, "manual");
  }
}

interface OpenContext {
  readonly source: CitySource;
  readonly encoding: CityModelEncoding;
  /** True when the descriptor named the format: it is then never re-routed. */
  readonly chosen: boolean;
  readonly name: string;
  readonly modelRef: CityModelReference;
  readonly settings: CityLayerSettings;
  readonly deps: OpenCityLayerDeps;
}

async function openFlatCityBuf(ctx: OpenContext): Promise<string> {
  const { source } = ctx;
  if (source.kind === "files") {
    throw new Error("A FlatCityBuf layer is one file, not a folder.");
  }
  const open = async (): Promise<string> =>
    openStreamingLayer({
      plugin: await ctx.deps.resolveStreamPlugin(),
      // A `File` IS a `Blob` — passed straight through, never read into an
      // ArrayBuffer first (a multi-GB local file would not fit).
      source:
        source.kind === "url" ? { url: source.url } : { blob: source.file },
      name: ctx.name,
      modelRef: ctx.modelRef,
      ...creationSettings(ctx.settings),
    });
  return ctx.deps.holdEngine ? ctx.deps.holdEngine(open) : open();
}

async function openCityParquet(ctx: OpenContext): Promise<string> {
  const { source } = ctx;
  const settings = {
    name: ctx.name,
    ...creationSettings(ctx.settings),
    selectedLods: ctx.settings.selectedLods,
    families: ctx.settings.families,
  };
  const deps = {
    resolveStreamPlugin: ctx.deps.resolveStreamPlugin,
    holdEngine: ctx.deps.holdEngine,
  };
  switch (source.kind) {
    case "url":
      // Read whole, or streamed when the source is large — decided there, and
      // again on every restore of this reference.
      return addCityParquetLayerFromUrl(source.url, settings, deps);
    case "file":
      // A lone `.parquet` is a one-table package.
      return addCityParquetLayerFromFiles(
        [source.file],
        source.file.name,
        settings,
        deps,
      );
    case "files":
      return addCityParquetLayerFromFiles(
        source.files,
        source.name,
        settings,
        deps,
      );
  }
}

/** A dropped CityJSON, CityJSONSeq or CityGML file, parsed whole. */
async function openWholeFile(ctx: OpenContext, file: File): Promise<string> {
  // Bytes, not `file.text()`: a dropped `.city.json.gz` would otherwise reach
  // the parser as mojibake. `decodeModelBytes` decides on the MAGIC BYTES.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zipped = isZipBytes(bytes);
  const gzipped = !zipped && isGzipBytes(bytes);
  const text = zipped ? "" : await decodeModelBytes(bytes);
  const model: CityModel = zipped
    ? parseCityGmlArchive(bytes, file.name)
    : parseText(file.name, text, ctx.encoding);
  // Fetch-and-gate the CRS while still async: a refusal reads as a load error
  // instead of a dead layer in the scene sync.
  await ensureModelCrsLoadable(model);
  const tableEncoding =
    zipped || ctx.encoding === "citygml"
      ? "citygml"
      : ctx.encoding === "cityjsonseq"
        ? "cityjsonseq"
        : "cityjson";
  return addCityLayer({
    name: ctx.name,
    model,
    modelRef: ctx.modelRef,
    ...creationSettings(ctx.settings),
    duckdb: modelTableSource({
      model,
      // The array ALREADY READ when nothing was gunzipped: a re-encode would
      // duplicate the whole file, and `registerBuffer` consumes whichever
      // array it gets.
      bytes:
        tableEncoding === "citygml"
          ? null
          : gzipped
            ? new TextEncoder().encode(text)
            : bytes,
      encoding: tableEncoding,
      refetch: fileSourceProvider(file),
    }),
  });
}

async function openWholeUrl(ctx: OpenContext, url: string): Promise<string> {
  const loaded = await loadFromUrl(
    url,
    undefined,
    ctx.chosen ? ctx.encoding : undefined,
  );
  await ensureModelCrsLoadable(loaded.model);
  return addCityLayer({
    name: ctx.name,
    model: loaded.model,
    // The format the BYTES were read as, which may correct the name's guess.
    modelRef: { type: "url", url, encoding: loaded.encoding },
    ...creationSettings(ctx.settings),
    duckdb: modelTableSource({
      model: loaded.model,
      bytes: loaded.bytes,
      encoding: loaded.encoding,
      refetch: urlSourceProvider(url),
    }),
  });
}

async function openAs(ctx: OpenContext): Promise<string> {
  const format = cityFormat(ctx.encoding);
  if (format.adapter === "flatcitybuf") return openFlatCityBuf(ctx);
  if (format.adapter === "cityparquet") return openCityParquet(ctx);
  const { source } = ctx;
  switch (source.kind) {
    case "file":
      return openWholeFile(ctx, source.file);
    case "url":
      return openWholeUrl(ctx, source.url);
    case "files":
      throw new Error(
        `A ${format.label} layer is one file; only a CityParquet package is a folder.`,
      );
  }
}

/**
 * Open a city layer and resolve its id. Throws the loaders' own sentences;
 * the caller (the loader hook's booking, a restore's per-layer catch) decides
 * how to report them.
 */
export async function openCityLayer(
  descriptor: CityLayerDescriptor,
  deps: OpenCityLayerDeps,
): Promise<string> {
  const encoding = await decideEncoding(descriptor);
  const settings = descriptor.settings ?? {};
  const context = (resolved: CityModelEncoding): OpenContext => ({
    source: descriptor.source,
    encoding: resolved,
    chosen: descriptor.encoding !== undefined,
    name: settings.name ?? sourceName(descriptor.source, resolved),
    modelRef: modelRefOf(descriptor.source, resolved),
    settings,
    deps,
  });
  let layerId: string;
  try {
    layerId = await openAs(context(encoding));
  } catch (error) {
    if (
      !(error instanceof FormatMismatchError) ||
      descriptor.encoding !== undefined ||
      error.actual === encoding
    ) {
      throw error;
    }
    layerId = await openAs(context(error.actual));
  }
  applyLodSettings(layerId, settings);
  return layerId;
}
