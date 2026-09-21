import { type TablePresentation } from "../query/tablePresentation";
import { type AttributeOrders } from "../attributes/attributeOrder";
/**
 * Hook for loading city model files into the layer store.
 *
 * Extracts the file-loading logic from the app shell so it can be
 * reused by both the landing page and the "add layer" UI.
 */

import type { AppearanceTheme, CityModelEncoding } from "@cityjson/navara-core";
import { useCallback, useRef, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import {
  parseText,
  loadFromUrl,
  fileNameFromUrl,
  decodeModelBytes,
  isGzipBytes,
} from "../../domain/citymodel/loadCityModel";
import {
  cityParquetLayerNameFromUrl,
  loadCityParquetFromFiles,
  loadCityParquetFromUrl,
} from "../cityparquet/loadCityParquet";
import {
  isZipBytes,
  parseCityGmlArchive,
} from "../../domain/citymodel/cityGmlArchive";
import { isCityParquetUrl } from "../cityparquet/sourceClassify";
import { ensureModelCrsLoadable } from "./ensureCrs";
import {
  addCityLayer,
  fileSourceProvider,
  modelTableSource,
  urlSourceProvider,
} from "./addCityLayer";
import { useLayerStore } from "./layerStore";
import { openStreamingLayer } from "../streaming/openStreamingLayer";
import {
  requireStreamPlugin,
  type StreamPlugin,
} from "../streaming/streamPlugin";
import type { Rule } from "../rules/types";
import type { ColorBy } from "../rules/colorBy";

/** Optional per-layer settings to apply instead of the usual fresh-layer
 *  defaults (rules: [], visible: true, lodMode: "auto") — used when re-linking
 *  a file to a layer restored from a snapshot, so the saved
 *  rules/visibility/LoD survive the re-selection (see App.tsx's "unavailable
 *  layers" resolve flow). */
export interface LayerOverrides {
  readonly rules?: ReadonlyArray<Rule>;
  /** A restored "Color by" choice — carried so re-selecting the file behind an
   *  unavailable layer brings its colouring back, not just its rules. Absent
   *  means DERIVED from {@link rules} (`rules/colorBy.ts`). */
  readonly colorBy?: ColorBy;
  readonly singleColor?: string;
  readonly unmatchedColor?: string;
  readonly visible?: boolean;
  readonly lodMode?: "auto" | "manual";
  readonly selectedLod?: string | null;
  readonly selectedLods?: readonly string[];
  /** Applied at creation, not afterwards: the layer is built (or its first
   *  cell fetched) already filtered. */
  readonly hiddenTypes?: ReadonlyArray<string>;
  readonly attributeOrders?: AttributeOrders;
  readonly tablePresentation?: TablePresentation;
  /** Applied at creation; kept only if the file carries that theme. */
  readonly selectedAppearance?: AppearanceTheme | null;
  /**
   * What this source really IS, overriding what its name suggests.
   *
   * The Add Layer dialog detects a format from the name, SHOWS it, and lets
   * the user correct it before anything is loaded — a correction that is worth
   * nothing unless it reaches the routing here (which arm takes the source)
   * and the parser (which reader gets the bytes). Both branches below consult
   * it before `detectEncoding` / `isCityParquetUrl`.
   *
   * It rides in `LayerOverrides` rather than in a parameter of its own so a
   * RETRY keeps it: `runTracked` re-invokes the captured closure, and the
   * overrides are part of that closure.
   */
  readonly encoding?: CityModelEncoding;
}

function applyPostCreateOverrides(
  layerId: string,
  overrides: LayerOverrides | undefined,
): void {
  if (!overrides) return;
  if (overrides.lodMode === "manual") {
    useLayerStore.getState().setLodMode(layerId, "manual");
  }
  if (overrides.selectedLods !== undefined) {
    useLayerStore.getState().setLayerLods(layerId, overrides.selectedLods);
    return;
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
  addLayerFromUrl: (
    url: string,
    overrides?: LayerOverrides,
  ) => Promise<string | null>;
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
  /**
   * The adds that are still in flight, oldest first — one entry per call,
   * added BEFORE the parse starts and removed when it settles either way.
   *
   * The layer list renders these as loading rows. Without them a dropped
   * file is invisible for as long as it takes to parse: the row the user is
   * waiting for only exists once the layer store has a layer, which is the
   * very last step.
   */
  pending: ReadonlyArray<PendingAdd>;
  /**
   * The adds that failed and have not been dismissed.
   *
   * A failure used to leave nothing behind but a transient banner and a row
   * that never appeared. Each entry keeps its own message and its own
   * {@link FailedAdd.retry}, which re-runs THAT add (the same file, the same
   * url) — so several failures in one drop can each be retried on their own.
   */
  failed: ReadonlyArray<FailedAdd>;
  /** Drop one {@link failed} row. Retrying removes its row itself. */
  dismissFailed: (id: string) => void;
}

/** One in-flight add. `id` is internal to this hook (a React key and the
 *  handle {@link LayerFileLoader.dismissFailed} takes), never a layer id —
 *  an add that fails never gets one. */
export interface PendingAdd {
  readonly id: string;
  readonly name: string;
}

export interface FailedAdd {
  readonly id: string;
  readonly name: string;
  readonly message: string;
  /** Re-runs the same add. Removes this row first, so the retry shows as a
   *  {@link LayerFileLoader.pending} row while it runs and a new failed row
   *  only if it fails again.
   *
   *  A property, not a method: `typescript-eslint(unbound-method)` refuses a
   *  method reference passed as a callback, and this one exists only to be
   *  handed to a button's `onClick`. */
  readonly retry: () => void;
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
  const [pending, setPending] = useState<ReadonlyArray<PendingAdd>>([]);
  const [failed, setFailed] = useState<ReadonlyArray<FailedAdd>>([]);
  const nextAddId = useRef(0);
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
  /**
   * The one place an add is BOOKED: it opens a pending row, runs the attempt,
   * and on a throw records the message once — into the visible `error`, into
   * the per-source map behind `lastError`, and as a failed row carrying a
   * `retry` that re-runs this very attempt.
   *
   * The three adds below therefore have no `try`/`catch`/`finally` of their
   * own: each of them used to repeat the same three-line catch with its own
   * fallback sentence, and `loading` was a separate boolean two concurrent
   * adds raced to clear. `loading` is now derived from `pending`, so it is
   * true exactly while something is in flight.
   *
   * Explicitly typed rather than inferred because it names itself (the retry
   * closure), which TypeScript cannot infer through.
   */
  const runTracked: (
    entry: { name: string; source: string; fallback: string },
    attempt: () => Promise<string | null>,
  ) => Promise<string | null> = useCallback(
    async (entry, attempt) => {
      const id = `add-${(nextAddId.current += 1)}`;
      setError(null);
      setPending((rows) => [...rows, { id, name: entry.name }]);
      try {
        return await attempt();
      } catch (e) {
        // `(… && e.message) ||`, not a plain ternary: a rejection carrying an
        // Error with an EMPTY message (a bare `new Error()`, an aborted
        // fetch on some engines) would otherwise reach the row as the bald
        // "Error · " — a state line that names no trouble at all. The
        // per-path fallback sentence is the honest answer there.
        const message = (e instanceof Error && e.message) || entry.fallback;
        setError(message, entry.source);
        setFailed((rows) => [
          ...rows,
          {
            id,
            name: entry.name,
            message,
            retry: () => {
              setFailed((current) => current.filter((r) => r.id !== id));
              void runTracked(entry, attempt);
            },
          },
        ]);
        return null;
      } finally {
        setPending((rows) => rows.filter((r) => r.id !== id));
      }
    },
    [setError],
  );

  const dismissFailed = useCallback((id: string): void => {
    setFailed((rows) => rows.filter((r) => r.id !== id));
  }, []);

  // Through a ref, so an inline `resolveStreamPlugin={() => …}` cannot change
  // the identity of the two loaders below — `App.tsx` lists them in dependency
  // arrays, and a new function per render would re-run those effects.
  const resolveStreamPlugin = useRef(
    options.resolveStreamPlugin ?? defaultResolveStreamPlugin,
  );
  resolveStreamPlugin.current =
    options.resolveStreamPlugin ?? defaultResolveStreamPlugin;

  const addLayerFromFile = useCallback(
    (file: File, overrides?: LayerOverrides): Promise<string | null> =>
      runTracked(
        {
          name: file.name,
          source: file.name,
          fallback: "Failed to parse file.",
        },
        async () => {
          let layerId: string;
          // The override FIRST, everywhere: a name is a guess, and the user
          // has already been shown that guess and given the chance to correct
          // it (see LayerOverrides.encoding).
          const encoding = overrides?.encoding ?? detectEncoding(file.name);
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
              colorBy: overrides?.colorBy,
              singleColor: overrides?.singleColor,
              unmatchedColor: overrides?.unmatchedColor,
              visible: overrides?.visible,
              hiddenTypes: overrides?.hiddenTypes,
              attributeOrders: overrides?.attributeOrders,
              tablePresentation: overrides?.tablePresentation,
              selectedAppearance: overrides?.selectedAppearance,
            });
          } else if (encoding === "cityparquet") {
            // A lone `.parquet` drop is a one-table package — the same loader as
            // a picked folder, given a selection of one.
            const model = await loadCityParquetFromFiles([file]);
            await ensureModelCrsLoadable(model);
            layerId = addCityLayer({
              name: file.name,
              model,
              modelRef: { type: "file", fileName: file.name },
              visible: overrides?.visible,
              rules: overrides?.rules,
              colorBy: overrides?.colorBy,
              singleColor: overrides?.singleColor,
              unmatchedColor: overrides?.unmatchedColor,
              hiddenTypes: overrides?.hiddenTypes,
              attributeOrders: overrides?.attributeOrders,
              tablePresentation: overrides?.tablePresentation,
              selectedAppearance: overrides?.selectedAppearance,
              // The parser produces the model and nothing else — a CityParquet
              // table is not something a cityjson reader can read.
              duckdb: { kind: "model", model },
            });
          } else {
            // Bytes, not `file.text()`: a dropped `.city.json.gz` — the form 3D
            // BAG ships in, and therefore the form a user saves off the catalog
            // — would otherwise reach the parser as mojibake. `decodeModelBytes`
            // decides on the MAGIC BYTES, so an uncompressed file still takes the
            // plain UTF-8 path.
            const bytes = new Uint8Array(await file.arrayBuffer());
            // A dropped ZIP of CityGML takes the same container path as a
            // catalog `application/zip` asset, decided the same way — on the
            // magic bytes, since this path already holds them.
            const zipped = isZipBytes(bytes);
            const gzipped = !zipped && isGzipBytes(bytes);
            const text = zipped ? "" : await decodeModelBytes(bytes);
            const parsed: CityModel = zipped
              ? parseCityGmlArchive(bytes, file.name)
              : parseText(file.name, text, encoding);
            // Fetch-and-gate the CRS while we are still async — a refusal here
            // reads as a load error instead of a dead layer in the scene sync.
            await ensureModelCrsLoadable(parsed);
            layerId = addCityLayer({
              name: file.name,
              model: parsed,
              modelRef: { type: "file", fileName: file.name },
              visible: overrides?.visible,
              rules: overrides?.rules,
              colorBy: overrides?.colorBy,
              singleColor: overrides?.singleColor,
              unmatchedColor: overrides?.unmatchedColor,
              hiddenTypes: overrides?.hiddenTypes,
              attributeOrders: overrides?.attributeOrders,
              tablePresentation: overrides?.tablePresentation,
              selectedAppearance: overrides?.selectedAppearance,
              duckdb: modelTableSource({
                model: parsed,
                // The array we ALREADY READ when nothing was gunzipped: a
                // re-encode would duplicate the whole file in the JS heap, and
                // `registerBuffer` is about to consume whichever array it gets.
                bytes:
                  zipped || encoding === "citygml"
                    ? null
                    : gzipped
                      ? new TextEncoder().encode(text)
                      : bytes,
                encoding:
                  encoding === "cityjsonseq"
                    ? "cityjsonseq"
                    : encoding === "citygml"
                      ? "citygml"
                      : "cityjson",
                refetch: fileSourceProvider(file),
              }),
            });
          }
          applyPostCreateOverrides(layerId, overrides);
          return layerId;
        },
      ),
    [runTracked],
  );

  const addLayerFromFiles = useCallback(
    (
      files: ReadonlyArray<File>,
      overrides?: LayerOverrides,
    ): Promise<string | null> =>
      runTracked(
        {
          name: packageNameFromFiles(files),
          source: packageNameFromFiles(files),
          fallback: "Failed to load the picked files.",
        },
        async () => {
          const name = packageNameFromFiles(files);
          const model = await loadCityParquetFromFiles(files);
          await ensureModelCrsLoadable(model);
          const layerId = addCityLayer({
            name,
            model,
            // The FOLDER is the source, so that is what a snapshot records as
            // needing re-selection — no single file could re-link this layer.
            modelRef: { type: "file", fileName: name },
            visible: overrides?.visible,
            rules: overrides?.rules,
            colorBy: overrides?.colorBy,
            singleColor: overrides?.singleColor,
            unmatchedColor: overrides?.unmatchedColor,
            hiddenTypes: overrides?.hiddenTypes,
            attributeOrders: overrides?.attributeOrders,
            tablePresentation: overrides?.tablePresentation,
            selectedAppearance: overrides?.selectedAppearance,
            duckdb: { kind: "model", model },
          });
          applyPostCreateOverrides(layerId, overrides);
          return layerId;
        },
      ),
    [runTracked],
  );

  const addLayerFromUrl = useCallback(
    (url: string, overrides?: LayerOverrides): Promise<string | null> =>
      runTracked(
        {
          name: fileNameFromUrl(url),
          source: url,
          fallback: "Failed to load remote file.",
        },
        async () => {
          const encoding = overrides?.encoding ?? detectEncoding(url);
          if (encoding === "flatcitybuf") {
            return await openStreamingLayer({
              plugin: await resolveStreamPlugin.current(),
              source: { url },
              name: fileNameFromUrl(url),
              modelRef: { type: "url", url },
              attributeOrders: overrides?.attributeOrders,
              tablePresentation: overrides?.tablePresentation,
            });
          }

          // `isCityParquetUrl`, not `detectEncoding`: a bucket pattern or a
          // package directory has no extension to detect. The predicate is TOTAL
          // and answers true for an unlistable https wildcard as well, so the
          // classifier's explanation of why it cannot be served is thrown from
          // the load below and lands in `error` — which is the point.
          //
          // An OVERRIDE replaces the predicate outright rather than widening
          // it: a `.parquet` URL corrected to CityJSON must leave this arm, and
          // an extensionless package directory the classifier cannot see (a
          // path with no trailing "/") must be able to enter it.
          const isParquet =
            overrides?.encoding !== undefined
              ? overrides.encoding === "cityparquet"
              : isCityParquetUrl(url);
          if (isParquet) {
            const model = await loadCityParquetFromUrl(url);
            await ensureModelCrsLoadable(model);
            return addCityLayer({
              name: cityParquetLayerNameFromUrl(url),
              model,
              modelRef: { type: "url", url },
              attributeOrders: overrides?.attributeOrders,
              tablePresentation: overrides?.tablePresentation,
              duckdb: { kind: "model", model },
            });
          }

          const parsed = await loadFromUrl(url, undefined, encoding);
          await ensureModelCrsLoadable(parsed.model);
          return addCityLayer({
            name: fileNameFromUrl(url),
            model: parsed.model,
            modelRef: { type: "url", url },
            attributeOrders: overrides?.attributeOrders,
            tablePresentation: overrides?.tablePresentation,
            duckdb: modelTableSource({
              model: parsed.model,
              bytes: parsed.bytes,
              encoding: parsed.encoding,
              refetch: urlSourceProvider(url),
            }),
          });
        },
      ),
    [runTracked],
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
    // Derived, never its own boolean: two concurrent adds used to race the
    // one `setLoading(false)`, so the first to settle cleared the spinner
    // the second was still using.
    loading: pending.length > 0,
    error,
    lastError,
    clearError,
    pending,
    failed,
    dismissFailed,
  };
}
