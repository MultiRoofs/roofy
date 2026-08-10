/**
 * The Add Layer dialog's "Geospatial" tab: a URL field and a drop zone for the
 * three formats the engine reads natively (GeoJSON, XYZ raster tiles, 3D
 * Tiles).
 *
 * Unlike the city-model tab, nothing here routes through the app's loading
 * pipeline: there is no parsing, no CRS gate and no engine call to make. A
 * geospatial layer IS its description, so this writes straight to
 * `geoLayerStore` and the viewport's own effect turns the record into an
 * engine source+layer pair.
 *
 * Two decisions worth stating:
 *  - the kind is CLASSIFIED from the URL's shape, and shown in an override
 *    select rather than applied silently. The classification is a guess by
 *    construction (any URL can serve GeoJSON), so the user always sees it and
 *    can correct it in one click.
 *  - a dropped file is VALIDATED before it becomes a layer. A CityJSON file is
 *    valid JSON with a `type` of its own, and this app's primary format is
 *    CityJSON — so the likeliest mistake here is answered by name, with a
 *    pointer to the tab that reads it.
 */
import { useCallback, useId, useRef, useState } from "react";
import {
  classifyGeoUrl,
  geoLayerFromUrl,
  parseGeoJsonText,
} from "../../features/geoLayers/classifyGeoSource";
import {
  useGeoLayerStore,
  type GeoLayerKind,
} from "../../features/geoLayers/geoLayerStore";

/** The kind select's options, in the order the tab lists them. */
const KIND_OPTIONS: ReadonlyArray<readonly [GeoLayerKind, string]> = [
  ["geojson", "GeoJSON"],
  ["raster-xyz", "XYZ raster tiles"],
  ["3d-tiles", "3D Tiles (tileset.json)"],
];

/** What the file picker offers. `.json` as well as `.geojson`, because plenty
 *  of GeoJSON is published under the plain extension — which is also why the
 *  content, not the name, is what decides (see `parseGeoJsonText`). */
const ACCEPT = ".geojson,.json";

export interface GeospatialSourceFormProps {
  /** Called after a layer has been added, so the dialog can close itself —
   *  the same beat the city-model tab closes on. */
  readonly onAdded: () => void;
}

export function GeospatialSourceForm({ onAdded }: GeospatialSourceFormProps) {
  const addGeoLayer = useGeoLayerStore((s) => s.addGeoLayer);
  const [url, setUrl] = useState("");
  /** `null` = follow the URL's own shape. Set only by the select, so the
   *  detected kind keeps updating as the user types until they disagree. */
  const [kindOverride, setKindOverride] = useState<GeoLayerKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlFieldId = useId();
  const kindFieldId = useId();

  const kind = kindOverride ?? classifyGeoUrl(url);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const input = geoLayerFromUrl(url, kind);
      if (input === null) {
        setError("That is not a valid URL.");
        return;
      }
      addGeoLayer(input);
      onAdded();
    },
    [addGeoLayer, kind, onAdded, url],
  );

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      const result = parseGeoJsonText(await file.text());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      addGeoLayer({
        name: file.name,
        kind: "geojson",
        // INLINE, and knowingly not persistable: the alternative is holding a
        // `File` the browser will not give back after a reload. The layer
        // saves as a re-linkable row instead (see `geoLayerSnapshot`).
        config: { data: result.data },
      });
      onAdded();
    },
    [addGeoLayer, onAdded],
  );

  const isFileDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div className="geo-source-form">
      <form className="fcb-url-form" onSubmit={handleSubmit}>
        <label className="fcb-url-label" htmlFor={urlFieldId}>
          Source URL:
        </label>
        <div className="fcb-url-row">
          <input
            id={urlFieldId}
            type="text"
            className="fcb-url-input"
            placeholder="https://tile.example/{z}/{x}/{y}.png"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
          />
        </div>
        <label className="fcb-url-label" htmlFor={kindFieldId}>
          Layer type:
        </label>
        <div className="fcb-url-row">
          <select
            id={kindFieldId}
            className="geo-kind-select"
            value={kind}
            onChange={(e) => setKindOverride(e.target.value as GeoLayerKind)}
          >
            {KIND_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className="fcb-url-btn" disabled={!url.trim()}>
            Add layer
          </button>
        </div>
        <p className="geo-source-hint">
          Detected from the URL: {"{z}/{x}/{y}"} is a tile template, a path
          ending in tileset.json is 3D Tiles, anything else is GeoJSON.
        </p>
      </form>

      <div
        className={`drop-zone${dragging ? " is-dragging" : ""}`}
        data-testid="geo-drop-zone"
        onDragEnter={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          // Without preventDefault on dragOVER the browser refuses the drop
          // and navigates to the file instead.
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
      >
        <p>
          {dragging
            ? "Release to load this file"
            : "Or drop a GeoJSON file here"}
        </p>
        <p className="drop-or">or</p>
        <button
          type="button"
          className="file-label"
          onClick={() => fileInputRef.current?.click()}
        >
          Browse files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
        <p className="source-picker-formats">.geojson · .json</p>
      </div>

      {error !== null && (
        <p className="geo-source-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
