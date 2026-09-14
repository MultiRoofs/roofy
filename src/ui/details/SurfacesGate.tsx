/**
 * Streaming surfaces-fetch gate — shared loading/error/ready rendering for
 * views that need a streaming object's ring geometry, which only the worker
 * fetch provides (a `ResidentObjectRecord` carries no rings).
 *
 * Moved out of `InspectorPanel` (where it was a private helper) so the
 * details panel can reuse the same loading/error/ready states without
 * importing the inspector.
 */
import type { Surface } from "../../domain/citymodel/types";
import type { SurfacesFetchState } from "../../features/streaming/useResidentSurfaces";

export function SurfacesGate({
  fetch,
  render,
}: {
  readonly fetch: SurfacesFetchState;
  readonly render: (surfaces: ReadonlyArray<Surface>) => React.ReactNode;
}) {
  if (fetch.status === "ready") return <>{render(fetch.surfaces)}</>;
  if (fetch.status === "error") {
    return (
      <div className="details-placeholder">
        Failed to load surfaces: {fetch.message}
      </div>
    );
  }
  return <div className="details-placeholder">{"Loading surfaces\u2026"}</div>;
}
