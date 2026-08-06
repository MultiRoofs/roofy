/**
 * The 3D city model catalog, as a modal of its own.
 *
 * It is NOT a tab inside "Add layer": browsing a catalog is a long, wide,
 * exploratory act (a card grid, a map, an item list) and the add dialog is a
 * 30 rem form. So this is a separate portal modal wearing `.modal-wide` —
 * without that width the collection grid collapses to a single column.
 *
 * Adding NEVER closes it. A catalog visit that yields one layer is the
 * exception; the user picks several, watches them appear behind the backdrop,
 * and closes when done. Everything else — focus capture/restore, scroll lock,
 * Escape, the Tab trap — is {@link useModalChrome}, shared with
 * `AddLayerDialog`, so the two dialogs cannot drift apart.
 */

import { useCallback, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useModalChrome } from "../useModalChrome";
import { StacBrowser } from "./StacBrowser";

export interface StacBrowserDialogProps {
  readonly onClose: () => void;
  /** The app's URL loading path — the same one `AddLayerDialog` funnels into. */
  readonly onAddUrl: (url: string) => void;
}

export function StacBrowserDialog({
  onClose,
  onAddUrl,
}: StacBrowserDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalChrome(dialogRef, onClose);

  // mousedown, not click: a text selection that STARTS inside the dialog and
  // ends on the backdrop raises a click whose target is the backdrop, and
  // closing on that throws away what the user was reading.
  const handleBackdropMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      // preventDefault, or the browser's own mousedown behaviour moves focus
      // to the backdrop's nearest focusable ancestor (<body>) AFTER this
      // handler has already put focus back on the trigger.
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  /** A drag that misses dies on the backdrop: no browser navigation to the
   *  dropped file, and nothing reaches the viewport underneath. */
  const swallowDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onDragOver={swallowDrag}
      onDrop={swallowDrag}
      data-testid="stac-dialog-backdrop"
    >
      <div
        ref={dialogRef}
        className="modal modal-wide stac-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stac-dialog-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="stac-dialog-title">
            3D city model catalog
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {/* Deliberately NOT wrapped in a close: multi-add is the point. */}
          <StacBrowser onAddUrl={onAddUrl} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
