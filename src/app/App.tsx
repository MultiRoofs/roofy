import { useCallback, useRef, useState } from "react";
import "./app.css";
import type { CityModel } from "../domain/citymodel/types";
import type { CityJSONRoot } from "../domain/citymodel/cityjson/types";
import { parseCityJSON } from "../domain/citymodel/cityjson/parseCityJSON";
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
  const sceneRef = useRef<CitySceneHandle>(null);

  const selection = useSelectionStore((s) => s.selection);
  const mode = useSelectionStore((s) => s.mode);
  const setMode = useSelectionStore((s) => s.setMode);
  const clearSelection = useSelectionStore((s) => s.clear);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as CityJSONRoot;

      if (json.type !== "CityJSON") {
        setError("Not a CityJSON file \u2014 expected \"type\": \"CityJSON\".");
        return;
      }

      const parsed = parseCityJSON(json);
      setModel(parsed);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file.");
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
          Drop a <code>.city.json</code> file to visualize and explore 3D city
          models in the browser.
        </p>
      </div>

      <div
        className="drop-zone"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <p>Drop a CityJSON file here</p>
        <p className="drop-or">or</p>
        <label className="file-label">
          Browse files
          <input
            type="file"
            accept=".json,.city.json"
            onChange={handleInputChange}
            hidden
          />
        </label>
      </div>

      {error && <p className="error-message">{error}</p>}
    </main>
  );
}
