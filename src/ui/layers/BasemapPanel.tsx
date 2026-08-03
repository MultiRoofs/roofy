/**
 * Basemap picker.
 *
 * Sits directly above the Google 3D Tiles toggle in the left sidebar, because
 * the two answer the same question — "what is under my buildings?" — and the
 * user needs to see both at once (Google's photorealistic tiles cover the
 * basemap wherever they have coverage, so "None" plus tiles is a real choice).
 *
 * Writes `basemapStore`; `NavaraViewport` turns the selection into an engine
 * `raster-tile` source + `raster` layer, and the active option's attribution
 * into overlay credit lines.
 */

import { useBasemapStore } from "../../features/basemap/basemapStore";
import { BASEMAPS, type BasemapId } from "../../scene/basemaps";

export function BasemapPanel() {
  const basemapId = useBasemapStore((s) => s.basemapId);
  const setBasemapId = useBasemapStore((s) => s.setBasemapId);

  return (
    <div className="attr-section">
      <div className="attr-section-title">Basemap</div>
      <select
        id="basemap-select"
        className="basemap-select"
        aria-label="Basemap"
        value={basemapId}
        onChange={(e) => setBasemapId(e.target.value as BasemapId)}
      >
        {BASEMAPS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </div>
  );
}
