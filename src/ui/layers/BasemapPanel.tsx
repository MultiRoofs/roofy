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
 *
 * While the ELEVATION HEATMAP is selected, the title row grows a "Ramp"
 * button opening min/max/log-scale settings — the Netherlands sits at the
 * default ramp's very bottom, so all Dutch ground is one colour until the
 * ceiling comes down to tens of metres. The number inputs commit on
 * blur/Enter, NOT per keystroke like the geo style fields: a commit here
 * tears down and re-adds an engine layer pair, and typing "3200" must not
 * re-drape the globe at "3". The checkbox commits immediately — it is one
 * gesture, not an edit in progress.
 */

import { useEffect, useState } from "react";
import {
  useBasemapStore,
  type HeatmapSettings,
} from "../../features/basemap/basemapStore";
import { useSceneThemeStore } from "../../features/sceneTheme/sceneThemeStore";
import {
  isBasemapOverridden,
  THEME_OVERRIDE_HINT,
} from "../../scene/sceneThemePolicy";
import { BASEMAPS, basemapById, type BasemapId } from "../../scene/basemaps";

export function BasemapPanel() {
  const basemapId = useBasemapStore((s) => s.basemapId);
  const setBasemapId = useBasemapStore((s) => s.setBasemapId);
  const overridden = useSceneThemeStore((s) => isBasemapOverridden(s.theme));
  const [rampOpen, setRampOpen] = useState(false);

  // The ramp settings only mean anything to an option with a heatmap layer
  // block — for every other basemap the button would configure nothing.
  const isHeatmap = basemapById(basemapId).layer !== undefined;

  return (
    <div className="attr-section">
      <div className="attr-section-title">
        <span>Basemap</span>
        {isHeatmap && (
          <button
            className="rule-action-btn"
            aria-label="Configure elevation ramp"
            aria-expanded={rampOpen}
            title="Configure the elevation ramp (min/max height, log scale)"
            onClick={() => setRampOpen((o) => !o)}
          >
            Ramp
          </button>
        )}
      </div>
      <select
        id="basemap-select"
        className="basemap-select"
        aria-label="Basemap"
        value={basemapId}
        onChange={(e) => setBasemapId(e.target.value as BasemapId)}
      >
        {BASEMAPS.filter((b) => !b.hidden).map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
      {isHeatmap && rampOpen && <HeatmapRampFields />}
      {overridden && (
        <div className="theme-override-hint">{THEME_OVERRIDE_HINT}</div>
      )}
    </div>
  );
}

/**
 * The min/max/log editors over `basemapStore.heatmap`.
 *
 * Drafts are LOCAL strings so a half-typed number never reaches the store
 * (whose sanity gate would refuse or, worse, apply it); the store is written
 * on blur/Enter, and the drafts re-seed whenever the store value changes so
 * a refused commit (min ≥ max) visibly snaps back to what the scene shows.
 */
function HeatmapRampFields() {
  const heatmap = useBasemapStore((s) => s.heatmap);
  const setHeatmap = useBasemapStore((s) => s.setHeatmap);

  const [minDraft, setMinDraft] = useState(String(heatmap.minHeight));
  const [maxDraft, setMaxDraft] = useState(String(heatmap.maxHeight));
  useEffect(() => {
    setMinDraft(String(heatmap.minHeight));
    setMaxDraft(String(heatmap.maxHeight));
  }, [heatmap.minHeight, heatmap.maxHeight]);

  const commit = (key: "minHeight" | "maxHeight", draft: string) => {
    const value = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(value)) {
      // Not a number: snap the draft back to the store instead of writing.
      setMinDraft(String(heatmap.minHeight));
      setMaxDraft(String(heatmap.maxHeight));
      return;
    }
    setHeatmap({ [key]: value } as Partial<HeatmapSettings>);
    // A refused write (min ≥ max) leaves the store untouched; the effect
    // above only re-seeds on store CHANGES, so snap the drafts back by hand.
    const after = useBasemapStore.getState().heatmap;
    setMinDraft(String(after.minHeight));
    setMaxDraft(String(after.maxHeight));
  };

  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="geo-style-fields">
      <label className="geo-style-field">
        <span>Min height (m)</span>
        <input
          className="geo-style-number"
          type="number"
          aria-label="Heatmap minimum height"
          value={minDraft}
          onChange={(e) => setMinDraft(e.target.value)}
          onBlur={() => commit("minHeight", minDraft)}
          onKeyDown={commitOnEnter}
        />
      </label>
      <label className="geo-style-field">
        <span>Max height (m)</span>
        <input
          className="geo-style-number"
          type="number"
          aria-label="Heatmap maximum height"
          value={maxDraft}
          onChange={(e) => setMaxDraft(e.target.value)}
          onBlur={() => commit("maxHeight", maxDraft)}
          onKeyDown={commitOnEnter}
        />
      </label>
      <label className="geo-style-field">
        <span>Log scale</span>
        <input
          type="checkbox"
          aria-label="Heatmap logarithmic scale"
          checked={heatmap.logarithmic}
          onChange={(e) => setHeatmap({ logarithmic: e.target.checked })}
        />
      </label>
    </div>
  );
}
