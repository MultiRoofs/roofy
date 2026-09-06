/**
 * One row of the "Geospatial Layers" section.
 *
 * A deliberately SMALLER row than a city model's: there is no LoD ladder, no
 * attribute rules, no object types and nothing to pick, so the row carries only
 * IDENTITY and ACTIONS — is it on, what is it called, what kind is it, fly to
 * it, get rid of it.
 *
 * Drawing config (the layer opacity and a vector layer's colour, point size,
 * line width and fill opacity) is NOT here: it lives in `GeoLayerInspector`,
 * which follows the workspace's active layer and has the width to lay six
 * controls out as a form. Squeezed into a 240 px row they had to hide behind a disclosure
 * and still trebled its height; a row that stays one line is the point.
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
import { useWorkspaceStore } from "../../features/workspace/workspaceStore";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { KIND_BADGE, KIND_LABEL, sourceOf } from "./geoLayerMeta";
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
  // The SAME id a city row reads: a geo layer and a city model take turns
  // being the one layer the inspector, the legend and the highlight describe.
  const activeLayerId = useWorkspaceStore((s) => s.activeLayerId);

  const isActive = layer.id === activeLayerId;

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
      className={`layer-item geo-layer-item ${isActive ? "layer-active" : ""} ${layer.visible ? "" : "layer-hidden"}`}
      data-testid="geo-layer-row"
      onClick={() => activateLayer(layer.id)}
    >
      <button
        className="layer-vis-btn"
        aria-label={layer.visible ? "Hide layer" : "Show layer"}
        data-tooltip={layer.visible ? "Hide layer" : "Show layer"}
        data-tooltip-pos="top"
        data-tooltip-align="start"
        onClick={(e) => {
          e.stopPropagation();
          updateGeoLayer(layer.id, { visible: !layer.visible });
        }}
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
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="layer-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startRename();
          }}
          title={`${KIND_LABEL[layer.kind]} — ${sourceOf(layer)}\nDouble-click to rename`}
        >
          {layer.name}
        </span>
      )}

      <span className="layer-badge-geo" title={KIND_LABEL[layer.kind]}>
        {KIND_BADGE[layer.kind]}
      </span>

      <div className="layer-actions">
        {/* Only the kinds whose extent the app can actually compute: GeoJSON is
            walked, a tileset names its root volume, but an XYZ template names no
            extent at all — a button that always toasted would teach users to
            ignore it. An UNLINKED row (restored from a snapshot, no data and no
            url) is the same case for the same reason: there is nothing to walk
            until the file comes back. */}
        {onFlyToGeoLayer && layer.kind !== "raster-xyz" && !unavailable && (
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
          onClick={(e) => {
            e.stopPropagation();
            removeGeoLayer(layer.id);
          }}
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
