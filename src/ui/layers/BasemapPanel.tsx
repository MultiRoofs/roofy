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
 *
 * A scene theme can OVERRIDE the choice without writing it (cartoon demands a
 * pastel sheet, the two dark themes demand none), which is why the picker keeps
 * showing the user's own selection and says, in one muted line, that something
 * else is on screen. A control that has silently stopped mattering reads as
 * broken; one that explains itself reads as deliberate.
 */

import { useBasemapStore } from "../../features/basemap/basemapStore";
import { useSceneThemeStore } from "../../features/sceneTheme/sceneThemeStore";
import {
  isBasemapOverridden,
  THEME_OVERRIDE_HINT,
} from "../../scene/sceneThemePolicy";
import { BASEMAPS, type BasemapId } from "../../scene/basemaps";

export function BasemapPanel() {
  const basemapId = useBasemapStore((s) => s.basemapId);
  const setBasemapId = useBasemapStore((s) => s.setBasemapId);
  const overridden = useSceneThemeStore((s) => isBasemapOverridden(s.theme));

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
      {overridden && (
        <div className="theme-override-hint">{THEME_OVERRIDE_HINT}</div>
      )}
    </div>
  );
}
