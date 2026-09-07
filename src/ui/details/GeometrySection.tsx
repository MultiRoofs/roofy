/**
 * The GEOMETRY section — LoD, geometry type, surface-type counts, vertex
 * count, the bounding box in mono, and a "Raw object" button that 12.4's
 * Raw objects view will open (disabled with a note until then).
 */
import type { CityObject } from "../../domain/citymodel/types";
import { AttrRow } from "../inspector/attrDisplay";

export function GeometrySection({ object }: { readonly object: CityObject }) {
  const counts = new Map<string, number>();
  let vertices = 0;
  for (const surface of object.surfaces) {
    counts.set(surface.type, (counts.get(surface.type) ?? 0) + 1);
    for (const ring of surface.rings) vertices += ring.length;
  }

  const roof = counts.get("RoofSurface") ?? 0;
  const wall = counts.get("WallSurface") ?? 0;
  const ground = counts.get("GroundSurface") ?? 0;

  return (
    <section className="details-section">
      <h3 className="details-section-title">Geometry</h3>
      {object.lod && <AttrRow label="LoD" value={object.lod} />}
      <AttrRow label="Type" value={object.objectType} />
      <AttrRow label="Roof surfaces" value={String(roof)} />
      <AttrRow label="Wall surfaces" value={String(wall)} />
      <AttrRow label="Ground surfaces" value={String(ground)} />
      <AttrRow label="Vertices" value={String(vertices)} />
      {object.bbox && (
        <div className="attr-row">
          <span className="attr-key">Bounding box</span>
          <span
            className="attr-value attr-value-mono"
            title={formatBBox(object.bbox)}
          >
            {formatBBox(object.bbox)}
          </span>
        </div>
      )}
      <button
        className="details-raw-btn"
        disabled
        data-temporary="12.4"
        title="Coming in 12.4"
      >
        Raw object
      </button>
    </section>
  );
}

function formatBBox(bbox: ReadonlyArray<number>): string {
  return bbox.map((v) => v.toFixed(1)).join(", ");
}
