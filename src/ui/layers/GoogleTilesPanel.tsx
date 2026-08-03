/**
 * Google Photorealistic 3D Tiles toggle panel.
 *
 * Renders a built-in background layer row in the left sidebar
 * with a visibility toggle. Reads/writes useTilesStore, which `NavaraViewport`
 * turns into an engine `3d-tiles` layer add/remove (Task C21).
 */

import { useTilesStore } from "../../features/tiles/tilesStore";

const HAS_API_KEY = !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export function GoogleTilesPanel() {
  // Without a key the viewport adds nothing whatever the flag says, so the row
  // must read "off" rather than showing an open eye over an empty backdrop.
  const enabled = useTilesStore((s) => s.enabled) && HAS_API_KEY;
  const setEnabled = useTilesStore((s) => s.setEnabled);

  return (
    <div className="attr-section">
      <div className="attr-section-title">Background</div>
      <div
        className={`layer-item ${!enabled ? "layer-hidden" : ""}`}
        onClick={() => HAS_API_KEY && setEnabled(!enabled)}
        style={!HAS_API_KEY ? { opacity: 0.5, cursor: "not-allowed" } : {}}
      >
        <button
          className="layer-vis-btn"
          title={
            !HAS_API_KEY
              ? "Set VITE_GOOGLE_MAPS_API_KEY to enable"
              : enabled
                ? "Hide 3D tiles"
                : "Show 3D tiles"
          }
          disabled={!HAS_API_KEY}
          onClick={(e) => {
            e.stopPropagation();
            if (HAS_API_KEY) setEnabled(!enabled);
          }}
        >
          {enabled ? (
            <svg viewBox="0 0 24 24">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          )}
        </button>
        <span className="layer-name">Google 3D Tiles</span>
        <span className="layer-meta">background</span>
      </div>
    </div>
  );
}
