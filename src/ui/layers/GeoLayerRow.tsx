/**
 * One row of the "Geospatial Layers" section.
 *
 * A deliberately SMALLER row than a city model's: there is no LoD ladder, no
 * attribute rules, no object types and nothing to pick, so the row carries only
 * what a backdrop layer really has — is it on, what is it called, what kind is
 * it, how strongly is it drawn, how a VECTOR one is drawn (colour, point size,
 * line width, fill opacity — behind a disclosure, since it is four controls in
 * a 240 px panel), and get rid of it. Those four are a flat per-layer style,
 * not the city rows' data-driven rules: there is no parsed model here to write
 * a predicate against.
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
import type { GeoLayerStyle } from "../../features/geoLayers/geoLayerStyle";
import {
  KIND_BADGE,
  KIND_LABEL,
  colorInputValue,
  sourceOf,
} from "./geoLayerMeta";
import { VisibilityIcon } from "./VisibilityIcon";
import { TrashIcon } from "./TrashIcon";
import { ZoomToLayerIcon } from "./ZoomToLayerIcon";

export function GeoLayerRow({
  layer,
  onFlyToGeoLayer,
}: {
  readonly layer: GeoLayer;
  readonly onFlyToGeoLayer?: (geoLayerId: string) => void;
}) {
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

  /** One edited field at a time, but the store takes the WHOLE style — so the
   *  current one is spread and the edit laid over it. Never a partial patch:
   *  see `GeoLayerPatch.style`. */
  const editStyle = (patch: Partial<GeoLayerStyle>) =>
    updateGeoLayer(layer.id, { style: { ...layer.style, ...patch } });

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
        aria-label={layer.visible ? "Hide layer" : "Show layer"}
        data-tooltip={layer.visible ? "Hide layer" : "Show layer"}
        data-tooltip-pos="top"
        data-tooltip-align="start"
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
          routinely want half-strength (to read the city model through it), and
          a vector layer now fades for real — `geoLayerDescriptions` carries the
          layer's opacity into every point/line/polygon material (and multiplies
          the style's own fill opacity by it), which is the answer the earlier
          "a styling question this version does not answer" was waiting on. A
          tileset is still left out: its appearance comes from the tiles' own
          materials, and a slider that did nothing would be worse than none. */}
      {(layer.kind === "raster-xyz" || layer.kind === "geojson") && (
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
        {/* Only the kinds whose extent the app can actually compute: GeoJSON is
            walked, a tileset names its root volume, but an XYZ template names no
            extent at all — a button that always toasted would teach users to
            ignore it. */}
        {onFlyToGeoLayer && layer.kind !== "raster-xyz" && (
          <button
            className="rule-action-btn"
            aria-label="Zoom to layer"
            data-tooltip="Zoom to layer"
            data-tooltip-pos="top"
            data-tooltip-align="end"
            onClick={(e) => {
              e.stopPropagation();
              onFlyToGeoLayer(layer.id);
            }}
          >
            <ZoomToLayerIcon />
          </button>
        )}
        <button
          className="rule-action-btn"
          aria-label="Remove layer"
          data-tooltip="Remove layer"
          data-tooltip-pos="top"
          data-tooltip-align="end"
          onClick={() => removeGeoLayer(layer.id)}
        >
          <TrashIcon />
        </button>
      </div>

      {/* Only a vector layer has these: a raster tile's pixels arrive already
          drawn, and a 3D tileset carries its own materials. COLLAPSED by
          default and wrapped under the row — four controls inline would treble
          the height of every row in a 240 px panel, and the colour is the only
          one most users ever touch.

          The numbers commit on `change` with a bare `Number(...)`: the store
          normalizes on write (a NaN or a zero falls back to the default rather
          than reaching the engine), so the input does not need its own
          validation branch and the field cannot be left in a state the engine
          would choke on. The ONE guarded case is the empty field, which is a
          user mid-edit rather than a value — `Number("")` is 0, so committing
          it would jump a layer sitting at 8 px to the app default of 24 the
          moment its box was cleared for retyping. */}
      {layer.kind === "geojson" && (
        <details className="geo-style">
          <summary className="geo-style-summary">Style</summary>
          <div className="geo-style-fields">
            <label className="geo-style-field">
              <span>Color</span>
              <input
                className="geo-style-color"
                type="color"
                aria-label="Layer color"
                value={colorInputValue(layer.style.color)}
                onChange={(e) => editStyle({ color: e.target.value })}
              />
            </label>

            <label className="geo-style-field">
              <span>Point size</span>
              <input
                className="geo-style-number"
                type="number"
                min={1}
                step={1}
                aria-label="Point size"
                title="Point size, in pixels"
                value={layer.style.pointSizePx}
                onChange={(e) => {
                  if (e.target.value !== "")
                    editStyle({ pointSizePx: Number(e.target.value) });
                }}
              />
            </label>

            <label className="geo-style-field">
              <span>Line width</span>
              <input
                className="geo-style-number"
                type="number"
                min={1}
                step={1}
                aria-label="Line width"
                title="Line width, in pixels"
                value={layer.style.lineWidthPx}
                onChange={(e) => {
                  if (e.target.value !== "")
                    editStyle({ lineWidthPx: Number(e.target.value) });
                }}
              />
            </label>

            <label className="geo-style-field">
              <span>Fill opacity</span>
              <input
                className="geo-style-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                aria-label="Fill opacity"
                title={`Polygon fill opacity — ${Math.round(
                  layer.style.fillOpacity * 100,
                )}% (multiplies the layer's own opacity)`}
                value={layer.style.fillOpacity}
                onChange={(e) =>
                  editStyle({ fillOpacity: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </details>
      )}

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
