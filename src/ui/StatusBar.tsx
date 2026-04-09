/**
 * Bottom status bar showing model statistics, FPS, cursor position, and selection state.
 */

import type { DuckDBStatus } from "../analytics/duckdb";

interface StatusBarProps {
  readonly objectCount: number;
  readonly triangleCount: number;
  readonly selectedCount: number;
  readonly duckdbStatus?: DuckDBStatus;
  readonly fps?: number;
  readonly cursorPosition?: readonly [number, number, number] | null;
  readonly tableOpen?: boolean;
  readonly onToggleTable?: () => void;
}

export function StatusBar({
  objectCount,
  triangleCount,
  selectedCount,
  duckdbStatus,
  fps,
  cursorPosition,
  tableOpen,
  onToggleTable,
}: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="status-item">
        <span className="status-dot" />
        <span className="status-label">Ready</span>
      </div>

      {onToggleTable && (
        <button
          className={`tb-btn table-toggle-btn ${tableOpen ? "active" : ""}`}
          title={tableOpen ? "Hide table" : "Show table"}
          onClick={onToggleTable}
        >
          <svg viewBox="0 0 24 24" width="14" height="14">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" />
            <path d="M3 9h18M3 15h18M9 3v18" />
          </svg>
          <span>Table</span>
        </button>
      )}

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

      {duckdbStatus && duckdbStatus.state !== "uninitialized" && (
        <div className="status-item">
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
    </footer>
  );
}

function duckdbDotClass(status: DuckDBStatus): string {
  if (status.state === "ready")
    return status.extensionLoaded ? "dot-ready" : "dot-partial";
  if (status.state === "initializing") return "dot-loading";
  return "dot-failed";
}

function duckdbLabel(status: DuckDBStatus): string {
  if (status.state === "ready")
    return status.extensionLoaded ? "Ready" : "No ext";
  if (status.state === "initializing") return "Loading";
  return "N/A";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
