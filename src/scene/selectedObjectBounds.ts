import type { BBox3 } from "@cityjson/navara-core";

/**
 * The source-space envelope of selected objects and all their descendant
 * parts. A Building commonly has no geometry of its own, so stopping at its
 * own bbox would make fitting a picked building fail.
 */
export function selectedObjectBounds(
  model: {
    readonly objects: Readonly<
      Record<
        string,
        { readonly bbox: BBox3 | null; readonly children: readonly string[] }
      >
    >;
  },
  objectIds: readonly string[],
): BBox3 | null {
  const pending = [...objectIds];
  const visited = new Set<string>();
  let bounds: [number, number, number, number, number, number] | null = null;

  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    const object = model.objects[id];
    if (!object) continue;
    if (object.bbox) {
      if (bounds === null) bounds = [...object.bbox];
      else {
        bounds[0] = Math.min(bounds[0], object.bbox[0]);
        bounds[1] = Math.min(bounds[1], object.bbox[1]);
        bounds[2] = Math.min(bounds[2], object.bbox[2]);
        bounds[3] = Math.max(bounds[3], object.bbox[3]);
        bounds[4] = Math.max(bounds[4], object.bbox[4]);
        bounds[5] = Math.max(bounds[5], object.bbox[5]);
      }
    }
    pending.push(...object.children);
  }

  return bounds;
}
