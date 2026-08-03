import { useCallback, useEffect, useRef, useState } from "react";
import "./app.css";
import { detectEncoding } from "../domain/citymodel/detectEncoding";
import {
  loadFromUrl,
  fileNameFromUrl,
} from "../domain/citymodel/loadCityModel";
import type {
  CityModelReference,
  ProjectStateStore,
  RawLayerSnapshot,
  SnapshotSummary,
  StreamSourceSnapshot,
} from "../persistence/types";
import { migrateSnapshot } from "../persistence/types";
import { LocalStorageProjectStateStore } from "../persistence/localStorage";
import { captureSnapshot } from "../persistence/captureSnapshot";
import { restoreSnapshot } from "../persistence/restoreSnapshot";
import { decodeShareState, buildShareUrl } from "../persistence/urlShare";
import type { ShareableViewState } from "../persistence/urlShare";
import {
  initDuckDB,
  getDuckDBStatus,
  loadModelIntoDuckDB,
  loadCityModelFromMemory,
  loadResidentObjectsIntoDuckDB,
  shouldUseSourceUrlPath,
} from "../analytics/duckdb";
import type { DuckDBStatus } from "../analytics/duckdb";
import { browserPlatform } from "../platform/browser";
import type { PlatformServices } from "../platform/types";
import { NavaraViewport } from "../scene/NavaraViewport";
import type { CitySceneHandle } from "../scene/NavaraViewport";
import {
  cameraStateFromTuples,
  cameraStateToTuples,
} from "../scene/cameraStateBridge";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useLayerStore } from "../features/layers/layerStore";
import { useLayerFileLoader } from "../features/layers/useLayerFileLoader";
import { useStreamStore } from "../features/streaming/streamStore";
import { getResidentModel } from "../features/streaming/residentModel";
import {
  closeAllStreamingLayers,
  openStreamingLayer,
} from "../features/streaming/openStreamingLayer";
import {
  getStreamPlugin,
  requireStreamPlugin,
  type StreamPlugin,
} from "../features/streaming/streamPlugin";
import { useTheme } from "../features/theme/useTheme";
import { useSolarStore } from "../features/solar/solarStore";
import { InspectorPanel } from "../ui/inspector/InspectorPanel";
import { ViewerToolbar } from "../ui/toolbar/ViewerToolbar";
import { LeftSidebar } from "../ui/sidebar/LeftSidebar";
import { StatusBar } from "../ui/StatusBar";
import { LegendOverlay } from "../ui/viewport/LegendOverlay";
import { AttributePanel } from "../ui/viewport/AttributePanel";
import { AdvancedSettingsPanel } from "../ui/viewport/AdvancedSettingsPanel";
import { TablePanel } from "../ui/table/TablePanel";
import type { CityObject } from "../domain/citymodel/types";
import type { Rule } from "../features/rules/types";

const defaultStore = new LocalStorageProjectStateStore();
const SAMPLE_DATA_URL =
  "https://storage.googleapis.com/cityjson/delft.city.jsonl";

/**
 * How long a queued `.fcb` open waits for the just-mounted viewport to publish
 * its imperative handle.
 *
 * A React commit takes microseconds, so reaching this means the viewer shell
 * never mounted at all. Bounded rather than open-ended because of the Shared
 * Interface Contract's resolve-or-reject rule: the caller gets an error it can
 * show in the load-error slot, never a promise that silently never settles.
 */
export const ENGINE_BOOT_TIMEOUT_MS = 15_000;

/** How a streaming layer's `.fcb` source was opened, for the save/restore
 *  round-trip (`LayerSnapshot.stream`, `migrateSnapshot`'s `unavailable`
 *  flag). Only meaningful for `l.isStreaming` layers — see handleSave. */
function streamSourceSnapshot(
  modelRef: CityModelReference,
): StreamSourceSnapshot {
  return modelRef.type === "url"
    ? { kind: "url", url: modelRef.url }
    : { kind: "file", fileName: modelRef.fileName };
}

/** An unavailable-locally-sourced layer restored from a snapshot: a
 *  file-backed layer (streaming or not) whose bytes cannot survive a
 *  reload — no Blob/File is ever persisted. Rendered as a persistent
 *  (not auto-dismissing) prompt, distinct from the transient `toast`, so
 *  the user can re-select the file rather than the layer silently vanishing. */
interface UnavailableLayer {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  /** The saved layer's settings, carried through so re-selecting a file
   *  restores them instead of silently reverting to defaults — see
   *  handleResolveUnavailableLayer. */
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
  readonly visible: boolean;
  readonly lodMode: "auto" | "manual";
  readonly selectedLod: string | null;
}

interface AppProps {
  readonly persistenceStore?: ProjectStateStore;
  readonly platform?: PlatformServices;
}

export function App({
  persistenceStore = defaultStore,
  platform = browserPlatform,
}: AppProps) {
  const [triangleCount, setTriangleCount] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(240);
  const [savedSnapshots, setSavedSnapshots] = useState<SnapshotSummary[]>([]);
  const [unavailableLayers, setUnavailableLayers] = useState<
    ReadonlyArray<UnavailableLayer>
  >([]);
  const [duckdbStatus, setDuckdbStatus] = useState<DuckDBStatus>({
    state: "uninitialized",
  });
  const [duckdbModelLoaded, setDuckdbModelLoaded] = useState(false);
  const [duckdbTableLoaded, setDuckdbTableLoaded] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableHeight, setTableHeight] = useState(250);
  const [toast, setToast] = useState<string | null>(null);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [fps, setFps] = useState<number | undefined>(undefined);
  const [cursorPosition, setCursorPosition] = useState<
    readonly [number, number, number] | null
  >(null);
  const sceneRef = useRef<CitySceneHandle | null>(null);
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A `.fcb` open is in flight and needs the 3D engine, so the viewer shell
   * (and with it `NavaraViewport`, and with that the FlatCityBuf plugin) must
   * be mounted even though no layer exists yet.
   *
   * Without this a `.fcb` could never be the FIRST layer: streaming has no
   * parse step that produces a model, so the layer only appears once the
   * plugin has opened the source — and the plugin only exists once a viewport
   * is mounted, which used to require a layer. The shell already tolerates
   * zero layers (every `activeLayer` read below is optional-chained), so the
   * user watches the globe come up and the buildings stream onto it.
   */
  const [engineBooting, setEngineBooting] = useState(false);
  /** How many `.fcb` opens are currently holding the shell open. A counter,
   *  not a boolean, so two concurrent opens (a restored workspace) cannot have
   *  the first one to finish unmount the engine under the second. */
  const bootHoldsRef = useRef(0);

  const { theme, toggleTheme } = useTheme();

  // Layer store
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const hasLayers = layers.length > 0;

  // Active layer's streaming state, if any. Selected as individual
  // primitive fields (not the whole `StreamState` object) so this component
  // only re-renders on the fields it actually reads — see streamStore.ts's
  // doc comment on why a commit only ever touches `streams`, never
  // `layers`, and why consumers that DO need to react to one select
  // narrowly rather than subscribing to the whole entry.
  const activeStreamVersion = useStreamStore((s) =>
    activeLayerId ? s.streams[activeLayerId]?.version : undefined,
  );
  const activeStreamStatus = useStreamStore((s) =>
    activeLayerId ? s.streams[activeLayerId]?.status : undefined,
  );
  const activeStreamMessage = useStreamStore((s) =>
    activeLayerId ? s.streams[activeLayerId]?.message : undefined,
  );

  /**
   * Resolved the moment `NavaraViewport` publishes its imperative handle.
   *
   * A ref cannot be awaited and React does not notify on one, so the callback
   * ref below hands the handle over through this gate: `setEngineBooting(true)`
   * only SCHEDULES the mount, and the `.fcb` open that asked for it is already
   * past its own `await` by the time React commits.
   */
  const sceneGateRef = useRef<{
    readonly promise: Promise<CitySceneHandle>;
    readonly resolve: (handle: CitySceneHandle) => void;
  } | null>(null);

  /** One shared gate per boot: concurrent `.fcb` opens all wait on the same
   *  handle. Bounded — see {@link ENGINE_BOOT_TIMEOUT_MS}. */
  const awaitSceneHandle = useCallback((): Promise<CitySceneHandle> => {
    const existing = sceneGateRef.current;
    if (existing) return existing.promise;
    let settle!: (handle: CitySceneHandle) => void;
    let fail!: (error: unknown) => void;
    const promise = new Promise<CitySceneHandle>((res, rej) => {
      settle = res;
      fail = rej;
    });
    const timer = setTimeout(() => {
      sceneGateRef.current = null;
      fail(
        new Error(
          "The 3D viewport did not start, so the .fcb layer could not be opened.",
        ),
      );
    }, ENGINE_BOOT_TIMEOUT_MS);
    sceneGateRef.current = {
      promise,
      resolve: (handle) => {
        clearTimeout(timer);
        sceneGateRef.current = null;
        settle(handle);
      },
    };
    return promise;
  }, []);

  /** `NavaraViewport`'s ref — a CALLBACK ref, because publication is an event
   *  the pending `.fcb` opens above need to observe, not just a slot to read.
   *  Stable identity, so React never detaches/reattaches for it. */
  const attachScene = useCallback((handle: CitySceneHandle | null) => {
    sceneRef.current = handle;
    if (handle) sceneGateRef.current?.resolve(handle);
  }, []);

  /**
   * The live FlatCityBuf plugin for a `.fcb` open.
   *
   * Through the viewport's `getStreamingPlugin()` whenever there IS a viewport:
   * it awaits the engine's `ready` gate, so a stream requested while the engine
   * is still coming up — a restored workspace, a share hash — queues instead of
   * failing, and an engine that never came up rejects rather than hangs.
   *
   * With no viewport yet, a `.fcb` open that went through
   * {@link withEngineBooting} is mounting one right now, so this waits for the
   * handle instead of failing. A caller that did NOT take a boot hold gets the
   * old `requireStreamPlugin()` error immediately, whose message names the real
   * cause — better than a 15 s wait for a viewport nobody asked for.
   *
   * Stable identity: everything it touches is a ref.
   */
  const resolveStreamPlugin = useCallback(async (): Promise<StreamPlugin> => {
    const scene =
      sceneRef.current ??
      (bootHoldsRef.current > 0 ? await awaitSceneHandle() : null);
    return scene ? await scene.getStreamingPlugin() : requireStreamPlugin();
  }, [awaitSceneHandle]);

  /**
   * Run a layer open with the 3D engine mounted, when the source needs it.
   *
   * `.fcb` only: streaming is the one format whose layer cannot exist before
   * the engine does. Every other encoding parses to a `CityModel` first and
   * mounts the viewport as a consequence, so booting for those would put a
   * globe behind the landing page for no reason.
   *
   * The hold is released in `finally`, which is what returns the user to the
   * landing page when the open FAILS (a 404, a refused CRS) rather than
   * stranding them on an empty globe with no drop zone. On success the new
   * layer keeps the shell mounted on its own.
   */
  const withEngineBooting = useCallback(
    async <T,>(source: string, open: () => Promise<T>): Promise<T> => {
      if (detectEncoding(source) !== "flatcitybuf") return await open();
      bootHoldsRef.current += 1;
      setEngineBooting(true);
      try {
        return await open();
      } finally {
        bootHoldsRef.current -= 1;
        if (bootHoldsRef.current === 0) setEngineBooting(false);
      }
    },
    [],
  );

  // File loading
  const {
    addLayerFromFile,
    addLayerFromUrl,
    loading,
    error: loadError,
    clearError,
  } = useLayerFileLoader({ resolveStreamPlugin });

  const selections = useSelectionStore((s) => s.selections);
  const mode = useSelectionStore((s) => s.mode);
  const toolMode = useSelectionStore((s) => s.toolMode);
  const setMode = useSelectionStore((s) => s.setMode);
  const setToolMode = useSelectionStore((s) => s.setToolMode);
  const clearSelection = useSelectionStore((s) => s.clear);

  const refreshSnapshots = useCallback(async () => {
    const list = await persistenceStore.list();
    setSavedSnapshots(list);
  }, [persistenceStore]);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots]);

  // Initialize DuckDB-wasm on mount
  useEffect(() => {
    void initDuckDB().then(() => {
      setDuckdbStatus(getDuckDBStatus());
    });
  }, []);

  // Load active layer's model into DuckDB (URL via extension, file via
  // in-memory, streaming via resident cells — see shouldUseSourceUrlPath).
  useEffect(() => {
    let cancelled = false;

    if (duckdbStatus.state !== "ready") return;

    // Reset synchronously so table doesn't show stale data during load
    setDuckdbModelLoaded(false);
    setDuckdbTableLoaded(false);

    const activeLayer = layers.find((l) => l.id === activeLayerId);
    if (!activeLayer) return;

    const extensionLoaded =
      "extensionLoaded" in duckdbStatus && duckdbStatus.extensionLoaded;

    void (async () => {
      let loaded = false;

      if (activeLayer.isStreaming) {
        // shouldUseSourceUrlPath refuses the extension path here — it would
        // open a second, complete read of the remote file just to populate
        // `city_objects`, exactly what viewport streaming exists to avoid.
        // Feed the table from whatever cells are actually resident instead,
        // so Stats/Table only ever report what the UI itself claims to show.
        const resident = getResidentModel(
          activeLayer.id,
          activeStreamVersion ?? 0,
        );
        loaded = await loadResidentObjectsIntoDuckDB(
          Object.values(resident.objects),
        );
      } else {
        // Try extension reader for URL models (CityGML not supported by DuckDB extension)
        if (
          shouldUseSourceUrlPath(
            activeLayer.modelRef,
            activeLayer.isStreaming,
          ) &&
          extensionLoaded
        ) {
          const encoding = detectEncoding(activeLayer.modelRef.url);
          if (encoding !== "citygml") {
            loaded = await loadModelIntoDuckDB(
              activeLayer.modelRef.url,
              encoding,
            );
          }
        }

        // Fall back to in-memory loading (works for file and URL models)
        if (!loaded) {
          loaded = await loadCityModelFromMemory(activeLayer.model);
        }
      }

      if (!cancelled) {
        setDuckdbModelLoaded(
          !activeLayer.isStreaming &&
            activeLayer.modelRef.type === "url" &&
            extensionLoaded &&
            loaded,
        );
        setDuckdbTableLoaded(loaded);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [duckdbStatus, activeLayerId, layers, activeStreamVersion]);

  const handleFile = useCallback(
    async (file: File) => {
      clearError();
      await withEngineBooting(file.name, () => addLayerFromFile(file));
    },
    [addLayerFromFile, clearError, withEngineBooting],
  );

  const handleUrl = useCallback(
    async (url: string) => {
      clearError();
      await withEngineBooting(url, () => addLayerFromUrl(url));
    },
    [addLayerFromUrl, clearError, withEngineBooting],
  );

  const handleSave = useCallback(async () => {
    const cameraState = sceneRef.current?.getCameraState();
    if (!cameraState) return;
    // The snapshot schema still carries two 3-tuples; `cameraStateBridge` is
    // the temporary carrier for the geographic camera until Task C18 bumps it.
    const cameraTuples = cameraStateToTuples(cameraState);

    const { datetime } = useSolarStore.getState();
    const { layers: allLayers } = useLayerStore.getState();
    const { mode: pickMode } = useSelectionStore.getState();

    const activeLayer =
      allLayers.find((l) => l.id === activeLayerId) ?? allLayers[0];
    const label = activeLayer?.name ?? "Untitled";

    const snapshot = captureSnapshot({
      label,
      layers: allLayers.map((l) => ({
        name: l.name,
        modelRef: l.modelRef,
        rules: [...l.rules],
        rulesEnabled: l.rulesEnabled,
        visible: l.visible,
        selectedLod: l.selectedLod,
        lodMode: l.lodMode,
        ...(l.isStreaming ? { stream: streamSourceSnapshot(l.modelRef) } : {}),
      })),
      cameraPosition: cameraTuples.position,
      cameraTarget: cameraTuples.target,
      datetime,
      pickMode,
    });

    try {
      await persistenceStore.save(snapshot);
      await refreshSnapshots();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to save workspace.");
      setTimeout(() => setToast(null), 3000);
    }
  }, [activeLayerId, persistenceStore, refreshSnapshots]);

  const handleRestore = useCallback(
    async (id: string) => {
      clearError();
      try {
        const snapshot = await persistenceStore.load(id);
        if (!snapshot) {
          setToast("Snapshot not found.");
          setTimeout(() => setToast(null), 3000);
          return;
        }

        const viewState = restoreSnapshot(snapshot);

        // Remove all existing layers — the streaming ones first, so their
        // workers and cell meshes die with them rather than outliving the
        // layer entry that was the only way to reach them.
        closeAllStreamingLayers(getStreamPlugin());
        useLayerStore.getState().removeAllLayers();
        setUnavailableLayers([]);

        // Restore layers from snapshot
        const snapshotLayers = snapshot.layers ?? [];
        // Legacy single-model fallback
        const legacyLayers =
          snapshotLayers.length === 0 && snapshot.modelRef
            ? [
                {
                  name: snapshot.label,
                  modelRef: snapshot.modelRef,
                  rules: [...(snapshot.rules ?? [])],
                  rulesEnabled: snapshot.rulesEnabled ?? true,
                  visible: true,
                },
              ]
            : snapshotLayers;

        // Upgrades an older save (missing lodMode/stream) to the current
        // per-layer schema and flags a file-backed streaming layer as
        // needing re-selection — see migrateSnapshot's own doc comment.
        // Cast at the boundary: `legacyLayers` is genuinely well-typed
        // (`LayerSnapshot[]`), but `migrateSnapshot` accepts a deliberately
        // LOOSE shape so it can also upgrade an older save that predates
        // some of these fields — the same reason its own test file casts
        // its fixtures `as never`.
        const migrated = migrateSnapshot({
          layers: legacyLayers as unknown as RawLayerSnapshot[],
        });

        // Each layer gets its OWN try/catch: one .fcb layer failing
        // admission (checkAdmission — no-extent, non-metric-crs, ...) must
        // not abort every layer listed after it in the same workspace. The
        // share-restore effect below already does this per-item; this loop
        // previously did not, and streaming's admission checks make a
        // single-layer failure meaningfully more likely than before.
        let hasUrlLayer = false;
        let failedCount = 0;
        const newUnavailable: UnavailableLayer[] = [];
        for (const sl of migrated.layers) {
          try {
            const name = (sl.name as string | undefined) ?? "Untitled layer";
            const modelRef = sl.modelRef as CityModelReference | undefined;
            if (!modelRef) continue; // malformed saved entry — nothing to restore

            const rules = (sl.rules as Rule[] | undefined) ?? [];
            const rulesEnabled =
              (sl.rulesEnabled as boolean | undefined) ?? true;
            const visible = (sl.visible as boolean | undefined) ?? true;
            const lodMode =
              (sl.lodMode as "auto" | "manual" | undefined) ?? "auto";
            const selectedLod = (sl.selectedLod as string | null) ?? null;

            if (modelRef.type === "file" || sl.unavailable) {
              const fileName =
                modelRef.type === "file" ? modelRef.fileName : name;
              newUnavailable.push({
                id: crypto.randomUUID(),
                name,
                fileName,
                rules,
                rulesEnabled,
                visible,
                lodMode,
                selectedLod,
              });
              continue;
            }

            hasUrlLayer = true;

            let layerId: string;
            if (detectEncoding(modelRef.url) === "flatcitybuf") {
              layerId = await withEngineBooting(modelRef.url, async () =>
                openStreamingLayer({
                  plugin: await resolveStreamPlugin(),
                  source: { url: modelRef.url },
                  name,
                  modelRef,
                  rules,
                  rulesEnabled,
                  visible,
                }),
              );
            } else {
              const parsed = await loadFromUrl(modelRef.url);
              layerId = useLayerStore.getState().addLayer({
                name,
                model: parsed,
                modelRef,
                visible,
                rules,
                rulesEnabled,
              });
            }
            if (lodMode === "manual") {
              useLayerStore.getState().setLodMode(layerId, "manual");
            }
          } catch {
            // Skip this one layer; keep restoring the rest of the workspace.
            failedCount++;
          }
        }
        setUnavailableLayers(newUnavailable);

        if (!hasUrlLayer && newUnavailable.length === 0 && failedCount === 0) {
          setToast("Workspace restored. Drop file(s) to view the model.");
          setTimeout(() => setToast(null), 3000);
        } else if (newUnavailable.length > 0 || failedCount > 0) {
          const parts = [
            hasUrlLayer ? "Workspace restored." : null,
            newUnavailable.length > 0
              ? "Some layers need a local file re-selected below."
              : null,
            failedCount > 0
              ? `${failedCount} layer${failedCount === 1 ? "" : "s"} failed to restore.`
              : null,
          ].filter(Boolean);
          setToast(parts.join(" "));
          setTimeout(() => setToast(null), 3000);
        }

        if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
        // The 100 ms wait survives only until Task C20, which replaces it with
        // `await sceneRef.current.ready` inside a try/catch.
        cameraTimerRef.current = setTimeout(() => {
          sceneRef.current?.setCameraState(
            cameraStateFromTuples(
              viewState.cameraPosition,
              viewState.cameraTarget,
            ),
          );
        }, 100);
      } catch (e) {
        setToast(
          e instanceof Error ? e.message : "Failed to restore workspace.",
        );
        setTimeout(() => setToast(null), 3000);
      }
    },
    [persistenceStore, clearError, resolveStreamPlugin, withEngineBooting],
  );

  const handleDeleteSnapshot = useCallback(
    async (id: string) => {
      await persistenceStore.remove(id);
      await refreshSnapshots();
    },
    [persistenceStore, refreshSnapshots],
  );

  const handleShare = useCallback(() => {
    const cameraState = sceneRef.current?.getCameraState();
    if (!cameraState) return;
    const cameraTuples = cameraStateToTuples(cameraState);

    const { datetime } = useSolarStore.getState();
    const { layers: allLayers } = useLayerStore.getState();
    const { mode: pickMode } = useSelectionStore.getState();

    const state: ShareableViewState = {
      layers: allLayers
        .filter((l) => l.modelRef.type === "url")
        .map((l) => ({
          name: l.name,
          modelUrl: (l.modelRef as { type: "url"; url: string }).url,
          rules: [...l.rules],
          rulesEnabled: l.rulesEnabled,
          visible: l.visible,
        })),
      cp: cameraTuples.position,
      ct: cameraTuples.target,
      dt: datetime.toISOString(),
      pm: pickMode,
    };

    const url = buildShareUrl(state);
    void platform.clipboard.writeText(url).then((ok) => {
      if (ok) {
        setToast("Share link copied to clipboard");
        setTimeout(() => setToast(null), 2500);
      } else {
        setToast("Failed to copy link \u2014 check clipboard permissions");
        setTimeout(() => setToast(null), 3000);
      }
    });
  }, [platform]);

  // On mount: check URL hash for a share token
  useEffect(() => {
    const hash = location.hash;
    if (!hash) return;

    const shared = decodeShareState(hash);
    if (!shared) return;

    history.replaceState(null, "", location.pathname);

    // Load shared layers
    const sharedLayers = shared.layers ?? [];
    // Legacy single-model fallback
    const legacyUrl =
      "modelUrl" in shared ? (shared as { modelUrl?: string }).modelUrl : null;
    const layersToLoad =
      sharedLayers.length > 0
        ? sharedLayers
        : legacyUrl
          ? [
              {
                name: fileNameFromUrl(legacyUrl),
                modelUrl: legacyUrl,
                rules: (shared as { rules?: unknown[] }).rules ?? [],
                rulesEnabled: true,
                visible: true,
              },
            ]
          : [];

    if (layersToLoad.length === 0) return;

    void (async () => {
      for (const sl of layersToLoad) {
        if (!sl.modelUrl) continue;
        try {
          const name = sl.name ?? fileNameFromUrl(sl.modelUrl);
          const rules = (sl.rules ?? []) as (typeof layers)[number]["rules"];
          const rulesEnabled = sl.rulesEnabled ?? true;
          const visible = sl.visible ?? true;

          if (detectEncoding(sl.modelUrl) === "flatcitybuf") {
            const modelUrl = sl.modelUrl;
            await withEngineBooting(modelUrl, async () =>
              openStreamingLayer({
                plugin: await resolveStreamPlugin(),
                source: { url: modelUrl },
                name,
                modelRef: { type: "url", url: modelUrl },
                rules,
                rulesEnabled,
                visible,
              }),
            );
          } else {
            const parsed = await loadFromUrl(sl.modelUrl);
            useLayerStore.getState().addLayer({
              name,
              model: parsed,
              modelRef: { type: "url", url: sl.modelUrl },
              visible,
              rules,
              rulesEnabled,
            });
          }
        } catch {
          // Skip failed layers silently
        }
      }

      useSelectionStore.setState({
        mode: shared.pm,
        selections: [],
        hovered: null,
      });
      const dt = new Date(shared.dt);
      if (!isNaN(dt.getTime())) {
        useSolarStore.getState().setDatetime(dt);
      }
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      cameraTimerRef.current = setTimeout(() => {
        sceneRef.current?.setCameraState(
          cameraStateFromTuples(shared.cp, shared.ct),
        );
      }, 100);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const handleClose = useCallback(() => {
    closeAllStreamingLayers(getStreamPlugin());
    useLayerStore.getState().removeAllLayers();
    setTriangleCount(0);
    setDuckdbModelLoaded(false);
    setDuckdbTableLoaded(false);
    setTableOpen(false);
    setFps(undefined);
    setCursorPosition(null);
    setUnavailableLayers([]);
    clearSelection();
  }, [clearSelection]);

  // Re-selecting a file for an "unavailable" (restored-but-file-backed)
  // layer entry: routes through the same handleFile path any drop/browse
  // use — it already dispatches .fcb to streaming vs. plain parsing by
  // extension — then drops the entry once handled, whether it succeeded or
  // not (a failure surfaces through the normal `loadError` state; leaving a
  // permanently-stuck placeholder row would be worse than letting the user
  // retry via the ordinary add-layer controls).
  const handleResolveUnavailableLayer = useCallback(
    (entryId: string, file: File) => {
      const entry = unavailableLayers.find((u) => u.id === entryId);
      setUnavailableLayers((prev) => prev.filter((u) => u.id !== entryId));
      clearError();
      void withEngineBooting(file.name, () =>
        addLayerFromFile(
          file,
          entry
            ? {
                rules: entry.rules,
                rulesEnabled: entry.rulesEnabled,
                visible: entry.visible,
                lodMode: entry.lodMode,
                selectedLod: entry.selectedLod,
              }
            : undefined,
        ),
      );
    },
    [unavailableLayers, addLayerFromFile, clearError, withEngineBooting],
  );

  const handleDismissUnavailableLayer = useCallback((entryId: string) => {
    setUnavailableLayers((prev) => prev.filter((u) => u.id !== entryId));
  }, []);

  const handleFitAll = useCallback(() => {
    sceneRef.current?.fitAll();
  }, []);

  /** A layer the engine refused (the CRS gate — no reference system, or a
   *  non-metric one). Stable identity on purpose: `NavaraViewport`'s layer-sync
   *  effect lists it as a dependency. */
  const handleLayerError = useCallback((layerId: string, message: string) => {
    setToast(`Layer ${layerId}: ${message}`);
    setTimeout(() => setToast(null), 6000);
  }, []);

  const handleLoadSample = useCallback(() => {
    void handleUrl(SAMPLE_DATA_URL);
  }, [handleUrl]);

  // Resolve selected objects for attribute panel
  const selectedObjects: CityObject[] = [];
  if (selections.length > 0) {
    const sel0 = selections[0]!;
    const layer = layers.find((l) => l.id === sel0.layerId);
    if (layer) {
      for (const sel of selections) {
        const obj = layer.model.objects[sel.objectId];
        if (obj) selectedObjects.push(obj);
      }
    }
  }

  // Viewer state. `engineBooting` puts the shell up with ZERO layers for the
  // duration of a `.fcb` open — the engine has to be running before a
  // streaming layer can exist at all, so this is the only way a `.fcb` can be
  // the first thing opened. Everything below already reads `activeLayer`
  // optional-chained, so an empty workspace renders an empty globe rather than
  // throwing.
  if (hasLayers || engineBooting) {
    const totalObjects = layers.reduce(
      (sum, l) => sum + Object.keys(l.model.objects).length,
      0,
    );
    const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
    const hasUrlLayers = layers.some((l) => l.modelRef.type === "url");

    const shellClasses = [
      "viewer-shell",
      !inspectorOpen && "panel-collapsed",
      leftSidebarCollapsed && "left-collapsed",
    ]
      .filter(Boolean)
      .join(" ");

    const gridStyle = {
      "--left-panel-w": `${leftSidebarWidth}px`,
      ...(tableOpen ? { "--table-h": `${tableHeight}px` } : {}),
    } as React.CSSProperties;

    return (
      <div className={shellClasses} style={gridStyle}>
        <ViewerToolbar
          fileName={activeLayer?.name ?? null}
          layerCount={layers.length}
          pickMode={mode}
          toolMode={toolMode}
          onSetPickMode={setMode}
          onSetToolMode={setToolMode}
          onClose={handleClose}
          onToggleInspector={() => setInspectorOpen((o) => !o)}
          onToggleLeftSidebar={() => setLeftSidebarCollapsed((o) => !o)}
          onFitAll={handleFitAll}
          onSave={handleSave}
          onShare={handleShare}
          canShare={hasUrlLayers}
          theme={theme}
          onToggleTheme={toggleTheme}
          advancedSettingsOpen={advancedSettingsOpen}
          onToggleAdvancedSettings={() => setAdvancedSettingsOpen((o) => !o)}
        />

        <LeftSidebar
          width={leftSidebarWidth}
          onWidthChange={setLeftSidebarWidth}
          collapsed={leftSidebarCollapsed}
          onAddFile={handleFile}
          onAddUrl={handleUrl}
          loading={loading}
          onFlyToLayer={(id) => sceneRef.current?.fitLayer(id)}
        />

        <div className="viewport">
          <NavaraViewport
            ref={attachScene}
            onTriangleCount={setTriangleCount}
            onFps={setFps}
            onCursorPosition={setCursorPosition}
            onLayerError={handleLayerError}
          />
          <LegendOverlay />
          <AttributePanel objects={selectedObjects} />
          {advancedSettingsOpen && (
            <AdvancedSettingsPanel
              onClose={() => setAdvancedSettingsOpen(false)}
            />
          )}
        </div>

        {inspectorOpen && (
          <InspectorPanel
            selections={selections}
            onClose={() => setInspectorOpen(false)}
            duckdbModelLoaded={duckdbModelLoaded}
          />
        )}

        {tableOpen && (
          <TablePanel
            duckdbTableLoaded={duckdbTableLoaded}
            onCollapse={() => setTableOpen(false)}
            onHeightChange={setTableHeight}
          />
        )}

        <StatusBar
          objectCount={totalObjects}
          triangleCount={triangleCount}
          selectedCount={selections.length}
          duckdbStatus={duckdbStatus}
          fps={fps}
          cursorPosition={cursorPosition}
          tableOpen={tableOpen}
          onToggleTable={() => setTableOpen((o) => !o)}
          streamStatus={
            activeLayer?.isStreaming ? (activeStreamStatus ?? "idle") : null
          }
          streamMessage={
            activeLayer?.isStreaming ? (activeStreamMessage ?? null) : null
          }
        />

        {unavailableLayers.length > 0 && (
          <UnavailableLayersBanner
            layers={unavailableLayers}
            onResolve={handleResolveUnavailableLayer}
            onDismiss={handleDismissUnavailableLayer}
          />
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  // Landing / drop zone
  return (
    <main className="app-shell">
      <div className="hero">
        <p className="eyebrow">MultiRoof Viewer</p>
        <h1>Rooftop analysis starts here.</h1>
        <p className="summary">
          Drop a file or load from a URL. Supports <code>.city.json</code>,{" "}
          <code>.city.jsonl</code>, <code>.fcb</code>, and <code>.gml</code>{" "}
          (CityGML).
        </p>
      </div>

      {unavailableLayers.length > 0 && (
        <UnavailableLayersBanner
          layers={unavailableLayers}
          onResolve={handleResolveUnavailableLayer}
          onDismiss={handleDismissUnavailableLayer}
        />
      )}

      <div
        className="drop-zone"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <p>Drop a CityJSON, CityJSONSeq, FlatCityBuf, or CityGML file here</p>
        <p className="drop-or">or</p>
        <label className="file-label">
          Browse files
          <input
            type="file"
            accept=".json,.city.json,.jsonl,.city.jsonl,.fcb,.gml,.citygml"
            onChange={handleInputChange}
            hidden
          />
        </label>
      </div>

      <UrlInput onLoad={handleUrl} loading={loading} />

      <div className="sample-data-section">
        <button
          className="sample-data-btn"
          onClick={handleLoadSample}
          disabled={loading}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {loading ? "Loading\u2026" : "Load Delft sample"}
        </button>
      </div>

      {savedSnapshots.length > 0 && (
        <SnapshotList
          snapshots={savedSnapshots}
          onRestore={handleRestore}
          onDelete={handleDeleteSnapshot}
          loading={loading}
        />
      )}

      {loading && (
        <div className="loading-indicator">
          <div className="loading-spinner" />
          <span>Loading model...</span>
        </div>
      )}

      {loadError && <p className="error-message">{loadError}</p>}
    </main>
  );
}

// ---------------------------------------------------------------------------
// URL input component
// ---------------------------------------------------------------------------

function UrlInput({
  onLoad,
  loading,
}: {
  readonly onLoad: (url: string) => void;
  readonly loading: boolean;
}) {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) onLoad(trimmed);
  };

  return (
    <form className="fcb-url-form" onSubmit={handleSubmit}>
      <label className="fcb-url-label">Or load from URL:</label>
      <div className="fcb-url-row">
        <input
          type="url"
          className="fcb-url-input"
          placeholder="https://example.com/model.city.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          className="fcb-url-btn"
          disabled={loading || !url.trim()}
        >
          {loading ? "Loading\u2026" : "Load"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Unavailable (file-backed, restored-from-a-snapshot) layers — a persistent
// prompt, not a toast, per the explicit persistence requirement: "such a
// layer must restore as an explicit unavailable local source state
// prompting re-selection — not vanish with a toast."
// ---------------------------------------------------------------------------

function UnavailableLayersBanner({
  layers,
  onResolve,
  onDismiss,
}: {
  readonly layers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly fileName: string;
  }>;
  readonly onResolve: (entryId: string, file: File) => void;
  readonly onDismiss: (entryId: string) => void;
}) {
  return (
    <div className="unavailable-layers">
      <div className="unavailable-layers-title">
        {layers.length} layer{layers.length === 1 ? "" : "s"} need
        {layers.length === 1 ? "s" : ""} a local file re-selected
      </div>
      {layers.map((entry) => (
        <div key={entry.id} className="unavailable-layer-row">
          <span className="unavailable-layer-name" title={entry.fileName}>
            {entry.name}
          </span>
          <label className="unavailable-layer-choose">
            Choose file
            <input
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onResolve(entry.id, file);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="unavailable-layer-dismiss"
            title="Dismiss"
            onClick={() => onDismiss(entry.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved workspaces list
// ---------------------------------------------------------------------------

function SnapshotList({
  snapshots,
  onRestore,
  onDelete,
  loading,
}: {
  readonly snapshots: SnapshotSummary[];
  readonly onRestore: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly loading: boolean;
}) {
  return (
    <div className="snapshot-list">
      <div className="snapshot-list-title">Saved Workspaces</div>
      {snapshots.map((s) => (
        <div key={s.id} className="snapshot-row">
          <div className="snapshot-info">
            <span className="snapshot-label">{s.label}</span>
            <span className="snapshot-date">
              {new Date(s.savedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="snapshot-actions">
            <button
              className="snapshot-btn"
              onClick={() => onRestore(s.id)}
              disabled={loading}
            >
              Restore
            </button>
            <button
              className="snapshot-btn snapshot-btn-delete"
              onClick={() => onDelete(s.id)}
              disabled={loading}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
