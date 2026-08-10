/**
 * Viewer toolbar: pick mode, tool mode, and action buttons — CONTROLS ONLY.
 *
 * Facts about the scene belong in the status bar, the GIS convention (QGIS,
 * ArcGIS, Cesium): the file name, object/layer counts, LoD and rule count each
 * duplicated a surface that already showed them (the sidebar, `StatusBar`, the
 * legend), and the CRS moved to `StatusBar`'s right cluster, where QGIS puts
 * EPSG. The sun's datetime is not gone either — it is the LABEL of the sun
 * button now, one control for one subject. This component therefore reads no
 * store at all.
 */

import type { PickMode, ToolMode } from "../../domain/selection/types";
import type { Theme } from "../../features/theme/useTheme";
import { SolarMenu } from "./SolarMenu";
import { WeatherMenu } from "./WeatherMenu";
import { ViewModeToggle } from "./ViewModeToggle";
import { SceneThemeMenu } from "./SceneThemeMenu";

/**
 * Tooltip suffix for the tools the Navara viewport does not implement yet.
 *
 * `NavaraViewport` gates pointer events on `toolMode` (`acceptsPointer` in
 * `pickEventHandlers.ts`), so selecting "box-select" or "measure" only ever
 * turns picking OFF — nothing draws a rubber band or a measurement, because
 * the R3F components that used to do it are no longer rendered (Task B11b).
 * A button whose only effect is to break selection is worse than one that is
 * visibly unavailable, so both are disabled until their Navara equivalents
 * land. `toolMode` itself is untouched — the store and `acceptsPointer` keep
 * their behaviour, and re-enabling is deleting `disabled` here — and the
 * toolbar is the only way into either mode (there are no key bindings).
 */
const NAVARA_DEAD_TOOL_TITLE =
  "temporarily unavailable during the Navara migration";

interface ViewerToolbarProps {
  readonly pickMode: PickMode;
  readonly toolMode: ToolMode;
  readonly onSetPickMode: (mode: PickMode) => void;
  readonly onSetToolMode: (mode: ToolMode) => void;
  readonly onClose: () => void;
  readonly onToggleInspector: () => void;
  readonly onToggleLeftSidebar: () => void;
  readonly onFitAll: () => void;
  readonly onSave?: () => void;
  readonly onShare?: () => void;
  readonly canShare?: boolean;
  readonly theme: Theme;
  readonly onToggleTheme: () => void;
  readonly advancedSettingsOpen?: boolean;
  readonly onToggleAdvancedSettings?: () => void;
}

export function ViewerToolbar({
  pickMode,
  toolMode,
  onSetPickMode,
  onSetToolMode,
  onClose,
  onToggleInspector,
  onToggleLeftSidebar,
  onFitAll,
  onSave,
  onShare,
  canShare,
  theme,
  onToggleTheme,
  advancedSettingsOpen,
  onToggleAdvancedSettings,
}: ViewerToolbarProps) {
  return (
    <header className="toolbar">
      <span className="toolbar-brand">Urbis</span>

      {/* Left sidebar toggle */}
      <button
        className="tb-btn"
        aria-label="Toggle layers panel"
        data-tooltip="Toggle layers panel"
        onClick={onToggleLeftSidebar}
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>

      <div className="toolbar-sep" />

      {/* Pick mode buttons */}
      <div className="toolbar-btn-group">
        <button
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

        <div className="toolbar-sep-inline" />

        {/* Box select — DEAD under NavaraViewport (see NAVARA_DEAD_TOOL_TITLE). */}
        <button
          className={`tb-btn ${toolMode === "box-select" ? "tb-btn-active" : ""}`}
          aria-label={`Box select — ${NAVARA_DEAD_TOOL_TITLE}`}
          data-tooltip={`Box select — ${NAVARA_DEAD_TOOL_TITLE}`}
          aria-pressed={toolMode === "box-select"}
          disabled
          onClick={() => onSetToolMode("box-select")}
        >
          <svg viewBox="0 0 24 24">
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="1"
              fill="none"
              strokeDasharray="4 2"
            />
          </svg>
        </button>

        {/* Measure — DEAD under NavaraViewport (see NAVARA_DEAD_TOOL_TITLE). */}
        <button
          className={`tb-btn ${toolMode === "measure" ? "tb-btn-active" : ""}`}
          aria-label={`Measure distance — ${NAVARA_DEAD_TOOL_TITLE}`}
          data-tooltip={`Measure distance — ${NAVARA_DEAD_TOOL_TITLE}`}
          aria-pressed={toolMode === "measure"}
          disabled
          onClick={() => onSetToolMode("measure")}
        >
          <svg viewBox="0 0 24 24">
            <path d="M2 12h4M18 12h4" />
            <path d="M6 8v8M18 8v8" />
            <path d="M6 12h12" />
            <path d="M12 10v4" />
          </svg>
        </button>
      </div>

      {/* Fit all */}
      <button
        className="tb-btn"
        aria-label="Zoom to fit (F)"
        data-tooltip="Zoom to fit (F)"
        onClick={onFitAll}
      >
        <svg viewBox="0 0 24 24">
          <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m8 0h3a2 2 0 002-2v-3" />
        </svg>
      </button>

      {/* The camera policy "Zoom to fit" flies under. The place SEARCH used to
          sit here too; it is a scene overlay now (top-left of the canvas), so
          the toolbar keeps only what is not about a point on the map. */}
      <ViewModeToggle />
      {/* Next to the view-mode segments because the two answer neighbouring
          questions — how the scene is FRAMED, and how it is DRAWN. */}
      <SceneThemeMenu />

      <div className="toolbar-sep" />

      {/* One button, one popover, for everything about the sun: the sliders
          that sweep it, the presets that jump it, and the altitude/azimuth the
          engine reports back — with the scene's time on its own face, so it is
          readable without opening anything. */}
      <SolarMenu />
      {/* Immediately after the sun, because both are controls for the SKY:
          where the light comes from, and what is in the way of it. Weather was
          a section of the Rendering panel until this pass — behind a gear, two
          clicks from a scene you are looking at while adjusting it. */}
      <WeatherMenu />

      <div className="toolbar-spacer" />

      {onToggleAdvancedSettings && (
        <button
          className={`tb-btn ${advancedSettingsOpen ? "tb-btn-active" : ""}`}
          aria-label="Rendering settings"
          data-tooltip="Rendering settings"
          data-tooltip-align="end"
          onClick={onToggleAdvancedSettings}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      )}

      <button
        className="theme-toggle-btn"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        data-tooltip={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        data-tooltip-align="end"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? (
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        )}
      </button>

      {onSave && (
        <button
          className="tb-btn"
          aria-label="Save workspace"
          data-tooltip="Save workspace"
          data-tooltip-align="end"
          onClick={onSave}
        >
          <svg viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
        </button>
      )}
      {onShare && canShare && (
        <button
          className="tb-btn"
          aria-label="Copy share link"
          data-tooltip="Copy share link"
          data-tooltip-align="end"
          onClick={onShare}
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      )}
      <button
        className="tb-btn"
        aria-label="Toggle inspector"
        data-tooltip="Toggle inspector"
        data-tooltip-align="end"
        onClick={onToggleInspector}
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M15 3v18" />
        </svg>
      </button>
      <button
        className="tb-btn"
        aria-label="Close file"
        data-tooltip="Close file"
        data-tooltip-align="end"
        onClick={onClose}
      >
        <svg viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </header>
  );
}
