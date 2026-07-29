/**
 * Compact per-object records the main thread needs after a worker fetch.
 *
 * Deliberately excludes ring geometry (`Surface.rings`) — the two
 * main-thread consumers that need rings (rooftop solar scoring, the
 * surfaces tab) act on exactly one selected object at a time, so rings are
 * fetched on demand via the worker's `surfaces` message instead of shipping
 * every object's full geometry on every `fetch`/`recolor`. See
 * `ResidentObjectRecord` in workerProtocol.ts.
 */
import { computeFootprintArea } from "../../domain/geometry/derived";
import { computeRoofMetrics } from "../../domain/roofMetrics/metrics";
import type { CityModel } from "../../domain/citymodel/types";
import type { ResidentObjectRecord } from "./workerProtocol";

export function toObjectRecords(model: CityModel): {
  records: ResidentObjectRecord[];
  surfaceAttrKeys: string[];
} {
  const records: ResidentObjectRecord[] = [];
  const attrKeys = new Set<string>();

  for (const obj of Object.values(model.objects)) {
    // An object with no geometry gets `bbox: null` from parseCityObject, and
    // bucketFeatures already skips such objects when assigning cell
    // ownership (`if (!obj?.bbox) continue`) — so a real streamed CityModel
    // never contains one. Skip defensively rather than fabricate a bbox for
    // ResidentObjectRecord.bbox, which is non-nullable.
    if (!obj.bbox) continue;

    const roofMetrics = obj.surfaces
      .filter((s) => s.type === "RoofSurface")
      .map(computeRoofMetrics);

    for (const surface of obj.surfaces) {
      for (const key of Object.keys(surface.attributes)) attrKeys.add(key);
    }

    const footprintAreaSqM = computeFootprintArea(obj) ?? 0;
    const measuredHeight = obj.attributes.measuredHeight;
    const volumeCuM =
      typeof measuredHeight === "number"
        ? footprintAreaSqM * measuredHeight
        : null;

    records.push({
      id: obj.id,
      objectType: obj.objectType,
      attributes: obj.attributes,
      bbox: obj.bbox,
      lod: obj.lod,
      surfaceCount: obj.surfaces.length,
      roofMetrics,
      footprintAreaSqM,
      volumeCuM,
      parents: obj.parents,
      children: obj.children,
    });
  }

  return { records, surfaceAttrKeys: [...attrKeys].sort() };
}
