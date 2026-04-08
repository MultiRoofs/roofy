/**
 * Bottom status bar showing model statistics and selection state.
 */

import type { DuckDBStatus } from "../analytics/duckdb";

interface StatusBarProps {
  readonly objectCount: number;
  readonly triangleCount: number;
  readonly selectedCount: number;
  readonly duckdbStatus?: DuckDBStatus;
}

export function StatusBar({ objectCount, triangleCount, selectedCount, duckdbStatus }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="status-item">
        <span className="status-dot" />
        <span className="status-label">Ready</span>
      </div>

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
  if (status.state === "ready") return status.extensionLoaded ? "dot-ready" : "dot-partial";
  if (status.state === "initializing") return "dot-loading";
  return "dot-failed";
}

function duckdbLabel(status: DuckDBStatus): string {
  if (status.state === "ready") return status.extensionLoaded ? "Ready" : "No ext";
  if (status.state === "initializing") return "Loading";
  return "N/A";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
