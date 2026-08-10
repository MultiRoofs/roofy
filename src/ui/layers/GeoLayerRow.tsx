/**
 * One row of the "Geospatial Layers" section.
 *
 * A deliberately SMALLER row than a city model's: there is no LoD ladder, no
 * rule styling, no object types and nothing to pick, so the row carries only
 * what a backdrop layer really has — is it on, what is it called, what kind is
 * it, how strongly is it drawn, and get rid of it.
 *
 * Its own component (rather than a branch inside `LayerPanel.map`) because the
 * rename state is per row, and because a row can be in the "the file did not
 * survive the reload" state, which brings a file input with it. Everything
 * here writes straight to `geoLayerStore` — there is no loading pipeline to
 * route through, unlike a city model.
 */
import { useRef, useState } from "react";
import {
  isGeoLayerUnavailable,
  useGeoLayerStore,
  type GeoLayer,
} from "../../features/geoLayers/geoLayerStore";
import { parseGeoJsonText } from "../../features/geoLayers/classifyGeoSource";
import { VisibilityIcon } from "./VisibilityIcon";
import { TrashIcon } from "./TrashIcon";

/** Short, uppercase, and the words a user of these formats would use — the
 *  row is 240 px wide, so "Cesium 3D Tiles tileset" is not an option. */
const KIND_BADGE: Record<GeoLayer["kind"], string> = {
  geojson: "GEOJSON",
  "raster-xyz": "XYZ",
  "3d-tiles": "3D TILES",
};

const KIND_LABEL: Record<GeoLayer["kind"], string> = {
  geojson: "GeoJSON",
  "raster-xyz": "XYZ raster tiles",
  "3d-tiles": "3D Tiles tileset",
};

/** The layer's own source, for the row's tooltip. User-supplied sources carry
 *  no automatic attribution, so showing the URL is what keeps their
 *  provenance inspectable (design §4). */
function sourceOf(layer: GeoLayer): string {
  switch (layer.kind) {
    case "geojson":
      return layer.config.url ?? "loaded from a local file";
    case "raster-xyz":
      return layer.config.urlTemplate;
    case "3d-tiles":
      return layer.config.url;
  }
}

export function GeoLayerRow({ layer }: { readonly layer: GeoLayer }) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);
  const removeGeoLayer = useGeoLayerStore((s) => s.removeGeoLayer);
  const relinkGeoJsonLayer = useGeoLayerStore((s) => s.relinkGeoJsonLayer);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(layer.name);
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const unavailable = isGeoLayerUnavailable(layer);

  const startRename = () => {
    setRenameValue(layer.name);
    setRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed !== "") updateGeoLayer(layer.id, { name: trimmed });
    setRenaming(false);
  };

  const relink = async (file: File): Promise<void> => {
    const result = parseGeoJsonText(await file.text());
    if (!result.ok) {
      setRelinkError(result.error);
      return;
    }
    setRelinkError(null);
    relinkGeoJsonLayer(layer.id, result.data);
  };

  return (
    <div
      className={`layer-item geo-layer-item ${layer.visible ? "" : "layer-hidden"}`}
      data-testid="geo-layer-row"
    >
      <button
        className="layer-vis-btn"
        title={layer.visible ? "Hide layer" : "Show layer"}
        onClick={() => updateGeoLayer(layer.id, { visible: !layer.visible })}
      >
        <VisibilityIcon visible={layer.visible} />
      </button>

      {renaming ? (
        <input
          className="layer-name-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
        />
      ) : (
        <span
          className="layer-name"
          onDoubleClick={startRename}
          title={`${KIND_LABEL[layer.kind]} — ${sourceOf(layer)}\nDouble-click to rename`}
        >
          {layer.name}
        </span>
      )}

      <span className="layer-badge-geo" title={KIND_LABEL[layer.kind]}>
        {KIND_BADGE[layer.kind]}
      </span>

      {/* Only where it means something. A raster overlay is the one kind users
          routinely want half-strength (to read the city model through it);
          fading vector features or a tileset is a styling question this
          version does not answer, and a slider that did nothing visible would
          be worse than none. */}
      {layer.kind === "raster-xyz" && (
        <input
          className="geo-opacity-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={layer.opacity}
          aria-label="Opacity"
          title={`Opacity — ${Math.round(layer.opacity * 100)}%`}
          onChange={(e) =>
            updateGeoLayer(layer.id, { opacity: Number(e.target.value) })
          }
        />
      )}

      <div className="layer-actions">
        <button
          className="rule-action-btn"
          title="Remove layer"
          onClick={() => removeGeoLayer(layer.id)}
        >
          <TrashIcon />
        </button>
      </div>

      {/* The restored-from-a-snapshot state: the document was never persisted
          (too big for localStorage), so the row kept the user's name,
          visibility and opacity and asks for the file back — the same bargain
          `App.tsx` offers for a file-backed city model. */}
      {unavailable && (
        <div className="geo-layer-relink">
          <span className="geo-layer-relink-note">
            Local file needed — this layer&rsquo;s GeoJSON was not saved.
          </span>
          <button
            type="button"
            className="geo-layer-relink-btn"
            aria-label="Re-link GeoJSON file"
            onClick={() => fileInputRef.current?.click()}
          >
            Re-link…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json"
            // Deliberately unlabelled: a hidden input cannot be reached, and
            // the button above is the affordance that carries the name (the
            // same shape `SourcePicker`'s browse control uses).
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so re-selecting the SAME file fires `change` again.
              e.target.value = "";
              if (file) void relink(file);
            }}
          />
          {relinkError !== null && (
            <span className="geo-layer-error" role="alert">
              {relinkError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
