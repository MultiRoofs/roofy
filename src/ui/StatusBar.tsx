/**
 * Bottom status bar showing model statistics, FPS, cursor position, CRS and
 * selection state — the facts row, in the GIS convention the toolbar shed its
 * information pills for.
 */

import type { DuckDBStatus } from "../insights/duckdb";
import type { StreamStatus } from "../features/streaming/streamStore";
import { useActiveCityLayer } from "../features/workspace/activeLayer";
import { extractCrsCode } from "../features/layers/crsCode";
import { duckdbDotClass, duckdbLabel, duckdbTooltip } from "./duckdbStatusText";

interface StatusBarProps {
  readonly objectCount: number;
  readonly triangleCount: number;
  readonly selectedCount: number;
  readonly duckdbStatus?: DuckDBStatus;
  readonly fps?: number;
  readonly cursorPosition?: readonly [number, number, number] | null;
  /** The active layer's viewport-streaming status, or `null`/`undefined`
   *  when the active layer isn't streaming. `"idle"` (nothing pending) is
   *  deliberately not surfaced — there's nothing notable to tell the user
   *  about that state, unlike probing/fetching/too-far/error. */
  readonly streamStatus?: StreamStatus | null;
  /** The worker/driver's own message for the current `streamStatus` (e.g.
   *  an error's detail text). Ignored for `"too-far"`, which always shows
   *  the fixed, user-facing "Zoom in to load features" instead of the
   *  internal reason-coded message (`"Zoom in (feature-budget)"` etc.). */
  readonly streamMessage?: string | null;
}

export function StatusBar({
  objectCount,
  triangleCount,
  selectedCount,
  duckdbStatus,
  fps,
  cursorPosition,
  streamStatus,
  streamMessage,
}: StatusBarProps) {
  // Read straight from the store rather than through a prop: the CRS is a
  // property of the active layer, not of anything `App` already computes, and
  // threading it would put a fact nobody else needs through the shell. No
  // fallback to the first layer — an EPSG code for a layer nothing else on
  // screen points at is worse than no code at all.
  const activeLayer = useActiveCityLayer();
  const crs = activeLayer
    ? extractCrsCode(activeLayer.model.metadata.referenceSystem)
    : null;

  return (
    <footer className="statusbar">
      <div className="status-item">
        <span className="status-dot" />
        <span className="status-label">Ready</span>
      </div>

      {fps !== undefined && (
        <div className="status-item">
          <span className="status-label">FPS</span>
          <span className={`status-value ${fps < 30 ? "warn" : ""}`}>
            {fps}
          </span>
        </div>
      )}

      {cursorPosition && (
        <div className="status-item status-item-cursor">
          <span className="status-label">XYZ</span>
          <span className="status-value status-value-mono">
            {cursorPosition[0].toFixed(1)}, {cursorPosition[1].toFixed(1)},{" "}
            {cursorPosition[2].toFixed(1)}
          </span>
        </div>
      )}

      <div className="toolbar-spacer" />

      {streamStatus && streamStatus !== "idle" && (
        <div className="status-item">
          <span className={`status-dot ${streamDotClass(streamStatus)}`} />
          <span className="status-label">Stream</span>
          <span className="status-value">
            {streamStatusLabel(streamStatus, streamMessage ?? null)}
          </span>
        </div>
      )}

      {duckdbStatus && duckdbStatus.state !== "uninitialized" && (
        <div className="status-item" title={duckdbTooltip(duckdbStatus)}>
          <span className={`status-dot ${duckdbDotClass(duckdbStatus)}`} />
          <span className="status-label">DuckDB</span>
          <span className="status-value">{duckdbLabel(duckdbStatus)}</span>
        </div>
      )}
      <div className="status-item">
        <span className="status-label">Objects</span>
        <span className="status-value">{objectCount}</span>
      </div>
      <div className="status-item">
        <span className="status-label">Selected</span>
        <span className={`status-value ${selectedCount > 0 ? "accent" : ""}`}>
          {selectedCount}
        </span>
      </div>
      <div className="status-item">
        <span className="status-label">Triangles</span>
        <span className="status-value">{formatCount(triangleCount)}</span>
      </div>
      {/* Last, i.e. bottom-right: where QGIS puts the EPSG code. */}
      {crs && (
        <div className="status-item">
          <span className="status-label">CRS</span>
          <span className="status-value status-value-mono">EPSG:{crs}</span>
        </div>
      )}
    </footer>
  );
}

/** `status` is already checked `!== "idle"` at the call site — the `"idle"`
 *  branch here only exists so the function type-checks against the full
 *  `StreamStatus` union without an unsafe cast. */
function streamDotClass(status: StreamStatus): string {
  switch (status) {
    case "probing":
    case "fetching":
      return "dot-loading";
    case "too-far":
      return "dot-partial";
    case "error":
      return "dot-error";
    case "idle":
      return "dot-ready";
  }
}

function streamStatusLabel(
  status: StreamStatus,
  message: string | null,
): string {
  switch (status) {
    case "probing":
      return "Probing…";
    case "fetching":
      return "Loading features…";
    case "too-far":
      // Fixed, user-facing text — NOT the driver's internal reason-coded
      // message (e.g. "Zoom in (feature-budget)"), which is debug detail.
      return "Zoom in to load features";
    case "error":
      return message ?? "Streaming error";
    case "idle":
      return "Streaming";
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
