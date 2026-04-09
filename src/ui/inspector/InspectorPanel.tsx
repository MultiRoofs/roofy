/**
 * Right-side inspector panel.
 *
 * Shows details about the selected CityObject or surface.
 * Tabs: Object, Surfaces, Analysis, Rules, Solar, Stats.
 */

import { useState } from "react";
import type {
  CityObject,
  BuildingSurfaceType,
} from "../../domain/citymodel/types";
import type { Selection } from "../../domain/selection/types";
import { SURFACE_COLOR_HEX } from "../../shared/surfaceColorMap";
import { useLayerStore } from "../../features/layers/layerStore";
import { ErrorBoundary } from "../ErrorBoundary";
import { AnalysisTab } from "./AnalysisTab";
import { RuleBuilderTab } from "./RuleBuilderTab";
import { SolarTab } from "./SolarTab";
import { StatsTab } from "./StatsTab";

type Tab = "object" | "surfaces" | "analysis" | "rules" | "solar" | "stats";

interface InspectorPanelProps {
  readonly selection: Selection | null;
  readonly onClose: () => void;
  readonly duckdbModelLoaded?: boolean;
}

export function InspectorPanel({
  selection,
  onClose,
  duckdbModelLoaded,
}: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("object");

  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);

  // Derive the model to display based on selection or active layer
  const selectedLayer = selection
    ? layers.find((l) => l.id === selection.layerId)
    : undefined;
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const displayLayer = selectedLayer ?? activeLayer;
  const model = displayLayer?.model;

  const selectedObject: CityObject | undefined =
    selection && model ? model.objects[selection.objectId] : undefined;

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <h3>Inspector</h3>
        <button className="tb-btn" title="Close panel" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="inspector-tabs">
        <button
          className={`inspector-tab ${activeTab === "object" ? "active" : ""}`}
          onClick={() => setActiveTab("object")}
        >
          Object
        </button>
        <button
          className={`inspector-tab ${activeTab === "surfaces" ? "active" : ""}`}
          onClick={() => setActiveTab("surfaces")}
        >
          Surfaces
        </button>
        <button
          className={`inspector-tab ${activeTab === "analysis" ? "active" : ""}`}
          onClick={() => setActiveTab("analysis")}
        >
          Analysis
        </button>
        <button
          className={`inspector-tab ${activeTab === "rules" ? "active" : ""}`}
          onClick={() => setActiveTab("rules")}
        >
          Rules
        </button>
        <button
          className={`inspector-tab ${activeTab === "solar" ? "active" : ""}`}
          onClick={() => setActiveTab("solar")}
        >
          Solar
        </button>
        <button
          className={`inspector-tab ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          Stats
        </button>
      </div>
      <div className="inspector-body">
        <ErrorBoundary fallback="inline" key={activeTab}>
          {activeTab === "rules" ? (
            displayLayer ? (
              <RuleBuilderTab
                model={displayLayer.model}
                layerId={displayLayer.id}
              />
            ) : (
              <div className="inspector-placeholder">No layer selected</div>
            )
          ) : activeTab === "solar" ? (
            <SolarTab />
          ) : activeTab === "stats" ? (
            model ? (
              <StatsTab
                model={model}
                selection={selection}
                duckdbModelLoaded={duckdbModelLoaded}
              />
            ) : (
              <div className="inspector-placeholder">No layer selected</div>
            )
          ) : !selectedObject ? (
            <div className="inspector-placeholder">
              Select an object to inspect
            </div>
          ) : activeTab === "object" ? (
            <ObjectTab object={selectedObject} />
          ) : activeTab === "surfaces" ? (
            <SurfacesTab
              object={selectedObject}
              selectedSurfaceIndex={
                selection?.kind === "surface" ? selection.surfaceIndex : null
              }
            />
          ) : (
            <AnalysisTab
              object={selectedObject}
              selectedSurfaceIndex={
                selection?.kind === "surface" ? selection.surfaceIndex : null
              }
            />
          )}
        </ErrorBoundary>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Object Tab
// ---------------------------------------------------------------------------

function ObjectTab({ object }: { object: CityObject }) {
  return (
    <>
      <div className="attr-section">
        <div className="attr-section-title">Identity</div>
        <AttrRow label="ID" value={object.id} />
        <AttrRow label="Type" value={object.objectType} />
        {object.lod && <AttrRow label="LoD" value={object.lod} />}
        {object.children.length > 0 && (
          <AttrRow
            label="Children"
            value={`${object.children.length} part${object.children.length !== 1 ? "s" : ""}`}
          />
        )}
        {object.parents.length > 0 && (
          <AttrRow label="Parent" value={object.parents.join(", ")} />
        )}
      </div>

      {Object.keys(object.attributes).length > 0 && (
        <div className="attr-section">
          <div className="attr-section-title">Attributes</div>
          {Object.entries(object.attributes).map(([key, value]) => (
            <AttrRow key={key} label={key} value={formatValue(value)} />
          ))}
        </div>
      )}

      <div className="attr-section">
        <div className="attr-section-title">Geometry</div>
        <AttrRow label="Surfaces" value={String(object.surfaces.length)} />
        {object.bbox && (
          <>
            <AttrRow
              label="Extent X"
              value={`${(object.bbox[3] - object.bbox[0]).toFixed(1)} m`}
            />
            <AttrRow
              label="Extent Y"
              value={`${(object.bbox[4] - object.bbox[1]).toFixed(1)} m`}
            />
            <AttrRow
              label="Height"
              value={`${(object.bbox[5] - object.bbox[2]).toFixed(1)} m`}
            />
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Surfaces Tab
// ---------------------------------------------------------------------------

function SurfacesTab({
  object,
  selectedSurfaceIndex,
}: {
  object: CityObject;
  selectedSurfaceIndex: number | null;
}) {
  const counts = new Map<BuildingSurfaceType, number>();
  const indexByType = new Map<BuildingSurfaceType, number[]>();

  for (let i = 0; i < object.surfaces.length; i++) {
    const s = object.surfaces[i]!;
    counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    const indices = indexByType.get(s.type) ?? [];
    indices.push(i);
    indexByType.set(s.type, indices);
  }

  return (
    <div className="attr-section">
      <div className="attr-section-title">Surface Breakdown</div>
      {[...counts.entries()].map(([type, count]) => {
        const isSelected =
          selectedSurfaceIndex !== null &&
          (indexByType.get(type) ?? []).includes(selectedSurfaceIndex);
        return (
          <div
            key={type}
            className={`surface-item ${isSelected ? "selected" : ""}`}
          >
            <div
              className="surface-dot"
              style={{ background: SURFACE_COLOR_HEX[type] }}
            />
            <span>{type}</span>
            <span className="count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function AttrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="attr-row">
      <span className="attr-key">{label}</span>
      <span className="attr-value" title={value}>
        {value}
      </span>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}
