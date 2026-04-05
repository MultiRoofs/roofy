/**
 * Bottom status bar showing model statistics and selection state.
 */

interface StatusBarProps {
  readonly objectCount: number;
  readonly triangleCount: number;
  readonly selectedCount: number;
}

export function StatusBar({ objectCount, triangleCount, selectedCount }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="status-item">
        <span className="status-dot" />
        <span className="status-label">Ready</span>
      </div>

      <div className="toolbar-spacer" />

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

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
