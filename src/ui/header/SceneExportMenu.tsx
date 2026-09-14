import { useState } from "react";
import { useHeaderMenu } from "./useHeaderMenu";
import type { SceneExportFormat } from "../../features/export/browserSceneExport";

export function SceneExportMenu({
  onExport,
}: {
  readonly onExport: (format: SceneExportFormat) => Promise<void>;
}) {
  const { open, toggle, rootRef, triggerRef } = useHeaderMenu();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (format: SceneExportFormat) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onExport(format);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not export the scene. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="header-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="header-action"
        aria-label="Export scene"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24">
          <path d="M3 7h4l2-3h6l2 3h4v13H3Z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <span>Export</span>
      </button>
      {open && (
        <div
          className="header-popover scene-export-popover"
          role="dialog"
          aria-label="Export scene"
        >
          <strong>Export scene</strong>
          <p>Capture the current view with map attribution.</p>
          <div className="scene-export-actions">
            <button
              type="button"
              className="header-action"
              disabled={busy}
              onClick={() => void run("png")}
            >
              Save PNG
            </button>
            <button
              type="button"
              className="header-action"
              disabled={busy}
              onClick={() => void run("print")}
            >
              Print / PDF
            </button>
          </div>
          <p className="scene-export-note">
            For PDF, open the print view and choose Save as PDF.
          </p>
          {busy && <p role="status">Capturing scene…</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
