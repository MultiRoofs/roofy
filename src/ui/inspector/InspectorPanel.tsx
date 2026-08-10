/**
 * Right-side inspector panel.
 *
 * Shows details about the selected CityObject(s) or surface.
 * Supports multi-select with statistical aggregation.
 * Tabs: Object, Surfaces, Analysis, Rules, Stats.
 *
 * There is no Solar tab: the scene clock, the seasonal presets and the sun
 * readout are all scene-wide configuration, so they live outside this panel —
 * all of it in `ui/toolbar/SolarMenu.tsx`, one popover off the header. This
 * panel is about the current selection.
 */

import { useEffect, useState } from "react";
import type {
  BBox3,
  BuildingSurfaceType,
  CityObject,
  Surface,
} from "../../domain/citymodel/types";
import type { Selection } from "../../domain/selection/types";
import { SURFACE_COLOR_HEX, computeFootprintArea } from "@cityjson/navara-core";
import { useLayerStore } from "../../features/layers/layerStore";
import { resolveInheritedAttributes } from "../../domain/citymodel/inheritedAttributes";
import { useStreamStore } from "../../features/streaming/streamStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import {
  useObjectSurfaces,
  type SurfacesFetchState,
} from "../../features/streaming/useResidentSurfaces";
import { ErrorBoundary } from "../ErrorBoundary";
import { AnalysisTab } from "./AnalysisTab";
import { RuleBuilderTab } from "./RuleBuilderTab";
import { StatsTab } from "./StatsTab";
import {
  computeTotalRoofArea,
  computeVolume,
} from "../../domain/geometry/derived";

type Tab = "object" | "surfaces" | "analysis" | "rules" | "stats";
type AggMode = "sum" | "avg" | "min" | "max";

interface InspectorPanelProps {
  readonly selections: ReadonlyArray<Selection>;
  readonly onClose: () => void;
  readonly duckdbModelLoaded?: boolean;
}

// ---------------------------------------------------------------------------
// Object display data — normalizes a static CityObject or a streaming
// ResidentObjectRecord into the shape the Object/Analysis-summary views
// need, so those views don't have to branch on which kind of layer they're
// looking at. A ResidentObjectRecord carries no ring geometry, so its
// footprint/roof-area/volume are read from precomputed fields instead of
// being derived from Surface.rings — see `@cityjson/navara-flatcitybuf`'s
// workerProtocol.ts, which declares ResidentObjectRecord, for why.
// ---------------------------------------------------------------------------

interface ObjectDisplayData {
  readonly id: string;
  readonly objectType: string;
  readonly lod: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly children: ReadonlyArray<string>;
  readonly parents: ReadonlyArray<string>;
  readonly surfaceCount: number;
  readonly bbox: BBox3 | null;
  readonly footprintAreaSqM: number | null;
  readonly roofAreaSqM: number;
  readonly volumeCuM: number | null;
}

/**
 * @param objects the layer's whole object map, so a child can inherit its
 * parent's attributes. In CityJSON the geometry and the semantics are usually
 * on DIFFERENT objects — a picked `BuildingPart` has none of its own — so
 * without this every building in the Delft dataset read as attribute-less.
 * See `domain/citymodel/inheritedAttributes.ts`.
 */
function displayDataFromObject(
  object: CityObject,
  objects: Readonly<Record<string, CityObject>>,
): ObjectDisplayData {
  return {
    id: object.id,
    objectType: object.objectType,
    lod: object.lod,
    attributes: resolveInheritedAttributes(objects, object).attributes,
    children: object.children,
    parents: object.parents,
    surfaceCount: object.surfaces.length,
    bbox: object.bbox,
    footprintAreaSqM: computeFootprintArea(object),
    roofAreaSqM: computeTotalRoofArea(object),
    volumeCuM: computeVolume(object),
  };
}

function displayDataFromRecord(
  record: ResidentObjectRecord,
  records: Readonly<Record<string, ResidentObjectRecord>>,
): ObjectDisplayData {
  return {
    id: record.id,
    objectType: record.objectType,
    lod: record.lod,
    // Streaming splits Building/BuildingPart exactly as the static path does,
    // so it needs the same inheritance — see displayDataFromObject.
    attributes: resolveInheritedAttributes(records, record).attributes,
    children: record.children,
    parents: record.parents,
    surfaceCount: record.surfaceCount,
    bbox: record.bbox,
    footprintAreaSqM: record.footprintAreaSqM,
    // roofMetrics already carries each RoofSurface's area (computed by the
    // worker when the cell was decoded) — no rings needed to sum it.
    roofAreaSqM: record.roofMetrics.reduce((sum, m) => sum + m.areaSqM, 0),
    volumeCuM: record.volumeCuM,
  };
}

export function InspectorPanel({
  selections,
  onClose,
  duckdbModelLoaded,
}: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("object");

  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);

  const selection = selections.length > 0 ? selections[0]! : null;
  const isMultiSelect = selections.length > 1;

  // Derive the model to display based on selection or active layer
  const selectedLayer = selection
    ? layers.find((l) => l.id === selection.layerId)
    : undefined;
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const displayLayer = selectedLayer ?? activeLayer;

  // Rules are per-layer, but the rest of this panel follows the SELECTION —
  // so the Rules tab lets its target be steered independently. The override
  // is deliberately transient: it resets whenever the panel's own layer
  // changes, so the tab's default target is always the layer being inspected.
  const [ruleTargetOverride, setRuleTargetOverride] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setRuleTargetOverride(null);
  }, [displayLayer?.id]);
  const ruleTargetLayer =
    layers.find((l) => l.id === ruleTargetOverride) ?? displayLayer;

  const model = displayLayer?.model;
  const isStreaming = displayLayer?.isStreaming ?? false;

  // Only meaningful for a streaming displayLayer; unused (and effectively
  // constant) otherwise, but always subscribed so hook order stays stable.
  const streamVersion = useStreamStore((s) =>
    displayLayer ? s.streams[displayLayer.id]?.version : undefined,
  );
  const streamHandle = useStreamStore((s) =>
    displayLayer ? s.streams[displayLayer.id]?.handle : undefined,
  );

  const residentModel =
    isStreaming && displayLayer
      ? getResidentModel(displayLayer.id, streamVersion ?? 0)
      : null;

  // Resolve the display data for single- and multi-select from whichever
  // source this layer actually has resident: `model.objects` (static) or
  // the merged resident model (streaming). A streaming layer's `model` is
  // not a source of truth for objects — see residentModel.ts.
  const selectedObjectsData: ObjectDisplayData[] = [];
  let singleSelectedId: string | null = null;
  if (isStreaming) {
    if (residentModel && selections.length > 0) {
      for (const sel of selections) {
        const record = residentModel.objects[sel.objectId];
        if (record) {
          selectedObjectsData.push(
            displayDataFromRecord(record, residentModel.objects),
          );
        }
      }
    }
    if (!isMultiSelect && selection && residentModel) {
      singleSelectedId = residentModel.objects[selection.objectId]
        ? selection.objectId
        : null;
    }
  } else {
    if (model && selections.length > 0) {
      for (const sel of selections) {
        const obj = model.objects[sel.objectId];
        if (obj) {
          selectedObjectsData.push(displayDataFromObject(obj, model.objects));
        }
      }
    }
    if (!isMultiSelect && selection && model) {
      singleSelectedId = model.objects[selection.objectId]
        ? selection.objectId
        : null;
    }
  }

  const selectedSurfaceIndex =
    selection?.kind === "surface" ? selection.surfaceIndex : null;

  // The one CityObject needed for the static (non-streaming) single-select
  // Surfaces/Analysis tabs, which read `.surfaces` synchronously — no
  // change from before streaming existed.
  const selectedObject: CityObject | undefined =
    !isStreaming && singleSelectedId && model
      ? model.objects[singleSelectedId]
      : undefined;

  // Streaming single-select surfaces fetch — gated on the Surfaces/Analysis
  // tab actually being the one showing, not on "an object is selected".
  // Rings are the one thing a ResidentObjectRecord can't provide (see its
  // doc comment), and the Object tab needs none of them (footprint/roof
  // area/volume all come from precomputed record fields) — so fetching
  // eagerly on every selection would cost a worker round trip the user may
  // never need. Always called (Rules of Hooks); stays "empty" and does
  // nothing when not streaming, nothing selected, or a tab that doesn't
  // need rings is showing.
  const needsSurfaces = activeTab === "surfaces" || activeTab === "analysis";
  const surfacesFetch = useObjectSurfaces(
    isStreaming && needsSurfaces ? (streamHandle ?? null) : null,
    isStreaming && needsSurfaces ? singleSelectedId : null,
  );

  // Static multi-select "surfaces" breakdown needs full per-type surface
  // lists across every selected object — for a streaming layer that would
  // mean an on-demand ring fetch per selected object, which is out of
  // scope here (the async fetch this task adds is for exactly one selected
  // object, per the design's own framing). `null` means "unavailable",
  // rendered as an explicit message rather than a silently empty table.
  const multiSelectSurfaceBreakdown: Array<{
    type: BuildingSurfaceType;
    count: number;
  }> | null = isStreaming
    ? null
    : (() => {
        const counts = new Map<BuildingSurfaceType, number>();
        if (model) {
          for (const sel of selections) {
            const obj = model.objects[sel.objectId];
            if (!obj) continue;
            for (const s of obj.surfaces) {
              counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
            }
          }
        }
        return [...counts.entries()].map(([type, count]) => ({
          type,
          count,
        }));
      })();

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
          className={`inspector-tab ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          Stats
        </button>
      </div>
      <div className="inspector-body">
        <ErrorBoundary fallback="inline" key={activeTab}>
          {activeTab === "rules" ? (
            ruleTargetLayer ? (
              <RuleBuilderTab
                model={ruleTargetLayer.model}
                layerId={ruleTargetLayer.id}
                layerOptions={layers.map((l) => ({ id: l.id, name: l.name }))}
                onSelectLayer={setRuleTargetOverride}
              />
            ) : (
              <div className="inspector-placeholder">No layer selected</div>
            )
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
          ) : selectedObjectsData.length === 0 ? (
            <div className="inspector-placeholder">
              Select an object to inspect
            </div>
          ) : isMultiSelect ? (
            <MultiSelectView
              data={selectedObjectsData}
              activeTab={activeTab}
              surfaceBreakdown={multiSelectSurfaceBreakdown}
            />
          ) : activeTab === "object" ? (
            <ObjectTab data={selectedObjectsData[0]!} />
          ) : activeTab === "surfaces" ? (
            isStreaming ? (
              <SurfacesFetchGate
                fetch={surfacesFetch}
                render={(surfaces) => (
                  <SurfacesTab
                    surfaces={surfaces}
                    selectedSurfaceIndex={selectedSurfaceIndex}
                  />
                )}
              />
            ) : (
              <SurfacesTab
                surfaces={selectedObject!.surfaces}
                selectedSurfaceIndex={selectedSurfaceIndex}
              />
            )
          ) : isStreaming ? (
            <SurfacesFetchGate
              fetch={surfacesFetch}
              render={(surfaces) => (
                <AnalysisTab
                  surfaces={surfaces}
                  selectedSurfaceIndex={selectedSurfaceIndex}
                />
              )}
            />
          ) : (
            <AnalysisTab
              surfaces={selectedObject!.surfaces}
              selectedSurfaceIndex={selectedSurfaceIndex}
            />
          )}
        </ErrorBoundary>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Streaming surfaces-fetch gate — shared loading/error/ready rendering for
// the Surfaces and Analysis tabs when the displayed layer is streaming.
// ---------------------------------------------------------------------------

function SurfacesFetchGate({
  fetch,
  render,
}: {
  readonly fetch: SurfacesFetchState;
  readonly render: (surfaces: ReadonlyArray<Surface>) => React.ReactNode;
}) {
  if (fetch.status === "ready") return <>{render(fetch.surfaces)}</>;
  if (fetch.status === "error") {
    return (
      <div className="inspector-placeholder">
        Failed to load surfaces: {fetch.message}
      </div>
    );
  }
  return (
    <div className="inspector-placeholder">{"Loading surfaces\u2026"}</div>
  );
}

// ---------------------------------------------------------------------------
// Multi-select statistics view
// ---------------------------------------------------------------------------

function MultiSelectView({
  data,
  activeTab,
  surfaceBreakdown,
}: {
  data: ObjectDisplayData[];
  activeTab: Tab;
  surfaceBreakdown: Array<{ type: BuildingSurfaceType; count: number }> | null;
}) {
  const [aggMode, setAggMode] = useState<AggMode>("sum");

  if (activeTab === "surfaces") {
    if (!surfaceBreakdown) {
      return (
        <div className="inspector-placeholder">
          Surface breakdown isn&apos;t available for streaming layers in
          multi-select. Select a single object for surface details.
        </div>
      );
    }

    return (
      <div className="attr-section">
        <div className="attr-section-title">
          Surface Breakdown ({data.length} objects)
        </div>
        {surfaceBreakdown.map(({ type, count }) => (
          <div key={type} className="surface-item">
            <div
              className="surface-dot"
              style={{ background: SURFACE_COLOR_HEX[type] }}
            />
            <span>{type}</span>
            <span className="count">{count}</span>
          </div>
        ))}
      </div>
    );
  }

  // Object tab with aggregated geometry metrics
  const footprintAreas = data.map((d) => d.footprintAreaSqM);
  const roofAreas = data.map((d) => d.roofAreaSqM);
  const volumes = data.map((d) => d.volumeCuM);

  return (
    <>
      <div className="attr-section">
        <div className="attr-section-title">
          Selection ({data.length} objects)
        </div>
        <div className="agg-mode-select">
          <label>Aggregation:</label>
          <select
            value={aggMode}
            onChange={(e) => setAggMode(e.target.value as AggMode)}
          >
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
          </select>
        </div>
      </div>

      <div className="attr-section">
        <div className="attr-section-title">Geometry</div>
        <AttrRow
          label="Footprint area"
          value={formatAggNullable(footprintAreas, aggMode)}
        />
        <AttrRow label="Roof area" value={formatAgg(roofAreas, aggMode)} />
        <AttrRow
          label="Volume"
          value={formatAggNullable(volumes, aggMode, "m\u00B3")}
        />
      </div>
    </>
  );
}

function aggregate(values: number[], mode: AggMode): number {
  if (values.length === 0) return 0;
  switch (mode) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

function formatAgg(values: number[], mode: AggMode, unit = "m\u00B2"): string {
  const v = aggregate(values, mode);
  return `${v.toFixed(1)} ${unit}`;
}

function formatAggNullable(
  values: (number | null)[],
  mode: AggMode,
  unit = "m\u00B2",
): string {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return "N/A";
  const v = aggregate(valid, mode);
  return `${v.toFixed(1)} ${unit}`;
}

// ---------------------------------------------------------------------------
// Object Tab
// ---------------------------------------------------------------------------

function ObjectTab({ data }: { data: ObjectDisplayData }) {
  return (
    <>
      <div className="attr-section">
        <div className="attr-section-title">Identity</div>
        <AttrRow label="ID" value={data.id} />
        <AttrRow label="Type" value={data.objectType} />
        {data.lod && <AttrRow label="LoD" value={data.lod} />}
        {data.children.length > 0 && (
          <AttrRow
            label="Children"
            value={`${data.children.length} part${data.children.length !== 1 ? "s" : ""}`}
          />
        )}
        {data.parents.length > 0 && (
          <AttrRow label="Parent" value={data.parents.join(", ")} />
        )}
      </div>

      {Object.keys(data.attributes).length > 0 && (
        <div className="attr-section">
          <div className="attr-section-title">Attributes</div>
          {Object.entries(data.attributes).map(([key, value]) => (
            <AttrRow key={key} label={key} value={formatValue(value)} />
          ))}
        </div>
      )}

      <div className="attr-section">
        <div className="attr-section-title">Geometry</div>
        <AttrRow label="Surfaces" value={String(data.surfaceCount)} />
        <AttrRow
          label="Footprint area"
          value={
            data.footprintAreaSqM !== null
              ? `${data.footprintAreaSqM.toFixed(1)} m\u00B2`
              : "N/A"
          }
        />
        <AttrRow
          label="Roof area"
          value={`${data.roofAreaSqM.toFixed(1)} m\u00B2`}
        />
        <AttrRow
          label="Volume"
          value={
            data.volumeCuM !== null
              ? `\u2248 ${data.volumeCuM.toFixed(1)} m\u00B3`
              : "N/A"
          }
        />
        {data.bbox && (
          <>
            <AttrRow
              label="Extent X"
              value={`${(data.bbox[3] - data.bbox[0]).toFixed(1)} m`}
            />
            <AttrRow
              label="Extent Y"
              value={`${(data.bbox[4] - data.bbox[1]).toFixed(1)} m`}
            />
            <AttrRow
              label="Height"
              value={`${(data.bbox[5] - data.bbox[2]).toFixed(1)} m`}
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
  surfaces,
  selectedSurfaceIndex,
}: {
  surfaces: ReadonlyArray<Surface>;
  selectedSurfaceIndex: number | null;
}) {
  const counts = new Map<BuildingSurfaceType, number>();
  const indexByType = new Map<BuildingSurfaceType, number[]>();

  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i]!;
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
