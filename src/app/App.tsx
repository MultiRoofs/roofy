import { useCallback, useEffect, useRef, useState } from "react";
import "./app.css";
import type { CityModel } from "../domain/citymodel/types";
import { detectEncoding } from "../domain/citymodel/detectEncoding";
import { loadFlatCityBuf } from "../domain/citymodel/flatcitybuf/loadFlatCityBuf";
import { parseText, loadFromUrl, fileNameFromUrl } from "../domain/citymodel/loadCityModel";
import type { CityModelReference, ProjectStateStore, SnapshotSummary } from "../persistence/types";
import { LocalStorageProjectStateStore } from "../persistence/localStorage";
import { captureSnapshot } from "../persistence/captureSnapshot";
import { restoreSnapshot } from "../persistence/restoreSnapshot";
import { CityScene } from "../scene/CityScene";
import type { CitySceneHandle } from "../scene/CityScene";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useRuleStore } from "../features/rules/ruleStore";
import { useSolarStore } from "../features/solar/solarStore";
import { InspectorPanel } from "../ui/inspector/InspectorPanel";
import { ViewerToolbar } from "../ui/toolbar/ViewerToolbar";
import { ToolRail } from "../ui/toolbar/ToolRail";
import { StatusBar } from "../ui/StatusBar";
import { LegendOverlay } from "../ui/viewport/LegendOverlay";

const defaultStore = new LocalStorageProjectStateStore();

interface AppProps {
  readonly persistenceStore?: ProjectStateStore;
}

export function App({ persistenceStore = defaultStore }: AppProps) {
  const [model, setModel] = useState<CityModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [triangleCount, setTriangleCount] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [modelRef, setModelRef] = useState<CityModelReference | null>(null);
  const [savedSnapshots, setSavedSnapshots] = useState<SnapshotSummary[]>([]);
  const sceneRef = useRef<CitySceneHandle>(null);

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

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      let parsed: CityModel;

      if (detectEncoding(file.name) === "flatcitybuf") {
        const blobUrl = URL.createObjectURL(file);
        try {
          parsed = await loadFlatCityBuf(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } else {
        const text = await file.text();
        parsed = parseText(file.name, text);
      }

      setModel(parsed);
      setFileName(file.name);
      setModelRef({ type: "file", fileName: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUrl = useCallback(async (url: string) => {
    setError(null);
    setLoading(true);
    try {
      const parsed = await loadFromUrl(url);
      setModel(parsed);
      setFileName(fileNameFromUrl(url));
      setModelRef({ type: "url", url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load remote file.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const cameraState = sceneRef.current?.getCameraState();
    if (!cameraState) return;

    const { datetime } = useSolarStore.getState();
    const { rules, enabled: rulesEnabled } = useRuleStore.getState();
    const { mode: pickMode } = useSelectionStore.getState();

    const label = fileName ?? "Untitled";
    const snapshot = captureSnapshot({
      label,
      modelRef,
      cameraPosition: cameraState.position,
      cameraTarget: cameraState.target,
      datetime,
      rules,
      rulesEnabled,
      pickMode,
    });

    try {
      await persistenceStore.save(snapshot);
      await refreshSnapshots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save workspace.");
    }
  }, [fileName, modelRef, persistenceStore, refreshSnapshots]);

  const handleRestore = useCallback(async (id: string) => {
    setError(null);
    setLoading(true);
    try {
      const snapshot = await persistenceStore.load(id);
      if (!snapshot) {
        setError("Snapshot not found.");
        return;
      }

      const viewState = restoreSnapshot(snapshot);

      if (snapshot.modelRef?.type === "url") {
        const parsed = await loadFromUrl(snapshot.modelRef.url);
        setModel(parsed);
        setFileName(fileNameFromUrl(snapshot.modelRef.url));
        setModelRef(snapshot.modelRef);
        // Apply camera after the scene initializes with the new model
        setTimeout(() => {
          sceneRef.current?.setCameraState(
            viewState.cameraPosition,
            viewState.cameraTarget,
          );
        }, 100);
      } else if (snapshot.modelRef?.type === "file") {
        // Cannot auto-load a local file — apply camera if model is already loaded
        setFileName(snapshot.modelRef.fileName);
        setModelRef(snapshot.modelRef);
        if (model) {
          sceneRef.current?.setCameraState(
            viewState.cameraPosition,
            viewState.cameraTarget,
          );
        }
        setError(
          `Workspace "${snapshot.label}" restored. ` +
          `Please drop "${snapshot.modelRef.fileName}" to view the model.`,
        );
      } else {
        setError("Workspace restored, but no model source was saved.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore workspace.");
    } finally {
      setLoading(false);
    }
  }, [model, persistenceStore]);

  const handleDeleteSnapshot = useCallback(async (id: string) => {
    await persistenceStore.remove(id);
    await refreshSnapshots();
  }, [persistenceStore, refreshSnapshots]);

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
    setModel(null);
    setFileName(null);
    setModelRef(null);
    setTriangleCount(0);
    clearSelection();
  }, [clearSelection]);

  const handleFitAll = useCallback(() => {
    sceneRef.current?.fitAll();
  }, []);

  // Viewer state
  if (model) {
    const objectCount = Object.keys(model.objects).length;

    return (
      <div className={`viewer-shell ${!inspectorOpen ? "panel-collapsed" : ""}`}>
        <ViewerToolbar
          model={model}
          fileName={fileName}
          onClose={handleClose}
          onToggleInspector={() => setInspectorOpen((o) => !o)}
          onFitAll={handleFitAll}
          onSave={handleSave}
        />

        <ToolRail
          pickMode={mode}
          onSetPickMode={setMode}
          onFitAll={handleFitAll}
        />

        <div className="viewport">
          <CityScene ref={sceneRef} model={model} onTriangleCount={setTriangleCount} />
          <LegendOverlay />
        </div>

        {inspectorOpen && (
          <InspectorPanel
            model={model}
            selection={selection}
            onClose={() => setInspectorOpen(false)}
          />
        )}

        <StatusBar
          objectCount={objectCount}
          triangleCount={triangleCount}
          selectedCount={selection ? 1 : 0}
        />
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

      {error && <p className="error-message">{error}</p>}
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
