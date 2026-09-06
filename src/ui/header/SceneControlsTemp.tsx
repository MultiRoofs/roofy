/**
 * TEMPORARY — removed by task 12.5, which gives the scene its own home.
 *
 * The redesign's model puts one subject in one place: the WORKSPACE in the
 * header, the SCENE in map controls plus a Scene settings sheet, the LAYER in
 * the left panel, the SELECTION in the right one. The scene's controls have
 * nowhere to live until 12.5 builds that home, and deleting them for two
 * slices would mean no sun, no basemap and no view mode in between. So they
 * ride along in the header, in one marked container (`data-temporary="12.5"`)
 * that 12.5 deletes whole.
 *
 * What is NOT here: Box select and Measure. `NavaraViewport` gates pointer
 * events on `toolMode`, so choosing either only ever turned picking OFF —
 * nothing draws a rubber band or a measurement. They were disabled buttons
 * with an apology in the tooltip; the design ruling removes them from the
 * primary UI until they are implemented. `toolMode` itself is untouched: the
 * store, `acceptsPointer` and the two modes all still exist, and re-enabling
 * them is adding buttons back, not un-deleting a feature.
 *
 * What IS here that the design moves elsewhere later: "Zoom to fit" stays for
 * now (it is the only way back to the data when the camera is lost), and the
 * Scene popover holds the basemap picker and the Google 3D toggle, which used
 * to sit in the left sidebar above the layer list — a sidebar is the LAYER's
 * home, and neither of those is a layer of the user's.
 */

import type { PickMode, ToolMode } from "../../domain/selection/types";
import { SolarMenu } from "../toolbar/SolarMenu";
import { WeatherMenu } from "../toolbar/WeatherMenu";
import { ViewModeToggle } from "../toolbar/ViewModeToggle";
import { SceneThemeMenu } from "../toolbar/SceneThemeMenu";
import { BasemapPanel } from "../layers/BasemapPanel";
import { GoogleTilesPanel } from "../layers/GoogleTilesPanel";
import { useHeaderMenu } from "./useHeaderMenu";

export interface SceneControlsTempProps {
  readonly pickMode: PickMode;
  readonly toolMode: ToolMode;
  readonly onSetPickMode: (mode: PickMode) => void;
  readonly onSetToolMode: (mode: ToolMode) => void;
  readonly onFitAll: () => void;
  readonly advancedSettingsOpen?: boolean;
  readonly onToggleAdvancedSettings?: () => void;
}

export function SceneControlsTemp({
  pickMode,
  toolMode,
  onSetPickMode,
  onSetToolMode,
  onFitAll,
  advancedSettingsOpen,
  onToggleAdvancedSettings,
}: SceneControlsTempProps) {
  const scene = useHeaderMenu();

  return (
    <div className="scene-controls" data-temporary="12.5">
      <div className="toolbar-btn-group">
        <button
          type="button"
          className={`tb-btn ${pickMode === "object" && toolMode === "select" ? "tb-btn-active" : ""}`}
          aria-label="Select objects (V)"
          data-tooltip="Select objects (V)"
          aria-pressed={pickMode === "object" && toolMode === "select"}
          onClick={() => {
            onSetPickMode("object");
            onSetToolMode("select");
          }}
        >
          <svg viewBox="0 0 24 24">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          </svg>
        </button>
        <button
          type="button"
          className={`tb-btn ${pickMode === "surface" && toolMode === "select" ? "tb-btn-active" : ""}`}
          aria-label="Select surfaces (S)"
          data-tooltip="Select surfaces (S)"
          aria-pressed={pickMode === "surface" && toolMode === "select"}
          onClick={() => {
            onSetPickMode("surface");
            onSetToolMode("select");
          }}
        >
          <svg viewBox="0 0 24 24">
            <path d="M2 6l10-3 10 3-10 3-10-3z" />
            <path d="M2 12l10 3 10-3" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="tb-btn"
        aria-label="Zoom to fit (F)"
        data-tooltip="Zoom to fit (F)"
        onClick={onFitAll}
      >
        <svg viewBox="0 0 24 24">
          <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m8 0h3a2 2 0 002-2v-3" />
        </svg>
      </button>

      <ViewModeToggle />
      {/* Next to the view-mode segments because the two answer neighbouring
          questions — how the scene is FRAMED, and how it is DRAWN. */}
      <SceneThemeMenu />

      {/* ...and next to those, what the buildings STAND ON. The basemap and
          the Google tiles answer one question together ("what is under my
          buildings?") and have to be visible at once, which is why they share
          a popover rather than getting a button each. */}
      <div className="header-menu" ref={scene.rootRef}>
        <button
          ref={scene.triggerRef}
          type="button"
          className={`tb-btn ${scene.open ? "tb-btn-active" : ""}`}
          aria-label="Scene"
          aria-expanded={scene.open}
          aria-haspopup="dialog"
          data-tooltip="Scene"
          onClick={scene.toggle}
        >
          <svg viewBox="0 0 24 24">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" />
          </svg>
        </button>
        {scene.open && (
          <div
            className="header-popover scene-popover"
            role="dialog"
            aria-label="Scene"
          >
            <BasemapPanel />
            <GoogleTilesPanel />
          </div>
        )}
      </div>

      <div className="toolbar-sep" />

      {/* One button, one popover, for everything about the sun. */}
      <SolarMenu />
      {/* Immediately after the sun, because both are controls for the SKY:
          where the light comes from, and what is in the way of it. */}
      <WeatherMenu />

      {onToggleAdvancedSettings && (
        <button
          type="button"
          className={`tb-btn ${advancedSettingsOpen ? "tb-btn-active" : ""}`}
          aria-label="Rendering settings"
          data-tooltip="Rendering settings"
          onClick={onToggleAdvancedSettings}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      )}
    </div>
  );
}
