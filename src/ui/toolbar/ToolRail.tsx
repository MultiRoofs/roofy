/**
 * Left-side tool rail with mode selection and fit-all.
 */

import type { PickMode } from "../../domain/selection/types";

interface ToolRailProps {
  readonly pickMode: PickMode;
  readonly onSetPickMode: (mode: PickMode) => void;
  readonly onFitAll: () => void;
}

export function ToolRail({ pickMode, onSetPickMode, onFitAll }: ToolRailProps) {
  return (
    <aside className="tool-rail">
      {/* Object select mode */}
      <button
        className={`rail-btn ${pickMode === "object" ? "active" : ""}`}
        title="Select objects (V)"
        onClick={() => onSetPickMode("object")}
      >
        <svg viewBox="0 0 24 24">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        </svg>
      </button>

      {/* Surface select mode */}
      <button
        className={`rail-btn ${pickMode === "surface" ? "active" : ""}`}
        title="Select surfaces (S)"
        onClick={() => onSetPickMode("surface")}
      >
        <svg viewBox="0 0 24 24">
          <path d="M2 6l10-3 10 3-10 3-10-3z" />
          <path d="M2 12l10 3 10-3" />
        </svg>
      </button>

      <div className="rail-divider" />

      {/* Fit all */}
      <button className="rail-btn" title="Fit all (F)" onClick={onFitAll}>
        <svg viewBox="0 0 24 24">
          <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m8 0h3a2 2 0 002-2v-3" />
        </svg>
      </button>
    </aside>
  );
}
