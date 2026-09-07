/**
 * The PARTS section — a building's parts, each "Part N · height · M roof
 * surfaces" expanding to the part's attributes, with each roof surface a
 * row that switches to surface selection. Static layers only: a streaming
 * part carries no rings, so its roof surfaces cannot be listed here.
 */
import { useState } from "react";
import type { CityObject } from "../../domain/citymodel/types";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";
import { formatSurfaceType } from "./subject";

export function PartsSection({
  parts,
  onSelectSurface,
}: {
  readonly parts: ReadonlyArray<CityObject>;
  readonly onSelectSurface: (part: CityObject, surfaceIndex: number) => void;
}) {
  if (parts.length === 0) return null;
  return (
    <section className="details-section">
      <h3 className="details-section-title">Parts</h3>
      {parts.map((part, index) => (
        <PartRow
          key={part.id}
          part={part}
          index={index}
          onSelectSurface={onSelectSurface}
        />
      ))}
    </section>
  );
}

function PartRow({
  part,
  index,
  onSelectSurface,
}: {
  readonly part: CityObject;
  readonly index: number;
  readonly onSelectSurface: (part: CityObject, surfaceIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const roofs = part.surfaces
    .map((surface, i) => ({ surface, index: i }))
    .filter((s) => s.surface.type === "RoofSurface");

  return (
    <div className="details-part">
      <button
        className="details-part-heading"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Part {index + 1} · {partHeight(part)} · {roofs.length} roof surface
        {roofs.length !== 1 ? "s" : ""}
      </button>
      {open && (
        <div className="details-part-body">
          {Object.entries(part.attributes).map(([key, value]) => (
            <AttrRow key={key} label={key} value={formatValue(value)} />
          ))}
          {roofs.map(({ surface, index: surfaceIndex }) => (
            <button
              key={surfaceIndex}
              className="details-surface-row"
              onClick={() => onSelectSurface(part, surfaceIndex)}
            >
              {formatSurfaceType(surface.type)} {surfaceIndex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function partHeight(part: CityObject): string {
  const height = part.attributes.measuredHeight;
  if (typeof height === "number") return `${height.toFixed(1)} m`;
  if (typeof height === "string" && height.trim() !== "") return `${height} m`;
  if (part.bbox) return `${(part.bbox[5] - part.bbox[2]).toFixed(1)} m`;
  return "—";
}
