import { useCallback, useState } from "react";
import "./app.css";
import type { CityModel } from "../domain/citymodel/types";
import type { CityJSONRoot } from "../domain/citymodel/cityjson/types";
import { parseCityJSON } from "../domain/citymodel/cityjson/parseCityJSON";
import { CityScene } from "../scene/CityScene";

export function App() {
  const [model, setModel] = useState<CityModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as CityJSONRoot;

      if (json.type !== "CityJSON") {
        setError("Not a CityJSON file — expected \"type\": \"CityJSON\".");
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

  // If a model is loaded, show the 3D scene
  if (model) {
    const objectCount = Object.keys(model.objects).length;
    return (
      <div className="viewer-layout">
        <header className="viewer-toolbar">
          <span className="viewer-title">MultiRoof Viewer</span>
          <span className="viewer-info">
            {fileName} — {objectCount} object{objectCount !== 1 ? "s" : ""}
            {model.metadata.referenceSystem && (
              <> — {model.metadata.referenceSystem}</>
            )}
          </span>
          <button
            className="viewer-btn"
            onClick={() => {
              setModel(null);
              setFileName(null);
            }}
          >
            Close
          </button>
        </header>
        <div className="viewer-canvas">
          <CityScene model={model} />
        </div>
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
