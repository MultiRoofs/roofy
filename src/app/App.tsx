import { useCallback, useEffect, useRef, useState } from "react";
import "./app.css";
import { detectEncoding } from "../domain/citymodel/detectEncoding";
import { loadFromUrl, fileNameFromUrl } from "../domain/citymodel/loadCityModel";
import type { ProjectStateStore, SnapshotSummary } from "../persistence/types";
import { LocalStorageProjectStateStore } from "../persistence/localStorage";
import { captureSnapshot } from "../persistence/captureSnapshot";
import { restoreSnapshot } from "../persistence/restoreSnapshot";
import { encodeShareState, decodeShareState, buildShareUrl } from "../persistence/urlShare";
import type { ShareableViewState } from "../persistence/urlShare";
import { initDuckDB, getDuckDBStatus, loadModelIntoDuckDB } from "../analytics/duckdb";
import type { DuckDBStatus } from "../analytics/duckdb";
import { browserPlatform } from "../platform/browser";
import type { PlatformServices } from "../platform/types";
import { CityScene } from "../scene/CityScene";
import type { CitySceneHandle } from "../scene/CityScene";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useLayerStore } from "../features/layers/layerStore";
import { useLayerFileLoader } from "../features/layers/useLayerFileLoader";
import { useTheme } from "../features/theme/useTheme";
import { useSolarStore } from "../features/solar/solarStore";
import { InspectorPanel } from "../ui/inspector/InspectorPanel";
import { ViewerToolbar } from "../ui/toolbar/ViewerToolbar";
import { ToolRail } from "../ui/toolbar/ToolRail";
import { StatusBar } from "../ui/StatusBar";
import { LegendOverlay } from "../ui/viewport/LegendOverlay";

const defaultStore = new LocalStorageProjectStateStore();

interface AppProps {
  readonly persistenceStore?: ProjectStateStore;
  readonly platform?: PlatformServices;
}

export function App({ persistenceStore = defaultStore, platform = browserPlatform }: AppProps) {
  const [triangleCount, setTriangleCount] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [savedSnapshots, setSavedSnapshots] = useState<SnapshotSummary[]>([]);
  const [duckdbStatus, setDuckdbStatus] = useState<DuckDBStatus>({ state: "uninitialized" });
  const [duckdbModelLoaded, setDuckdbModelLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const sceneRef = useRef<CitySceneHandle>(null);
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { theme, toggleTheme } = useTheme();

  // Layer store
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const hasLayers = layers.length > 0;

  // File loading
  const { addLayerFromFile, addLayerFromUrl, loading, error: loadError, clearError } = useLayerFileLoader();

  const selection = useSelectionStore((s) => s.selection);
  const mode = useSelectionStore((s) => s.mode);
  const setMode = useSelectionStore((s) => s.setMode);
  const clearSelection = useSelectionStore((s) => s.clear);

  const refreshSnapshots = useCallback(async () => {
    const list = await persistenceStore.list();
    setSavedSnapshots(list);
  }, [persistenceStore]);

  useEffect(() => {
    refreshSnapshots();
  }, [refreshSnapshots]);

  // Initialize DuckDB-wasm on mount
  useEffect(() => {
    initDuckDB().then(() => {
      setDuckdbStatus(getDuckDBStatus());
    });
  }, []);

  // Load active layer's model into DuckDB when URL-based
  useEffect(() => {
    let cancelled = false;

    if (duckdbStatus.state !== "ready") return;
    if (!("extensionLoaded" in duckdbStatus) || !duckdbStatus.extensionLoaded) return;

    const activeLayer = layers.find((l) => l.id === activeLayerId);
    if (!activeLayer || activeLayer.modelRef.type !== "url") {
      setDuckdbModelLoaded(false);
      return;
    }

    const encoding = detectEncoding(activeLayer.modelRef.url);
    loadModelIntoDuckDB(activeLayer.modelRef.url, encoding).then((ok) => {
      if (!cancelled) setDuckdbModelLoaded(ok);
    });

    return () => { cancelled = true; };
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

    const activeLayer = allLayers.find((l) => l.id === activeLayerId) ?? allLayers[0];
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

  const handleRestore = useCallback(async (id: string) => {
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
      const legacyLayers = snapshotLayers.length === 0 && snapshot.modelRef
        ? [{ name: snapshot.label, modelRef: snapshot.modelRef, rules: [...(snapshot.rules ?? [])], rulesEnabled: snapshot.rulesEnabled ?? true, visible: true }]
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

      const hasFileLayer = legacyLayers.some((l) => l.modelRef.type === "file");
      if (!hasUrlLayer) {
        setToast("Workspace restored. Drop file(s) to view the model.");
        setTimeout(() => setToast(null), 3000);
      } else if (hasFileLayer) {
        setToast("URL layers restored. Drop local file(s) to restore remaining layers.");
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
      setToast(e instanceof Error ? e.message : "Failed to restore workspace.");
      setTimeout(() => setToast(null), 3000);
    }
  }, [persistenceStore, clearError]);

  const handleDeleteSnapshot = useCallback(async (id: string) => {
    await persistenceStore.remove(id);
    await refreshSnapshots();
  }, [persistenceStore, refreshSnapshots]);

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
    platform.clipboard.writeText(url).then((ok) => {
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
    const legacyUrl = "modelUrl" in shared ? (shared as { modelUrl?: string }).modelUrl : null;
    const layersToLoad = sharedLayers.length > 0
      ? sharedLayers
      : legacyUrl
        ? [{ name: fileNameFromUrl(legacyUrl), modelUrl: legacyUrl, rules: (shared as { rules?: unknown[] }).rules ?? [], rulesEnabled: true, visible: true }]
        : [];

    if (layersToLoad.length === 0) return;

    (async () => {
      for (const sl of layersToLoad) {
        if (!sl.modelUrl) continue;
        try {
          const parsed = await loadFromUrl(sl.modelUrl);
          useLayerStore.getState().addLayer({
            name: sl.name ?? fileNameFromUrl(sl.modelUrl),
            model: parsed,
            modelRef: { type: "url", url: sl.modelUrl },
            visible: sl.visible ?? true,
            rules: (sl.rules ?? []) as typeof layers[number]["rules"],
            rulesEnabled: sl.rulesEnabled ?? true,
          });
        } catch {
          // Skip failed layers silently
        }
      }

      useSelectionStore.setState({ mode: shared.pm, selection: null, hovered: null });
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
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleClose = useCallback(() => {
    useLayerStore.getState().removeAllLayers();
    setTriangleCount(0);
    setDuckdbModelLoaded(false);
    clearSelection();
  }, [clearSelection]);

  const handleFitAll = useCallback(() => {
    sceneRef.current?.fitAll();
  }, []);

  // Viewer state
  if (hasLayers) {
    const totalObjects = layers.reduce(
      (sum, l) => sum + Object.keys(l.model.objects).length,
      0,
    );
    const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
    const hasUrlLayers = layers.some((l) => l.modelRef.type === "url");

    return (
      <div className={`viewer-shell ${!inspectorOpen ? "panel-collapsed" : ""}`}>
        <ViewerToolbar
          fileName={activeLayer?.name ?? null}
          layerCount={layers.length}
          onClose={handleClose}
          onToggleInspector={() => setInspectorOpen((o) => !o)}
          onFitAll={handleFitAll}
          onSave={handleSave}
          onShare={handleShare}
          canShare={hasUrlLayers}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <ToolRail
          pickMode={mode}
          onSetPickMode={setMode}
          onFitAll={handleFitAll}
        />

        <div className="viewport">
          <CityScene ref={sceneRef} onTriangleCount={setTriangleCount} />
          <LegendOverlay />
        </div>

        {inspectorOpen && (
          <InspectorPanel
            selection={selection}
            onClose={() => setInspectorOpen(false)}
            duckdbModelLoaded={duckdbModelLoaded}
            onAddLayerFromFile={handleFile}
            onAddLayerFromUrl={handleUrl}
            addLayerLoading={loading}
          />
        )}

        <StatusBar
          objectCount={totalObjects}
          triangleCount={triangleCount}
          selectedCount={selection ? 1 : 0}
          duckdbStatus={duckdbStatus}
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
          Drop a file or load from a URL.
          Supports <code>.city.json</code>, <code>.city.jsonl</code>,
          and <code>.fcb</code>.
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
      <label className="fcb-url-label">
        Or load from URL:
      </label>
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
