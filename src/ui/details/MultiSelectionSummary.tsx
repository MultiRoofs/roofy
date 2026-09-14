/**
 * The multi-selection summary — "3 buildings selected" with aggregates: total
 * roof area, height (mean · min–max) and roof-type counts, then the id list
 * with an × to drop one.
 */
import type { CityObject } from "../../domain/citymodel/types";
import { computeTotalRoofArea } from "../../domain/geometry/derived";
import { shortId } from "./subject";

export function MultiSelectionSummary({
  objects,
  partsByObjectId = {},
  roofAreaByObjectId,
  onToggle,
}: {
  readonly objects: ReadonlyArray<CityObject>;
  readonly partsByObjectId?: Readonly<
    Record<string, ReadonlyArray<CityObject>>
  >;
  /** Resident-streaming roofs have metrics but no rings. null means evicted/unavailable. */
  readonly roofAreaByObjectId?: Readonly<Record<string, number | null>>;
  readonly onToggle: (objectId: string) => void;
}) {
  const totalRoofArea = roofAreaByObjectId
    ? objects.reduce<number | null>((sum, object) => {
        const area = roofAreaByObjectId[object.id];
        return sum === null || area === null || area === undefined
          ? null
          : sum + area;
      }, 0)
    : objects.reduce(
        (sum, object) =>
          sum +
          [object, ...(partsByObjectId[object.id] ?? [])].reduce(
            (area, owner) => area + computeTotalRoofArea(owner),
            0,
          ),
        0,
      );

  const heights = objects
    .map((o) => o.attributes.measuredHeight)
    .filter((v): v is number => typeof v === "number");
  const meanHeight =
    heights.length > 0
      ? heights.reduce((a, b) => a + b, 0) / heights.length
      : null;
  const minHeight = heights.length > 0 ? Math.min(...heights) : null;
  const maxHeight = heights.length > 0 ? Math.max(...heights) : null;

  const roofTypes = new Map<string, number>();
  for (const o of objects) {
    const t = o.attributes.roofType;
    if (typeof t === "string") roofTypes.set(t, (roofTypes.get(t) ?? 0) + 1);
  }

  return (
    <section className="details-section">
      <h3 className="details-section-title">
        {objects.length} buildings selected
      </h3>
      <p className="details-note">
        Aggregates over the {objects.length} selected buildings
      </p>
      <div className="attr-row">
        <span className="attr-key">Roof area</span>
        <span className="attr-value">
          {totalRoofArea === null
            ? "Unavailable"
            : `${totalRoofArea.toFixed(1)} m²`}
        </span>
      </div>
      {meanHeight !== null && minHeight !== null && maxHeight !== null && (
        <div className="attr-row">
          <span className="attr-key">Height</span>
          <span className="attr-value">
            {meanHeight.toFixed(1)} m · {minHeight.toFixed(1)}–
            {maxHeight.toFixed(1)}
          </span>
        </div>
      )}
      {[...roofTypes.entries()].map(([type, count]) => (
        <div key={type} className="attr-row">
          <span className="attr-key">{type}</span>
          <span className="attr-value">{count}</span>
        </div>
      ))}
      <div className="details-id-list">
        {objects.map((o) => (
          <div key={o.id} className="details-id-entry">
            <span className="details-id-entry-label" title={o.id}>
              {shortId(o.id)}
            </span>
            <button
              className="details-id-remove"
              title={`Remove ${o.id}`}
              onClick={() => onToggle(o.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
