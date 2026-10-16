/**
 * Hook for loading city model files into the layer store.
 *
 * The BOOKING half of a layer add: a pending row while it runs, a failed row
 * with its own retry when it throws, and the per-source error behind
 * `lastError`. Which format, which loader and which engine hold are
 * {@link openCityLayer}'s, the one door every city layer opens through.
 */

import type { CityModelEncoding } from "@cityjson/navara-core";
import { useCallback, useRef, useState } from "react";
import { fileNameFromUrl } from "../../domain/citymodel/loadCityModel";
import {
  openCityLayer,
  type CityLayerSettings,
  type OpenCityLayerDeps,
} from "./openCityLayer";
import {
  requireStreamPlugin,
  type StreamPlugin,
} from "../streaming/streamPlugin";

/**
 * What a caller knows about the add beyond the source: the saved settings of a
 * re-linked layer, and what the source IS when someone has said so.
 *
 * `encoding` rides here rather than in a parameter of its own so a RETRY
 * keeps it: `runTracked` re-invokes the captured closure, and the overrides
 * are part of that closure.
 */
export interface LayerOverrides extends Omit<CityLayerSettings, "name"> {
  readonly encoding?: CityModelEncoding;
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
  /**
   * Hold the 3D engine up around an open that turned out to stream — a large
   * CityParquet source, whose format alone does not say it needs the engine
   * (App's boot hold; see `CityParquetLayerDeps.holdEngine`). Absent: the
   * open runs as is.
   */
  readonly holdEngine?: OpenCityLayerDeps["holdEngine"];
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
  const holdEngine = useRef(options.holdEngine);
  holdEngine.current = options.holdEngine;
  /** Read at call time, through the refs, for the same identity reason. */
  const openDeps = (): OpenCityLayerDeps => ({
    resolveStreamPlugin: () => resolveStreamPlugin.current(),
    holdEngine: holdEngine.current,
  });
  const settingsOf = (
    overrides: LayerOverrides | undefined,
  ): CityLayerSettings | undefined => {
    if (overrides === undefined) return undefined;
    const { encoding: _encoding, ...settings } = overrides;
    return settings;
  };

  const addLayerFromFile = useCallback(
    (file: File, overrides?: LayerOverrides): Promise<string | null> =>
      runTracked(
        {
          name: file.name,
          source: file.name,
          fallback: "Failed to parse file.",
        },
        () =>
          openCityLayer(
            {
              source: { kind: "file", file },
              encoding: overrides?.encoding,
              settings: settingsOf(overrides),
            },
            openDeps(),
          ),
      ),
    [runTracked],
  );

  const addLayerFromFiles = useCallback(
    (
      files: ReadonlyArray<File>,
      overrides?: LayerOverrides,
    ): Promise<string | null> => {
      const name = packageNameFromFiles(files);
      return runTracked(
        {
          name,
          source: name,
          fallback: "Failed to load the picked files.",
        },
        () =>
          openCityLayer(
            {
              source: { kind: "files", files, name },
              encoding: overrides?.encoding,
              settings: settingsOf(overrides),
            },
            openDeps(),
          ),
      );
    },
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
        () =>
          openCityLayer(
            {
              source: { kind: "url", url },
              encoding: overrides?.encoding,
              settings: settingsOf(overrides),
            },
            openDeps(),
          ),
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
