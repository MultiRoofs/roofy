/**
 * Viewer toolbar with metadata pills and action buttons.
 */

import type { Theme } from "../../features/theme/useTheme";
import { useLayerStore } from "../../features/layers/layerStore";
import { useSolarStore } from "../../features/solar/solarStore";

interface ViewerToolbarProps {
  readonly fileName: string | null;
  readonly layerCount: number;
  readonly onClose: () => void;
  readonly onToggleInspector: () => void;
  readonly onFitAll: () => void;
  readonly onSave?: () => void;
  readonly onShare?: () => void;
  readonly canShare?: boolean;
  readonly theme: Theme;
  readonly onToggleTheme: () => void;
}

export function ViewerToolbar({
  fileName,
  layerCount,
  onClose,
  onToggleInspector,
  onFitAll,
  onSave,
  onShare,
  canShare,
  theme,
  onToggleTheme,
}: ViewerToolbarProps) {
  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];

  const totalObjects = layers.reduce(
    (sum, l) => sum + Object.keys(l.model.objects).length,
    0,
  );
  const crs = activeLayer
    ? extractCrsCode(activeLayer.model.metadata.referenceSystem)
    : null;
  const lod = activeLayer ? findPrimaryLod(activeLayer.model) : null;

  const ruleCount = activeLayer
    ? activeLayer.rules.filter((r) => r.enabled).length
    : 0;

  const datetime = useSolarStore((s) => s.datetime);
  const sunPosition = useSolarStore((s) => s.sunPosition);

  return (
    <header className="toolbar">
      <span className="toolbar-brand">MultiRoof</span>
      {fileName && <span className="toolbar-file">{fileName}</span>}
      <div className="toolbar-sep" />

      <div className="meta-pills">
        {crs && (
          <div className="pill">
            CRS <span className="value">EPSG:{crs}</span>
          </div>
        )}
        <div className="pill">
          Objects <span className="value">{totalObjects}</span>
        </div>
        {layerCount > 1 && (
          <div className="pill">
            Layers <span className="value">{layerCount}</span>
          </div>
        )}
        {lod && (
          <div className="pill">
            LoD <span className="value">{lod}</span>
          </div>
        )}
      </div>

      {sunPosition && (
        <>
          <div className="toolbar-sep" />
          <div
            className={`pill sun-pill ${sunPosition.altitudeDeg > 0 ? "sun-pill-up" : ""}`}
          >
            Sun <span className="value">{formatDatetimePill(datetime)}</span>
          </div>
        </>
      )}

      {ruleCount > 0 && (
        <>
          <div className="toolbar-sep" />
          <div className="pill rule-pill rule-pill-active">
            Rules <span className="value">{ruleCount} active</span>
          </div>
        </>
      )}

      <div className="toolbar-spacer" />

      <button
        className="theme-toggle-btn"
        title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
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
        <button className="tb-btn" title="Save workspace" onClick={onSave}>
          <svg viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
        </button>
      )}
      {onShare && canShare && (
        <button className="tb-btn" title="Copy share link" onClick={onShare}>
          <svg viewBox="0 0 24 24">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      )}
      <button
        className="tb-btn"
        title="Toggle inspector"
        onClick={onToggleInspector}
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M15 3v18" />
        </svg>
      </button>
      <button className="tb-btn" title="Zoom to fit" onClick={onFitAll}>
        <svg viewBox="0 0 24 24">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>
      <button className="tb-btn" title="Close file" onClick={onClose}>
        <svg viewBox="0 0 24 24">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </header>
  );
}

function extractCrsCode(referenceSystem: string | undefined): string | null {
  if (!referenceSystem) return null;
  const parts = referenceSystem.split("/");
  return parts.at(-1) ?? null;
}

function formatDatetimePill(dt: Date): string {
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function findPrimaryLod(model: {
  objects: Record<string, { lod: string | null }>;
}): string | null {
  for (const obj of Object.values(model.objects)) {
    if (obj?.lod) return obj.lod;
  }
  return null;
}
