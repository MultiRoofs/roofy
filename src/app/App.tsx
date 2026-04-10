import { useCallback, useEffect, useRef, useState } from "react";
import "./app.css";
import { detectEncoding } from "../domain/citymodel/detectEncoding";
import {
  loadFromUrl,
  fileNameFromUrl,
} from "../domain/citymodel/loadCityModel";
import type { ProjectStateStore, SnapshotSummary } from "../persistence/types";
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
} from "../analytics/duckdb";
import type { DuckDBStatus } from "../analytics/duckdb";
import { browserPlatform } from "../platform/browser";
import type { PlatformServices } from "../platform/types";
import { CityScene } from "../scene/CitySceneR3F";
import type { CitySceneHandle } from "../scene/CitySceneR3F";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useLayerStore } from "../features/layers/layerStore";
import { useLayerFileLoader } from "../features/layers/useLayerFileLoader";
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

const defaultStore = new LocalStorageProjectStateStore();
const SAMPLE_DATA_URL =
  "https://storage.googleapis.com/cityjson/delft.city.jsonl";

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
  const sceneRef = useRef<CitySceneHandle>(null);
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { theme, toggleTheme } = useTheme();

  // Layer store
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const hasLayers = layers.length > 0;

  // File loading
  const {
    addLayerFromFile,
    addLayerFromUrl,
    loading,
    error: loadError,
    clearError,
  } = useLayerFileLoader();

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

  // Load active layer's model into DuckDB (URL via extension, file via in-memory)
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

      // Try extension reader for URL models
      if (activeLayer.modelRef.type === "url" && extensionLoaded) {
        const encoding = detectEncoding(activeLayer.modelRef.url);
        loaded = await loadModelIntoDuckDB(activeLayer.modelRef.url, encoding);
      }

      // Fall back to in-memory loading (works for file and URL models)
      if (!loaded) {
        loaded = await loadCityModelFromMemory(activeLayer.model);
      }

      if (!cancelled) {
        setDuckdbModelLoaded(
          activeLayer.modelRef.type === "url" && extensionLoaded && loaded,
        );
        setDuckdbTableLoaded(loaded);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [duckdbStatus, activeLayerId, layers]);

  const handleFile = useCallback(
    async (file: File) => {
      clearError();
      await addLayerFromFile(file);
    },
    [addLayerFromFile, clearError],
  );

  const handleUrl = useCallback(
    async (url: string) => {
      clearError();
      await addLayerFromUrl(url);
    },
    [addLayerFromUrl, clearError],
  );

  const handleSave = useCallback(async () => {
    const cameraState = sceneRef.current?.getCameraState();
    if (!cameraState) return;

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
      })),
      cameraPosition: cameraState.position,
      cameraTarget: cameraState.target,
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

        // Remove all existing layers
        useLayerStore.getState().removeAllLayers();

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

        let hasUrlLayer = false;
        for (const sl of legacyLayers) {
          if (sl.modelRef.type === "url") {
            hasUrlLayer = true;
            const parsed = await loadFromUrl(sl.modelRef.url);
            useLayerStore.getState().addLayer({
              name: sl.name,
              model: parsed,
              modelRef: sl.modelRef,
              visible: sl.visible ?? true,
              rules: sl.rules ?? [],
              rulesEnabled: sl.rulesEnabled ?? true,
            });
          }
        }

        const hasFileLayer = legacyLayers.some(
          (l) => l.modelRef.type === "file",
        );
        if (!hasUrlLayer) {
          setToast("Workspace restored. Drop file(s) to view the model.");
          setTimeout(() => setToast(null), 3000);
        } else if (hasFileLayer) {
          setToast(
            "URL layers restored. Drop local file(s) to restore remaining layers.",
          );
          setTimeout(() => setToast(null), 3000);
        }

        if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
        cameraTimerRef.current = setTimeout(() => {
          sceneRef.current?.setCameraState(
            viewState.cameraPosition,
            viewState.cameraTarget,
          );
        }, 100);
      } catch (e) {
        setToast(
          e instanceof Error ? e.message : "Failed to restore workspace.",
        );
        setTimeout(() => setToast(null), 3000);
      }
    },
    [persistenceStore, clearError],
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
      cp: cameraState.position,
      ct: cameraState.target,
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
          const parsed = await loadFromUrl(sl.modelUrl);
          useLayerStore.getState().addLayer({
            name: sl.name ?? fileNameFromUrl(sl.modelUrl),
            model: parsed,
            modelRef: { type: "url", url: sl.modelUrl },
            visible: sl.visible ?? true,
            rules: (sl.rules ?? []) as (typeof layers)[number]["rules"],
            rulesEnabled: sl.rulesEnabled ?? true,
          });
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
        sceneRef.current?.setCameraState(shared.cp, shared.ct);
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
    useLayerStore.getState().removeAllLayers();
    setTriangleCount(0);
    setDuckdbModelLoaded(false);
    setDuckdbTableLoaded(false);
    setTableOpen(false);
    setFps(undefined);
    setCursorPosition(null);
    clearSelection();
  }, [clearSelection]);

  const handleFitAll = useCallback(() => {
    sceneRef.current?.fitAll();
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

  // Viewer state
  if (hasLayers) {
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
          <CityScene
            ref={sceneRef}
            onTriangleCount={setTriangleCount}
            onFps={setFps}
            onCursorPosition={setCursorPosition}
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
        />

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
          <code>.city.jsonl</code>, and <code>.fcb</code>.
        </p>
      </div>

      <div
        className="drop-zone"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <p>Drop a CityJSON, CityJSONSeq, or FlatCityBuf file here</p>
        <p className="drop-or">or</p>
        <label className="file-label">
          Browse files
          <input
            type="file"
            accept=".json,.city.json,.jsonl,.city.jsonl,.fcb"
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
