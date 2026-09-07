/**
 * The ONE door every static city layer goes through.
 *
 * `addLayer` alone is not enough any more: a layer without its DuckDB table is
 * a layer with no table panel, no filter and no export, and there are SIX
 * places that add one (a dropped file, a picked folder, a URL, a snapshot
 * restore, a share link, and a re-linked unavailable layer). Routing them all
 * through here is what makes "layer tables are rebuilt on restore by the same
 * add path" true rather than aspirational.
 *
 * Streaming layers do NOT come through here — they are added by
 * `openStreamingLayer`, and their table is enqueued by the lifecycle module
 * when it sees the new layer, because their rows arrive cell by cell.
 */

import type { AppearanceTheme } from "@cityjson/navara-core";
import type { CityModel } from "../../domain/citymodel/types";
import {
  decodeModelBytes,
  fetchModelBytes,
  isGzipBytes,
} from "../../domain/citymodel/loadCityModel";
import type { CityModelReference } from "../../persistence/types";
import {
  enqueueLayerTable,
  type LayerTableSource,
  type SourceProvider,
} from "../../insights/layerTables";
import type { Rule } from "../rules/types";
import { useLayerStore } from "./layerStore";
import type { ColorBy } from "../rules/colorBy";

export interface AddCityLayerInput {
  readonly name: string;
  readonly model: CityModel;
  readonly modelRef: CityModelReference;
  readonly visible?: boolean;
  readonly rules?: ReadonlyArray<Rule>;
  /** A restored "Color by" choice. Absent means DERIVED from {@link rules} —
   *  see `layerStore.addLayer` and `rules/colorBy.ts`. */
  readonly colorBy?: ColorBy;
  readonly singleColor?: string;
  readonly unmatchedColor?: string;
  readonly hiddenTypes?: ReadonlyArray<string>;
  readonly selectedAppearance?: AppearanceTheme | null;
  /** What DuckDB should build this layer's table from. */
  readonly duckdb: LayerTableSource;
}

/** Re-fetch a URL layer's DECODED bytes for an export — `fetchModelBytes`
 *  gunzips on the magic bytes, so this returns exactly what the table was
 *  built from. The browser cache usually serves the request, and the
 *  alternative — holding every loaded file in the JS heap for the session —
 *  is what the VFS drop exists to avoid. */
export function urlSourceProvider(url: string): SourceProvider {
  return () => fetchModelBytes(url);
}

/**
 * Re-read a dropped file, decoded the same way.
 *
 * A `File` is a REFERENCE to something on disk, not a copy in memory, so
 * keeping one costs nothing — but it does not survive a reload, which is why a
 * layer restored from a snapshot is presented as "unavailable" rather than
 * silently given a provider that cannot work.
 *
 * Reads afresh on every call (`registerBuffer` CONSUMES what it is given, and
 * a provider may be called more than once), and only re-encodes when the file
 * really was gzipped: for the ordinary case the bytes read from disk already
 * ARE the decoded bytes.
 */
export function fileSourceProvider(file: File): SourceProvider {
  return async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isGzipBytes(bytes)) return bytes;
    return new TextEncoder().encode(await decodeModelBytes(bytes));
  };
}

/**
 * What DuckDB should build this layer's table from.
 *
 * Reader-backed whenever we HAVE decoded bytes for a format the cityjson
 * extension reads; the flat fallback otherwise — CityGML (and its ZIP), and
 * anything whose bytes we never held.
 *
 * `bytes` is handed straight through, never copied: `registerBuffer` CONSUMES
 * it, so the caller passes an array it is finished with. `loadFromUrl` and the
 * file loader both hand over the array they fetched or read whenever it was
 * not gzipped, and allocate a second one only when a gunzip really happened.
 */
export function modelTableSource(input: {
  readonly model: CityModel;
  readonly bytes: Uint8Array | null;
  readonly encoding: "cityjson" | "cityjsonseq" | "citygml";
  readonly refetch: SourceProvider | null;
}): LayerTableSource {
  if (input.bytes === null || input.encoding === "citygml") {
    return { kind: "model", model: input.model };
  }
  return input.encoding === "cityjsonseq"
    ? {
        kind: "bytes",
        bytes: input.bytes,
        reader: "read_cityjsonseq",
        extension: "city.jsonl",
        provider: input.refetch,
      }
    : {
        kind: "bytes",
        bytes: input.bytes,
        reader: "read_cityjson",
        extension: "city.json",
        provider: input.refetch,
      };
}

/**
 * Add a static city layer and start building its DuckDB table.
 *
 * The enqueue is FIRE AND FORGET on purpose: a DuckDB failure is recorded on
 * the table entry and shown in the panel, and must never fail a layer add.
 * `enqueueLayerTable` already settles rather than throwing for a build that
 * fails, so the guards here are for the cases it cannot handle — an engine
 * that is not running at all — and exist so neither a rejection nor a throw
 * can escape once the layer is already in the store.
 *
 * BOTH guards, not just the `.catch`: `enqueueLayerTable` runs a synchronous
 * prelude (the sequence counter, the registry lookup, the first `setState`)
 * before it returns its promise, so a throw from there would never reach a
 * `.catch` — it would propagate straight out of `addCityLayer` and fail an add
 * whose layer has ALREADY landed, leaving the caller to report a failure the
 * user can see did not happen.
 */
export function addCityLayer(input: AddCityLayerInput): string {
  const layerId = useLayerStore.getState().addLayer({
    name: input.name,
    model: input.model,
    modelRef: input.modelRef,
    visible: input.visible ?? true,
    rules: input.rules ?? [],
    colorBy: input.colorBy,
    singleColor: input.singleColor,
    unmatchedColor: input.unmatchedColor,
    hiddenTypes: input.hiddenTypes,
    selectedAppearance: input.selectedAppearance,
  });
  const warn = (error: unknown): void => {
    console.warn(
      `DuckDB table for layer ${layerId} could not be started:`,
      error,
    );
  };
  try {
    void enqueueLayerTable(layerId, input.duckdb).catch(warn);
  } catch (error) {
    warn(error);
  }
  return layerId;
}
