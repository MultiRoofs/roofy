/**
 * The right panel's details view — the selection's identity, summary, rule
 * match, attributes, parts and geometry. Replaces `InspectorPanel` (T33) and
 * `GeoFeatureDetailsTemp` (deleted in T33).
 *
 * Owns its header: the identity trail is the only identity UI, and the ×
 * clears the selection (city and geo alike) via `onClose`. Sections follow
 * the design spec's order — SUMMARY, RULE MATCH, ATTRIBUTES, PARTS, GEOMETRY —
 * plus the multi-selection summary and the geo feature view for their
 * subjects.
 */
import { useMemo, useState } from "react";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { useLayerStore } from "../../features/layers/layerStore";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import type { CityObject } from "../../domain/citymodel/types";
import { computeRoofMetrics } from "@cityjson/navara-core";
import {
  subjectOf,
  identityTrail,
  buildingSummary,
  surfaceSummary,
  type Subject,
  type TrailCrumb,
} from "./subject";
import { useResolvedBuilding } from "./useResolvedSubject";
import { ruleMatchFor } from "./ruleMatch";
import { IdentityTrail } from "./IdentityTrail";
import { SummarySection } from "./SummarySection";
import { AttributesSection } from "./AttributesSection";
import { RuleMatchSection } from "./RuleMatchSection";
import { PartsSection } from "./PartsSection";
import { GeometrySection } from "./GeometrySection";
import { MultiSelectionSummary } from "./MultiSelectionSummary";
import { GeoFeatureDetails } from "./GeoFeatureDetails";

export function DetailsPanel({ onClose }: { readonly onClose: () => void }) {
  const selections = useSelectionStore((s) => s.selections);
  const geoSelection = useSelectionStore((s) => s.geoSelection);
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const streamVersion = useStreamStore((s) =>
    selections.length > 0
      ? s.streams[selections[0]!.layerId]?.version
      : undefined,
  );

  const resolveObject = useMemo(() => {
    return (layerId: string, id: string): CityObject | null => {
      const layer = layers.find((l) => l.id === layerId);
      if (layer === undefined) return null;
      if (!layer.isStreaming) return layer.model.objects[id] ?? null;
      const record = getResidentModel(layerId, streamVersion ?? 0)?.objects[id];
      if (record === undefined) return null;
      return {
        id: record.id,
        objectType: record.objectType,
        attributes: record.attributes,
        surfaces: [],
        bbox: record.bbox,
        children: record.children,
        parents: record.parents,
        lod: record.lod,
      };
    };
  }, [layers, streamVersion]);

  const subject = useMemo(
    () => subjectOf(selections, geoSelection, resolveObject),
    [selections, geoSelection, resolveObject],
  );

  const layerName = useMemo(() => {
    if (subject === null) return "Selection";
    if (subject.kind === "geo") {
      return (
        geoLayers.find((l) => l.id === subject.geoLayerId)?.name ?? "Feature"
      );
    }
    return layers.find((l) => l.id === subject.layerId)?.name ?? "Layer";
  }, [subject, layers, geoLayers]);

  if (subject === null) {
    return (
      <aside className="details-panel">
        <DetailsHeader onClose={onClose} />
        <div className="details-body">
          <div className="details-placeholder">Select an object to inspect</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="details-panel">
      <DetailsHeader
        onClose={onClose}
        trail={identityTrail(subject, layerName)}
        fullId={fullIdOf(subject)}
        onActivateLayer={() =>
          activateLayer(
            subject.kind === "geo" ? subject.geoLayerId : subject.layerId,
          )
        }
        onNarrowToBuilding={
          subject.kind === "surface"
            ? () =>
                useSelectionStore.getState().select({
                  kind: "object",
                  layerId: subject.layerId,
                  objectId: subject.objectId,
                })
            : undefined
        }
      />
      <div className="details-body">
        {subject.kind === "building" ? (
          <BuildingDetails subject={subject} />
        ) : subject.kind === "surface" ? (
          <SurfaceDetails subject={subject} />
        ) : subject.kind === "multi" ? (
          <MultiSelectionSummary
            objects={subject.objects}
            onToggle={(objectId) =>
              useSelectionStore.getState().toggleSelect({
                kind: "object",
                layerId: subject.layerId,
                objectId,
              })
            }
          />
        ) : (
          <GeoFeatureDetails selection={geoSelection!} />
        )}
      </div>
    </aside>
  );
}

function DetailsHeader({
  onClose,
  trail,
  fullId,
  onActivateLayer,
  onNarrowToBuilding,
}: {
  readonly onClose: () => void;
  readonly trail?: ReadonlyArray<TrailCrumb>;
  readonly fullId?: string | null;
  readonly onActivateLayer?: () => void;
  readonly onNarrowToBuilding?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="details-header">
      {trail ? (
        <IdentityTrail
          trail={trail}
          fullId={fullId ?? null}
          onActivateLayer={onActivateLayer ?? (() => {})}
          onNarrowToBuilding={onNarrowToBuilding}
        />
      ) : (
        <span className="details-header-title">Details</span>
      )}
      {fullId != null && (
        <button
          className="details-copy"
          title="Copy id"
          onClick={() => {
            void navigator.clipboard?.writeText(fullId);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      <button className="details-close" title="Close panel" onClick={onClose}>
        <svg viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function fullIdOf(subject: Subject): string | null {
  switch (subject.kind) {
    case "building":
    case "surface":
    case "multi":
      return subject.kind === "multi"
        ? subject.objectIds.join(", ")
        : subject.objectId;
    case "geo":
      return null;
  }
}

function BuildingDetails({
  subject,
}: {
  subject: Extract<Subject, { kind: "building" }>;
}) {
  const layer = useLayerStore((s) =>
    s.layers.find((l) => l.id === subject.layerId),
  );
  const resolved = useResolvedBuilding(subject);

  if (layer === undefined) return null;
  if (resolved === null) return null;

  const match = ruleMatchFor(resolved, layer);

  return (
    <>
      {resolved.loading ? (
        <div className="details-placeholder">Loading building…</div>
      ) : (
        <>
          <SummarySection rows={buildingSummary(resolved)} />
          {match !== null && <RuleMatchSection result={match} />}
          <AttributesSection attributes={resolved.object.attributes} />
          <PartsSection
            parts={resolved.parts}
            onSelectSurface={(part, surfaceIndex) => {
              useSelectionStore.getState().setMode("surface");
              useSelectionStore.getState().select({
                kind: "surface",
                layerId: subject.layerId,
                objectId: part.id,
                surfaceIndex,
              });
            }}
          />
          <GeometrySection object={resolved.object} />
        </>
      )}
    </>
  );
}

function SurfaceDetails({
  subject,
}: {
  subject: Extract<Subject, { kind: "surface" }>;
}) {
  const layer = useLayerStore((s) =>
    s.layers.find((l) => l.id === subject.layerId),
  );
  if (layer === undefined) return null;

  const metrics = computeRoofMetrics(subject.surface);
  const match = ruleMatchFor(
    { surface: subject.surface, owner: subject.owner, metrics },
    layer,
  );

  return (
    <>
      <SummarySection
        rows={surfaceSummary(subject.surface, metrics, subject.owner)}
        onSelectOwner={() =>
          useSelectionStore.getState().select({
            kind: "object",
            layerId: subject.layerId,
            objectId: subject.owner.id,
          })
        }
      />
      {match !== null && <RuleMatchSection result={match} />}
      <AttributesSection attributes={subject.owner.attributes} />
      <GeometrySection object={subject.owner} />
    </>
  );
}
