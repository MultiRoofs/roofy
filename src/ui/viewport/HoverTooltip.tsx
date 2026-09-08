import { useMemo } from "react";
import { computeRoofMetrics } from "@cityjson/navara-core";
import { useLayerStore } from "../../features/layers/layerStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import "./hoverTooltip.css";

function surfaceName(type: string): string {
  return type.replace(/Surface$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function orientation(azimuth: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(azimuth / 45) % labels.length]!;
}

export function HoverTooltip() {
  const hovered = useSelectionStore((state) => state.hovered);
  const layers = useLayerStore((state) => state.layers);
  const streams = useStreamStore((state) => state.streams);

  const content = useMemo(() => {
    if (hovered === null) return null;
    const layer = layers.find((candidate) => candidate.id === hovered.layerId);
    if (layer === undefined) return null;

    if (layer.isStreaming) {
      const resident = getResidentModel(
        layer.id,
        streams[layer.id]?.version ?? 0,
      );
      const record = resident.objects[hovered.objectId];
      if (record === undefined)
        return { title: "Loading object…", detail: "Currently loading" };
      if (hovered.kind === "surface") {
        return {
          title: "Surface",
          detail: "Surface metrics unavailable for currently loaded data",
        };
      }
      const childRecords = record.children.map((id) => resident.objects[id]);
      if (childRecords.some((child) => child === undefined)) {
        return {
          title: `${record.objectType} · ${record.id}`,
          detail: "Loading parts…",
        };
      }
      const roofCount = [record, ...childRecords].flatMap(
        (item) => item!.roofMetrics,
      ).length;
      return {
        title: `${record.objectType} · ${record.id}`,
        detail:
          roofCount === 0
            ? "Roof metrics unavailable"
            : `${roofCount} roof surfaces · currently loaded`,
      };
    }

    const object = layer.model.objects[hovered.objectId];
    if (object === undefined) return null;
    if (hovered.kind === "surface") {
      const surface = object.surfaces[hovered.surfaceIndex];
      if (surface === undefined) return null;
      if (surface.type !== "RoofSurface")
        return {
          title: `${surfaceName(surface.type)} surface`,
          detail: object.id,
        };
      const metrics = computeRoofMetrics(surface);
      return {
        title: "Roof surface",
        detail: `${metrics.areaSqM.toFixed(1)} m² · ${metrics.inclinationDeg.toFixed(1)}° · ${orientation(metrics.azimuthDeg)}`,
      };
    }
    const parts = object.children
      .map((id) => layer.model.objects[id])
      .filter((part): part is NonNullable<typeof part> => part !== undefined);
    const roofs = [object, ...parts].flatMap((item) =>
      item.surfaces.filter((surface) => surface.type === "RoofSurface"),
    );
    return {
      title: `${object.objectType} · ${object.id}`,
      detail:
        roofs.length === 0
          ? "No roof surfaces"
          : `${roofs.length} roof surfaces`,
    };
  }, [hovered, layers, streams]);

  if (content === null) return null;
  return (
    <div className="city-hover-tooltip" role="status" aria-live="polite">
      <strong>{content.title}</strong>
      <span>{content.detail}</span>
    </div>
  );
}
