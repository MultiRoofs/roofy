import { useCallback, useRef, useState } from "react";
import "./app.css";
import type { CityModel } from "../domain/citymodel/types";
import { detectEncoding } from "../domain/citymodel/detectEncoding";
import { loadFlatCityBuf } from "../domain/citymodel/flatcitybuf/loadFlatCityBuf";
import { parseText, loadFromUrl, fileNameFromUrl } from "../domain/citymodel/loadCityModel";
import { CityScene } from "../scene/CityScene";
import type { CitySceneHandle } from "../scene/CityScene";
import { useSelectionStore } from "../features/selection/selectionStore";
import { InspectorPanel } from "../ui/inspector/InspectorPanel";
import { ViewerToolbar } from "../ui/toolbar/ViewerToolbar";
import { ToolRail } from "../ui/toolbar/ToolRail";
import { StatusBar } from "../ui/StatusBar";
import { LegendOverlay } from "../ui/viewport/LegendOverlay";

export function App() {
  const [model, setModel] = useState<CityModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [triangleCount, setTriangleCount] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const sceneRef = useRef<CitySceneHandle>(null);

  const selection = useSelectionStore((s) => s.selection);
  const mode = useSelectionStore((s) => s.mode);
  const setMode = useSelectionStore((s) => s.setMode);
  const clearSelection = useSelectionStore((s) => s.clear);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load remote file.");
    } finally {
      setLoading(false);
    }
  }, []);

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
