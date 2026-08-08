/**
 * Hook for loading city model files into the layer store.
 *
 * Extracts the file-loading logic from the app shell so it can be
 * reused by both the landing page and the "add layer" UI.
 */

import { useCallback, useRef, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import {
  parseText,
  loadFromUrl,
  fileNameFromUrl,
  decodeModelBytes,
} from "../../domain/citymodel/loadCityModel";
import {
  cityParquetLayerNameFromUrl,
  loadCityParquetFromFiles,
  loadCityParquetFromUrl,
} from "../cityparquet/loadCityParquet";
import { isCityParquetUrl } from "../cityparquet/sourceClassify";
import { ensureModelCrsLoadable } from "./ensureCrs";
import { useLayerStore } from "./layerStore";
import { openStreamingLayer } from "../streaming/openStreamingLayer";
import {
  requireStreamPlugin,
  type StreamPlugin,
} from "../streaming/streamPlugin";
import type { Rule } from "../rules/types";

/** Optional per-layer settings to apply instead of the usual fresh-layer
 *  defaults (rules: [], rulesEnabled: true, visible: true, lodMode: "auto")
 *  — used when re-linking a file to a layer restored from a snapshot, so
 *  the saved rules/visibility/LoD survive the re-selection (see App.tsx's
 *  "unavailable layers" resolve flow). */
export interface LayerOverrides {
  readonly rules?: ReadonlyArray<Rule>;
  readonly rulesEnabled?: boolean;
  readonly visible?: boolean;
  readonly lodMode?: "auto" | "manual";
  readonly selectedLod?: string | null;
  /** Applied at creation, not afterwards: the layer is built (or its first
   *  cell fetched) already filtered. */
  readonly hiddenTypes?: ReadonlyArray<string>;
}

function applyPostCreateOverrides(
  layerId: string,
  overrides: LayerOverrides | undefined,
): void {
  if (!overrides) return;
  if (overrides.lodMode === "manual") {
    useLayerStore.getState().setLodMode(layerId, "manual");
  }
  if (overrides.selectedLod !== undefined && overrides.selectedLod !== null) {
    const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
    // Only apply a saved LoD that actually exists on the (possibly
    // different) file being re-linked — an invalid value would silently
    // pin a LoD the new content never renders.
    if (layer?.availableLods.includes(overrides.selectedLod)) {
      useLayerStore.getState().setLayerLod(layerId, overrides.selectedLod);
    }
  }
}

/**
 * The layer name for a picked CityParquet package.
 *
 * A folder picker sets `webkitRelativePath` to "<folder>/…", so the first
 * segment is the folder the user chose — the name they will recognise. A
 * drag-and-drop selection carries no relative path at all, and there the first
 * file's own name is the only thing to go on.
 */
function packageNameFromFiles(files: ReadonlyArray<File>): string {
  const first = files[0];
  if (first === undefined) return "CityParquet package";
  const relative =
    typeof first.webkitRelativePath === "string"
      ? first.webkitRelativePath
      : "";
  return relative.split("/").filter((s) => s !== "")[0] ?? first.name;
}

export interface LayerFileLoader {
  addLayerFromFile: (
    file: File,
    overrides?: LayerOverrides,
  ) => Promise<string | null>;
  /**
   * Load SEVERAL picked files as ONE layer — a CityParquet package, whose
   * object tables are separate files but one model in one frame.
   */
  addLayerFromFiles: (
    files: ReadonlyArray<File>,
    overrides?: LayerOverrides,
  ) => Promise<string | null>;
  addLayerFromUrl: (url: string) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  /**
   * The message behind the most recent failure, readable SYNCHRONOUSLY after
   * an add resolves null. `error` is React state, so a caller that just
   * awaited `addLayerFromUrl` cannot read the fresh value from its own
   * closure — and the catalog browser needs the sentence, not a boolean, to
   * tell the user WHY an item did not land ("Unsupported CityJSON version
   * …" reads very differently from "unreachable"). Cleared whenever a new
   * load starts.
   *
   * KEYED by the source (the url or file name the add was asked for): the
   * catalog fires several adds concurrently, and a single shared slot would
   * let item A's line quote item B's reason when both fail in the same
   * drain. Passing a `source` returns the message only if the last failure
   * was for THAT source; passing none returns whatever failed last.
   */
  lastError: (source?: string) => string | null;
  clearError: () => void;
}

export interface LayerFileLoaderOptions {
  /**
   * How to obtain the live FlatCityBuf plugin for a `.fcb` source.
   *
   * A promise, not an instance: a viewport that is still starting hands the
   * plugin out through `CitySceneHandle.getStreamingPlugin()`, which QUEUES
   * behind its `ready` gate instead of failing a `.fcb` opened during the
   * first render (Task C13). Defaults to `requireStreamPlugin()`, which throws
   * a user-facing "the 3D engine is not running yet" for a caller that has no
   * viewport to ask — the error state below surfaces either one identically.
   */
  readonly resolveStreamPlugin?: () => Promise<StreamPlugin>;
}

const defaultResolveStreamPlugin = async (): Promise<StreamPlugin> =>
  requireStreamPlugin();

export function useLayerFileLoader(
  options: LayerFileLoaderOptions = {},
): LayerFileLoader {
  const [loading, setLoading] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  // A per-source MAP, not a mirror of the single error state: the catalog
  // fires several adds concurrently, and with one shared slot either add B's
  // failure overwrites add A's sentence (mis-attribution) or add B's opening
  // `clearError` erases it before A's caller reads it (a race the await
  // interleaving genuinely allows). Entries are only ever READ for a source
  // that just failed, so successes never consult a stale one; `clearError`
  // clears the visible state but deliberately leaves the map alone.
  const errorBySourceRef = useRef(new Map<string, string>());
  const setError = useCallback(
    (message: string | null, source?: string): void => {
      if (message !== null && source !== undefined) {
        // Delete-then-set so a RETRY moves its entry to the end — a re-`set`
        // alone keeps the key's original position, and the no-source read
        // below takes "last inserted" as "most recent".
        errorBySourceRef.current.delete(source);
        errorBySourceRef.current.set(source, message);
      }
      setErrorState(message);
    },
    [],
  );
  // Through a ref, so an inline `resolveStreamPlugin={() => …}` cannot change
  // the identity of the two loaders below — `App.tsx` lists them in dependency
  // arrays, and a new function per render would re-run those effects.
  const resolveStreamPlugin = useRef(
    options.resolveStreamPlugin ?? defaultResolveStreamPlugin,
  );
  resolveStreamPlugin.current =
    options.resolveStreamPlugin ?? defaultResolveStreamPlugin;

  const addLayerFromFile = useCallback(
    async (file: File, overrides?: LayerOverrides): Promise<string | null> => {
      setError(null);
      setLoading(true);
      try {
        let layerId: string;
        const encoding = detectEncoding(file.name);
        if (encoding === "flatcitybuf") {
          // A `File` IS a `Blob` — passed straight through, never read into
          // an ArrayBuffer first (see openStreamingLayer.ts's doc comment
          // on why fromBytes' copy would OOM a multi-GB local file).
          layerId = await openStreamingLayer({
            plugin: await resolveStreamPlugin.current(),
            source: { blob: file },
            name: file.name,
            modelRef: { type: "file", fileName: file.name },
            rules: overrides?.rules,
            rulesEnabled: overrides?.rulesEnabled,
            visible: overrides?.visible,
            hiddenTypes: overrides?.hiddenTypes,
          });
        } else if (encoding === "cityparquet") {
          // A lone `.parquet` drop is a one-table package — the same loader as
          // a picked folder, given a selection of one.
          const model = await loadCityParquetFromFiles([file]);
          await ensureModelCrsLoadable(model);
          layerId = useLayerStore.getState().addLayer({
            name: file.name,
            model,
            modelRef: { type: "file", fileName: file.name },
            visible: overrides?.visible ?? true,
            rules: overrides?.rules ?? [],
            rulesEnabled: overrides?.rulesEnabled ?? true,
            hiddenTypes: overrides?.hiddenTypes,
          });
        } else {
          // Bytes, not `file.text()`: a dropped `.city.json.gz` — the form 3D
          // BAG ships in, and therefore the form a user saves off the catalog
          // — would otherwise reach the parser as mojibake. `decodeModelBytes`
          // decides on the MAGIC BYTES, so an uncompressed file still takes the
          // plain UTF-8 path.
          const text = await decodeModelBytes(
            new Uint8Array(await file.arrayBuffer()),
          );
          const parsed: CityModel = parseText(file.name, text);
          // Fetch-and-gate the CRS while we are still async — a refusal here
          // reads as a load error instead of a dead layer in the scene sync.
          await ensureModelCrsLoadable(parsed);
          layerId = useLayerStore.getState().addLayer({
            name: file.name,
            model: parsed,
            modelRef: { type: "file", fileName: file.name },
            visible: overrides?.visible ?? true,
            rules: overrides?.rules ?? [],
            rulesEnabled: overrides?.rulesEnabled ?? true,
            hiddenTypes: overrides?.hiddenTypes,
          });
        }
        applyPostCreateOverrides(layerId, overrides);
        return layerId;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to parse file.",
          file.name,
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [setError],
  );

  const addLayerFromFiles = useCallback(
    async (
      files: ReadonlyArray<File>,
      overrides?: LayerOverrides,
    ): Promise<string | null> => {
      setError(null);
      setLoading(true);
      try {
        const name = packageNameFromFiles(files);
        const model = await loadCityParquetFromFiles(files);
        await ensureModelCrsLoadable(model);
        const layerId = useLayerStore.getState().addLayer({
          name,
          model,
          // The FOLDER is the source, so that is what a snapshot records as
          // needing re-selection — no single file could re-link this layer.
          modelRef: { type: "file", fileName: name },
          visible: overrides?.visible ?? true,
          rules: overrides?.rules ?? [],
          rulesEnabled: overrides?.rulesEnabled ?? true,
          hiddenTypes: overrides?.hiddenTypes,
        });
        applyPostCreateOverrides(layerId, overrides);
        return layerId;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load the picked files.",
          packageNameFromFiles(files),
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [setError],
  );

  const addLayerFromUrl = useCallback(
    async (url: string): Promise<string | null> => {
      setError(null);
      setLoading(true);
      try {
        if (detectEncoding(url) === "flatcitybuf") {
          return await openStreamingLayer({
            plugin: await resolveStreamPlugin.current(),
            source: { url },
            name: fileNameFromUrl(url),
            modelRef: { type: "url", url },
          });
        }

        // `isCityParquetUrl`, not `detectEncoding`: a bucket pattern or a
        // package directory has no extension to detect. The predicate is TOTAL
        // and answers true for an unlistable https wildcard as well, so the
        // classifier's explanation of why it cannot be served is thrown from
        // the load below and lands in `error` — which is the point.
        if (isCityParquetUrl(url)) {
          const model = await loadCityParquetFromUrl(url);
          await ensureModelCrsLoadable(model);
          return useLayerStore.getState().addLayer({
            name: cityParquetLayerNameFromUrl(url),
            model,
            modelRef: { type: "url", url },
            visible: true,
            rules: [],
            rulesEnabled: true,
          });
        }

        const parsed = await loadFromUrl(url);
        await ensureModelCrsLoadable(parsed);
        return useLayerStore.getState().addLayer({
          name: fileNameFromUrl(url),
          model: parsed,
          modelRef: { type: "url", url },
          visible: true,
          rules: [],
          rulesEnabled: true,
        });
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load remote file.",
          url,
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [setError],
  );

  const clearError = useCallback(() => setError(null), [setError]);
  const lastError = useCallback((source?: string): string | null => {
    if (source !== undefined) {
      return errorBySourceRef.current.get(source) ?? null;
    }
    // No source: the most recent failure of any kind, straight off the map's
    // insertion order (a Map iterates oldest-first).
    let latest: string | null = null;
    for (const message of errorBySourceRef.current.values()) latest = message;
    return latest;
  }, []);

  return {
    addLayerFromFile,
    addLayerFromFiles,
    addLayerFromUrl,
    loading,
    error,
    lastError,
    clearError,
  };
}
