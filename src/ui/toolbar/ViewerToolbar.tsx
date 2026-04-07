/**
 * Viewer toolbar with metadata pills and action buttons.
 */

import type { CityModel } from "../../domain/citymodel/types";
import { useRuleStore } from "../../features/rules/ruleStore";
import { useSolarStore } from "../../features/solar/solarStore";

interface ViewerToolbarProps {
  readonly model: CityModel;
  readonly fileName: string | null;
  readonly onClose: () => void;
  readonly onToggleInspector: () => void;
  readonly onFitAll: () => void;
  readonly onSave?: () => void;
  readonly onShare?: () => void;
  readonly canShare?: boolean;
}

export function ViewerToolbar({
  model,
  fileName,
  onClose,
  onToggleInspector,
  onFitAll,
  onSave,
  onShare,
  canShare,
}: ViewerToolbarProps) {
  const objectCount = Object.keys(model.objects).length;
  const crs = extractCrsCode(model.metadata.referenceSystem);
  const lod = findPrimaryLod(model);

  const rulesEnabled = useRuleStore((s) => s.enabled);
  const ruleCount = useRuleStore((s) => s.rules.filter((r) => r.enabled).length);
  const toggleRules = useRuleStore((s) => s.toggleEnabled);

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
          Objects <span className="value">{objectCount}</span>
        </div>
        {lod && (
          <div className="pill">
            LoD <span className="value">{lod}</span>
          </div>
        )}
      </div>

      {sunPosition && (
        <>
          <div className="toolbar-sep" />
          <div className={`pill sun-pill ${sunPosition.altitudeDeg > 0 ? "sun-pill-up" : ""}`}>
            Sun <span className="value">{formatDatetimePill(datetime)}</span>
          </div>
        </>
      )}

      {ruleCount > 0 && (
        <>
          <div className="toolbar-sep" />
          <div
            className={`pill rule-pill ${rulesEnabled ? "rule-pill-active" : ""}`}
            onClick={toggleRules}
            role="button"
            tabIndex={0}
          >
            Rules <span className="value">{ruleCount} active</span>
          </div>
        </>
      )}

      <div className="toolbar-spacer" />

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
      <button className="tb-btn" title="Toggle inspector" onClick={onToggleInspector}>
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

function findPrimaryLod(model: CityModel): string | null {
  for (const obj of Object.values(model.objects)) {
    if (obj?.lod) return obj.lod;
  }
  return null;
}
