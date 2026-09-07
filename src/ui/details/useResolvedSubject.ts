/**
 * Resolves a BUILDING subject's roof metrics — the one source for the
 * building SUMMARY and RULE MATCH numbers.
 *
 * A STATIC layer's `CityObject.surfaces` are already resident, so the roofs
 * are computed synchronously. A STREAMING layer's resident model ships each
 * object's `roofMetrics` (precomputed by the worker) but no rings, so the
 * roofs are read from the resident records and `loading` is true until the
 * selected object and its parts are resident — the panel must wait rather
 * than show a blank summary (the same reason `InspectorPanel` gated on the
 * surfaces fetch). Surface subjects are handled by the panel directly.
 */
import { useMemo } from "react";
import { computeRoofMetrics } from "@cityjson/navara-core";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import type { CityObject } from "../../domain/citymodel/types";
import { resolveInheritedAttributes } from "../../domain/citymodel/inheritedAttributes";
import { useLayerStore } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import type { ResolvedBuilding, ResolvedSurface, Subject } from "./subject";

/** A resident record as a ring-less `CityObject`, with inherited attributes
 *  resolved exactly as the static path does. */
function cityObjectFromRecord(
  record: ResidentObjectRecord,
  records: Readonly<Record<string, ResidentObjectRecord>>,
): CityObject {
  return {
    id: record.id,
    objectType: record.objectType,
    attributes: resolveInheritedAttributes(records, record).attributes,
    surfaces: [],
    bbox: record.bbox,
    children: record.children,
    parents: record.parents,
    lod: record.lod,
  };
}

function roofsOfStaticObject(object: CityObject): ResolvedSurface[] {
  return object.surfaces
    .filter((s) => s.type === "RoofSurface")
    .map((surface) => ({
      owner: object,
      metrics: computeRoofMetrics(surface),
    }));
}

export function useResolvedBuilding(
  subject: Subject | null,
): ResolvedBuilding | null {
  const layers = useLayerStore((s) => s.layers);
  const streamVersion = useStreamStore((s) =>
    subject !== null && subject.kind === "building"
      ? s.streams[subject.layerId]?.version
      : undefined,
  );

  return useMemo(() => {
    if (subject === null || subject.kind !== "building") return null;
    const layer = layers.find((l) => l.id === subject.layerId);
    if (layer === undefined) return null;

    if (!layer.isStreaming) {
      // Resolve inherited attributes on the object and its parts exactly as
      // the static inspector did, so SUMMARY and RULE MATCH read the same
      // attributes a child would inherit from its parent.
      const objects = layer.model.objects;
      const withInherited = (o: CityObject): CityObject => ({
        ...o,
        attributes: resolveInheritedAttributes(objects, o).attributes,
      });
      const object = withInherited(subject.object);
      const parts = subject.parts.map(withInherited);
      return {
        object,
        parts,
        roofSurfaces: [
          ...roofsOfStaticObject(object),
          ...parts.flatMap(roofsOfStaticObject),
        ],
        loading: false,
      };
    }

    const residentModel = getResidentModel(subject.layerId, streamVersion ?? 0);
    const ids = [subject.objectId, ...subject.object.children];
    const records: Array<{
      record: ResidentObjectRecord;
      object: CityObject;
    }> = [];
    for (const id of ids) {
      const record = residentModel?.objects[id];
      if (record === undefined) {
        return {
          object: subject.object,
          parts: subject.parts,
          roofSurfaces: [],
          loading: true,
        };
      }
      records.push({
        record,
        object: cityObjectFromRecord(record, residentModel!.objects),
      });
    }
    return {
      object: records[0]!.object,
      parts: records.slice(1).map((r) => r.object),
      roofSurfaces: records.flatMap(({ record, object }) =>
        record.roofMetrics.map((metrics) => ({ owner: object, metrics })),
      ),
      loading: false,
    };
  }, [subject, layers, streamVersion]);
}
