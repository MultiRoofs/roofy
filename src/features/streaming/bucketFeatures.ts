/**
 * Splits one query result into cells by bbox centre.
 *
 * This is what lets a commit cost ONE R-tree traversal instead of one per
 * cell. Ownership is post-decode because Feature exposes no bbox.
 */
import type { CityModel, CityObject } from "../../domain/citymodel/types";
import { ownerKey, type CellKey, type Grid } from "./tileGrid";

export function bucketFeatures(
  models: ReadonlyArray<CityModel>,
  grid: Grid,
  level: number,
  residentKeys: ReadonlySet<CellKey>,
): Map<CellKey, CityModel> {
  const out = new Map<
    CellKey,
    { objects: Record<string, CityObject>; meta: CityModel }
  >();

  for (const m of models) {
    for (const obj of Object.values(m.objects)) {
      if (!obj?.bbox) continue;
      const key = ownerKey(grid, obj.bbox, level);
      if (key === null) continue; // non-finite bbox — diagnostics
      if (residentKeys.has(key)) continue; // saves triangulation, not decode
      let entry = out.get(key);
      if (!entry) {
        entry = { objects: {}, meta: m };
        out.set(key, entry);
      }
      entry.objects[obj.id] = obj;
    }
  }

  const result = new Map<CellKey, CityModel>();
  for (const [key, { objects, meta }] of out) {
    result.set(key, {
      sourceEncoding: "flatcitybuf",
      metadata: meta.metadata,
      bbox: meta.bbox,
      vertexCount: 0,
      objects,
    });
  }
  return result;
}
