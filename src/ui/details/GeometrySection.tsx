/**
 * The GEOMETRY section — LoD, geometry type, surface-type counts, vertex
 * count, the bounding box in mono, and a "Raw object" button that 12.4's
 * Raw objects view will open (disabled with a note until then).
 */
import type { CityObject } from "../../domain/citymodel/types";
import { AttrRow } from "../inspector/attrDisplay";

export function GeometrySection({
  object,
  parts = [],
  onRawObject,
  geometryAvailable = true,
}: {
  readonly object: CityObject;
  readonly parts?: ReadonlyArray<CityObject>;
  readonly onRawObject?: (objectId: string) => void;
  readonly geometryAvailable?: boolean;
}) {
  const owners = [object, ...parts];
  const counts = new Map<string, number>();
  let vertices = 0;
  for (const owner of owners)
    for (const surface of owner.surfaces) {
      counts.set(surface.type, (counts.get(surface.type) ?? 0) + 1);
      for (const ring of surface.rings) vertices += ring.length;
    }

  const roof = counts.get("RoofSurface") ?? 0;
  const wall = counts.get("WallSurface") ?? 0;
  const ground = counts.get("GroundSurface") ?? 0;
  const lods = [
    ...new Set(
      owners.flatMap((owner) => (owner.lod === null ? [] : [owner.lod])),
    ),
  ];
  const bbox = combinedBBox(owners);

  return (
    <section className="details-section">
      <h3 className="details-section-title">Geometry</h3>
      {lods.length > 0 && (
        <AttrRow
          label={lods.length === 1 ? "LoD" : "LoDs"}
          value={lods.join(", ")}
        />
      )}
      <AttrRow label="Object type" value={object.objectType} />
      <AttrRow
        label="Roof surfaces"
        value={geometryAvailable ? String(roof) : "Unavailable"}
      />
      <AttrRow
        label="Wall surfaces"
        value={geometryAvailable ? String(wall) : "Unavailable"}
      />
      <AttrRow
        label="Ground surfaces"
        value={geometryAvailable ? String(ground) : "Unavailable"}
      />
      <AttrRow
        label="Vertices"
        value={geometryAvailable ? String(vertices) : "Unavailable"}
      />
      {bbox && (
        <div className="attr-row">
          <span className="attr-key">Bounding box</span>
          <span className="attr-value attr-value-mono" title={formatBBox(bbox)}>
            {formatBBox(bbox)}
          </span>
        </div>
      )}
      <button
        className="details-raw-btn"
        onClick={() => onRawObject?.(object.id)}
        disabled={!onRawObject}
        title={
          onRawObject
            ? "Open this object in Raw objects"
            : "Raw object unavailable"
        }
      >
        Raw object
      </button>
    </section>
  );
}

function combinedBBox(objects: ReadonlyArray<CityObject>): CityObject["bbox"] {
  const boxes = objects.flatMap((object) =>
    object.bbox === null ? [] : [object.bbox],
  );
  if (boxes.length === 0) return null;
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.min(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
    Math.max(...boxes.map((box) => box[4])),
    Math.max(...boxes.map((box) => box[5])),
  ];
}

function formatBBox(bbox: ReadonlyArray<number>): string {
  return bbox.map((v) => v.toFixed(1)).join(", ");
}
