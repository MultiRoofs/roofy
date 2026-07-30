/**
 * Layer management panel for the inspector.
 *
 * Lists all loaded layers with visibility toggles, rename, and remove.
 * Allows adding new layers via file browse, drop, or URL.
 */

import { useCallback, useRef, useState } from "react";
import { useLayerStore } from "../../features/layers/layerStore";
import type { Layer } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import { LodSelector } from "../sidebar/LodSelector";

interface LayerPanelProps {
  readonly onAddFile: (file: File) => void;
  readonly onAddUrl: (url: string) => void;
  readonly loading: boolean;
  readonly onFlyToLayer?: (layerId: string) => void;
}

export function LayerPanel({
  onAddFile,
  onAddUrl,
  loading,
  onFlyToLayer,
}: LayerPanelProps) {
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const setActiveLayer = useLayerStore((s) => s.setActiveLayer);
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const removeLayer = useLayerStore((s) => s.removeLayer);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) onAddFile(file);
    },
    [onAddFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onAddFile(file);
      e.target.value = "";
    },
    [onAddFile],
  );

  const handleAddUrl = () => {
    const trimmed = addUrl.trim();
    if (trimmed) {
      onAddUrl(trimmed);
      setAddUrl("");
      setShowAddForm(false);
    }
  };

  return (
    <div className="attr-section">
      <div className="attr-section-title">Layers ({layers.length})</div>

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
              title={layer.visible ? "Hide layer" : "Show layer"}
              onClick={(e) => {
                e.stopPropagation();
                updateLayer(layer.id, { visible: !layer.visible });
              }}
            >
              {layer.visible ? (
                <svg viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
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

            <LodSelector
              layerId={layer.id}
              availableLods={layer.availableLods}
              selectedLod={layer.selectedLod}
              isStreaming={layer.isStreaming}
              lodMode={layer.lodMode}
            />

            <div className="layer-actions">
              {onFlyToLayer && (
                <button
                  className="rule-action-btn"
                  title="Fly to layer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFlyToLayer(layer.id);
                  }}
                >
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
                    <circle cx="12" cy="12" r="10" />
                    <line x1="22" y1="12" x2="18" y2="12" />
                    <line x1="6" y1="12" x2="2" y2="12" />
                    <line x1="12" y1="6" x2="12" y2="2" />
                    <line x1="12" y1="22" x2="12" y2="18" />
                  </svg>
                </button>
              )}
              <button
                className="rule-action-btn"
                title="Remove layer"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLayer(layer.id);
                }}
              >
                del
              </button>
            </div>
          </div>
        );
      })}

      {showAddForm ? (
        <div className="layer-add-form">
          <div
            className="layer-drop-zone"
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            {loading ? "Loading..." : "Drop file or click to browse"}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.city.json,.jsonl,.city.jsonl,.fcb,.gml,.citygml"
            onChange={handleFileInput}
            hidden
          />
          <div className="rule-form-row">
            <input
              className="rule-input"
              placeholder="Or paste URL..."
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddUrl();
              }}
            />
            <button
              className="rule-save-btn"
              onClick={handleAddUrl}
              disabled={!addUrl.trim() || loading}
            >
              Load
            </button>
          </div>
          <button
            className="rule-cancel-btn"
            onClick={() => setShowAddForm(false)}
            style={{ alignSelf: "flex-end" }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button className="layer-add-btn" onClick={() => setShowAddForm(true)}>
          + Add Layer
        </button>
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
      {resident.featureCount} {featureWord} loaded (resident cache)
    </span>
  );
}
