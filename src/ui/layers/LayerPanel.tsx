/**
 * Layer management panel for the inspector.
 *
 * TWO titled sections, because the pane holds two kinds of layer that share a
 * word and nothing else:
 *
 *  - **3D City Models** — the app's subject. Rules, LoD, object types,
 *    picking, streaming; each row is dense because each of those is a choice
 *    worth making per layer.
 *  - **Geospatial Layers** — context around it (GeoJSON, XYZ raster tiles, 3D
 *    Tiles). No model, no rules, no LoD, nothing to pick: the row carries
 *    visibility, a name, its kind and — for raster — an opacity.
 *
 * One shared "+ Add Layer" button opens the {@link AddLayerDialog}, whose three
 * tabs are NOT a mirror of these two sections: "City model" and "Geospatial"
 * are, and "Catalog" is a third way INTO the first — it browses the STAC
 * catalog and funnels whatever is picked through the same city-model path. The
 * city-model path itself is unchanged: file drop, browse or remote URL through
 * the same handlers the landing page uses.
 */

import { useState } from "react";
import { AddLayerDialog } from "./AddLayerDialog";
import type { AddUrlResult } from "../stac/StacBrowser";
import { useLayerStore } from "../../features/layers/layerStore";
import type { Layer } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import { closeStreamingLayer } from "../../features/streaming/openStreamingLayer";
import { getStreamPlugin } from "../../features/streaming/streamPlugin";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { LodSelector } from "../sidebar/LodSelector";
import { StreamingLodControl } from "./StreamingLodControl";
import { LayerTypeToggles } from "./LayerTypeToggles";
import { GeoLayerRow } from "./GeoLayerRow";
import { VisibilityIcon } from "./VisibilityIcon";
import { TrashIcon } from "./TrashIcon";

interface LayerPanelProps {
  readonly onAddFile: (file: File) => void;
  /** Several picked files as ONE layer — see {@link AddLayerDialog}. */
  readonly onAddFiles: (files: File[]) => void;
  /** Resolves `{ok: true}` once a layer has landed — see {@link AddLayerDialog}. */
  readonly onAddUrl: (url: string) => Promise<AddUrlResult>;
  readonly loading: boolean;
  readonly onFlyToLayer?: (layerId: string) => void;
}

export function LayerPanel({
  onAddFile,
  onAddFiles,
  onAddUrl,
  loading,
  onFlyToLayer,
}: LayerPanelProps) {
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const setActiveLayer = useLayerStore((s) => s.setActiveLayer);
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const removeLayer = useLayerStore((s) => s.removeLayer);
  const setCameraSync = useLayerStore((s) => s.setCameraSync);
  const geoLayers = useGeoLayerStore((s) => s.layers);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const handleRenameStart = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  };

  const handleRenameCommit = () => {
    if (renamingId && renameValue.trim()) {
      updateLayer(renamingId, { name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  return (
    <div className="attr-section">
      <div className="attr-section-title">3D City Models ({layers.length})</div>

      {layers.map((layer) => {
        const isActive = layer.id === activeLayerId;

        return (
          <div
            key={layer.id}
            className={`layer-item ${isActive ? "layer-active" : ""} ${!layer.visible ? "layer-hidden" : ""}`}
            onClick={() => setActiveLayer(layer.id)}
          >
            <button
              className="layer-vis-btn"
              aria-label={layer.visible ? "Hide layer" : "Show layer"}
              data-tooltip={layer.visible ? "Hide layer" : "Show layer"}
              data-tooltip-pos="top"
              data-tooltip-align="start"
              onClick={(e) => {
                e.stopPropagation();
                updateLayer(layer.id, { visible: !layer.visible });
              }}
            >
              <VisibilityIcon visible={layer.visible} />
            </button>

            {renamingId === layer.id ? (
              <input
                className="layer-name-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCommit();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="layer-name"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleRenameStart(layer.id, layer.name);
                }}
                title={`${layer.name} — double-click to rename`}
              >
                {layer.name}
              </span>
            )}

            {layer.isStreaming && (
              <span
                className="layer-badge-streaming"
                title="Viewport streaming — only cells near the camera are fetched"
              >
                STREAM
              </span>
            )}

            <LayerObjectCount layer={layer} />

            {/* A streaming layer's LoD is chosen GLOBALLY (its ladder is not
                known until cells arrive, so a per-layer dropdown would be
                empty exactly when first looked at) — see
                `StreamingLodControl`. What it gets here instead is the one
                choice that IS per-layer: whether to keep following the
                camera. */}
            {layer.isStreaming ? (
              <button
                className={`layer-sync-btn ${layer.cameraSync ? "is-on" : ""}`}
                aria-pressed={layer.cameraSync}
                title={
                  layer.cameraSync
                    ? "Following the camera — click to freeze this extract"
                    : "Frozen — click to follow the camera again"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setCameraSync(layer.id, !layer.cameraSync);
                }}
              >
                {layer.cameraSync ? "SYNC" : "FROZEN"}
              </button>
            ) : (
              <LodSelector
                layerId={layer.id}
                availableLods={layer.availableLods}
                selectedLod={layer.selectedLod}
                isStreaming={layer.isStreaming}
                lodMode={layer.lodMode}
              />
            )}

            <div className="layer-actions">
              {onFlyToLayer && (
                <button
                  className="rule-action-btn"
                  aria-label="Zoom to layer"
                  data-tooltip="Zoom to layer"
                  data-tooltip-pos="top"
                  data-tooltip-align="end"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFlyToLayer(layer.id);
                  }}
                >
                  {/* Locate/crosshair, not the old circle-plus-four-lines: that
                      glyph read as a compass rose (a bearing, not a target). */}
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="7" />
                    <circle
                      cx="12"
                      cy="12"
                      r="1.5"
                      fill="currentColor"
                      stroke="none"
                    />
                    <line x1="12" y1="2" x2="12" y2="5" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="2" y1="12" x2="5" y2="12" />
                    <line x1="19" y1="12" x2="22" y2="12" />
                  </svg>
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
                  // Before the store entry goes: the stream is only reachable
                  // BY layer id, so dropping the layer first would strand the
                  // worker and its cell meshes for the lifetime of the tab.
                  // A no-op for a static layer.
                  closeStreamingLayer(getStreamPlugin(), layer.id);
                  removeLayer(layer.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>

            {/* Last in the row on purpose: the expanded list is a wrapped
                full-width block, and a flex line wraps at the element that
                does not fit — anything after it would land below the list. */}
            <LayerTypeToggles layer={layer} />
          </div>
        );
      })}

      {/* Below the city-model list and INSIDE its section, because it governs
          every streaming layer rather than the selected one — and a streaming
          layer is a city model. Renders nothing when none are open. */}
      <StreamingLodControl />

      {/* The second section. Rendered even when empty: an absent heading reads
          as "this viewer cannot do that", and the empty line below points at
          the one button that fills it. */}
      <div className="attr-section-title geo-section-title">
        Geospatial Layers ({geoLayers.length})
      </div>
      {geoLayers.length === 0 ? (
        <p className="layer-section-empty">
          No geospatial layers. Add GeoJSON, XYZ tiles or a 3D Tiles tileset
          below.
        </p>
      ) : (
        geoLayers.map((geoLayer) => (
          <GeoLayerRow key={geoLayer.id} layer={geoLayer} />
        ))
      )}

      {/* The sidebar is 180–480 px wide, so adding a source opens a real
          modal rather than unfolding a form in the layer list: a drop zone
          needs a target big enough to aim at, and the URL field needs room to
          show the URL being pasted into it. */}
      <button
        className="layer-add-btn"
        aria-haspopup="dialog"
        aria-expanded={addDialogOpen}
        onClick={() => setAddDialogOpen(true)}
      >
        + Add Layer
      </button>

      {addDialogOpen && (
        <AddLayerDialog
          onClose={() => setAddDialogOpen(false)}
          onAddFile={onAddFile}
          onAddFiles={onAddFiles}
          onAddUrl={onAddUrl}
          loading={loading}
        />
      )}
    </div>
  );
}

/**
 * The per-layer object-count badge, split out into its own component so its
 * `useStreamStore` subscription (needed only for a streaming layer) doesn't
 * violate Rules of Hooks inside `LayerPanel`'s `.map()` — the number of rows
 * changes whenever a layer is added or removed, so a hook call directly
 * inside that callback would call a different number of hooks across
 * renders. A dedicated component per row sidesteps that: each mounted
 * instance has its own stable hook order.
 *
 * A streaming layer's `model.objects` is never populated — see
 * residentModel.ts's doc comment — so this reads the resident count from
 * `getResidentModel` instead of `Object.keys(layer.model.objects).length`.
 * Labelled "features" (never "buildings": one FlatCityBuf feature can carry
 * a Building plus several BuildingParts, so a building count wouldn't add
 * up against anything) and explicitly qualified as the RESIDENT CACHE, not
 * "visible area" — the cover includes a one-cell margin and the LRU keeps
 * cells after they leave view, so this number can outlive what's on screen.
 * There is no "n of total" here: the header's total feature count and this
 * resident count aren't the same unit (see duckdb.ts/App.tsx's DuckDB
 * gating for the fuller version of this reasoning) so a denominator would
 * invite exactly the false precision this task exists to remove.
 */
function LayerObjectCount({ layer }: { readonly layer: Layer }) {
  const streamVersion = useStreamStore((s) => s.streams[layer.id]?.version);

  if (!layer.isStreaming) {
    const objectCount = Object.keys(layer.model.objects).length;
    return <span className="layer-meta">{objectCount}</span>;
  }

  const resident = getResidentModel(layer.id, streamVersion ?? 0);
  const featureWord = resident.featureCount === 1 ? "feature" : "features";
  const cellWord = resident.cellCount === 1 ? "cell" : "cells";

  return (
    <span
      className="layer-meta layer-meta-streaming"
      title={`Resident cache: ${resident.featureCount} ${featureWord} loaded across ${resident.cellCount} resident ${cellWord}. Reflects what's currently held in memory — including a margin around the viewport and cells not yet evicted — not exactly what's on screen right now.`}
    >
      {resident.featureCount} {featureWord}
    </span>
  );
}
