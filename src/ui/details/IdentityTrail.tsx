/**
 * The identity trail — the breadcrumb the details panel opens with: "Delft →
 * Building …25028 → Roof surface 12". The layer crumb activates the layer, a
 * building crumb narrows a surface selection back to the whole building, and
 * the last crumb is where we are. Below it the full object id in mono.
 */
import type { TrailCrumb } from "./subject";

export function IdentityTrail({
  trail,
  fullId,
  onActivateLayer,
  onNarrowToBuilding,
}: {
  readonly trail: ReadonlyArray<TrailCrumb>;
  readonly fullId: string | null;
  readonly onActivateLayer: () => void;
  readonly onNarrowToBuilding?: () => void;
}) {
  return (
    <div className="identity-trail">
      <nav className="identity-trail-crumbs" aria-label="Selection">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          if (crumb.act === "activate-layer") {
            return (
              <button
                key={index}
                className="identity-crumb"
                onClick={onActivateLayer}
                title={`Activate ${crumb.label}`}
              >
                {crumb.label}
              </button>
            );
          }
          if (crumb.act === "narrow-to-building" && onNarrowToBuilding) {
            return (
              <button
                key={index}
                className="identity-crumb"
                onClick={onNarrowToBuilding}
                title="Show the whole building"
              >
                {crumb.label}
              </button>
            );
          }
          return (
            <span
              key={index}
              className={`identity-crumb identity-crumb-current${last ? "" : ""}`}
            >
              {crumb.label}
            </span>
          );
        })}
      </nav>
      {fullId !== null && <div className="identity-id">{fullId}</div>}
    </div>
  );
}
