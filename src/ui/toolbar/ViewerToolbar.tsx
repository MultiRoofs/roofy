/**
 * Viewer toolbar with metadata pills and action buttons.
 */

import type { CityModel } from "../../domain/citymodel/types";

interface ViewerToolbarProps {
  readonly model: CityModel;
  readonly fileName: string | null;
  readonly onClose: () => void;
  readonly onToggleInspector: () => void;
  readonly onFitAll: () => void;
}

export function ViewerToolbar({
  model,
  fileName,
  onClose,
  onToggleInspector,
  onFitAll,
}: ViewerToolbarProps) {
  const objectCount = Object.keys(model.objects).length;
  const crs = extractCrsCode(model.metadata.referenceSystem);

  const lod = findPrimaryLod(model);

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

      <div className="toolbar-spacer" />

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

function findPrimaryLod(model: CityModel): string | null {
  for (const obj of Object.values(model.objects)) {
    if (obj?.lod) return obj.lod;
  }
  return null;
}
