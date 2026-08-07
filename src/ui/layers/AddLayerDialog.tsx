/**
 * The "+ Add Layer" modal.
 *
 * Replaces the cramped inline form that used to unfold inside the sidebar's
 * layer list: adding a source is a deliberate, two-affordance act (drop a
 * local file, or paste a remote URL) and the sidebar is 180–480 px wide.
 * Rendered as a real modal so the drop zone gets room, and so a drag that
 * misses it cannot be handed to the 3D viewport underneath.
 *
 * The loading path is unchanged — `onAddFile`/`onAddUrl` are `App`'s
 * `handleFile`/`handleUrl`, the same pair the landing page uses, and the body
 * is the same {@link SourcePicker} the landing page renders.
 *
 * Modal behaviour, all of it deliberate:
 *  - a PORTAL to `document.body`, so no ancestor's `overflow`, `transform` or
 *    stacking context can clip or bury it (the viewer shell is a grid of
 *    positioned panels);
 *  - closes on Escape, on a backdrop click, and on its own close button;
 *  - focus moves into the dialog on open and is restored to whatever had it
 *    (the trigger) on close;
 *  - Tab cycles WITHIN the dialog — a modal you can tab out of is a modal that
 *    hands the keyboard to controls the user cannot see;
 *  - the page behind it cannot scroll, and the backdrop swallows drag/drop so
 *    a missed drop neither navigates the browser nor reaches the viewport.
 *
 * All of that except the backdrop lives in {@link useModalChrome}, shared with
 * the STAC catalog dialog.
 */

import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalChrome } from "../useModalChrome";
import { SourcePicker } from "./SourcePicker";
import { GeospatialSourceForm } from "./GeospatialSourceForm";
import { StacBrowser } from "../stac/StacBrowser";

interface AddLayerDialogProps {
  readonly onClose: () => void;
  readonly onAddFile: (file: File) => void;
  /** Several files as ONE layer — a CityParquet package folder, or a
   *  multi-file drop. Closes the dialog exactly like `onAddFile`. */
  readonly onAddFiles: (files: File[]) => void;
  /** Resolves TRUE once a layer has landed. The URL field ignores the answer
   *  (it closes the dialog either way, and the app reports the failure); the
   *  catalog tab needs it to roll a failed "Added ✓" back. */
  readonly onAddUrl: (url: string) => Promise<boolean>;
  readonly loading: boolean;
}

/** Which family of source the dialog is offering. The city model is the
 *  DEFAULT and stays it: it is what this viewer is for, a geospatial overlay
 *  is context around it, and the catalog is a place to go looking when the
 *  user has no URL of their own yet. */
type SourceTab = "city" | "geo" | "stac";

export function AddLayerDialog({
  onClose,
  onAddFile,
  onAddFiles,
  onAddUrl,
  loading,
}: AddLayerDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SourceTab>("city");
  const tabIdPrefix = useId();

  useModalChrome(dialogRef, onClose);

  // mousedown, not click: a text selection that STARTS inside the dialog and
  // ends on the backdrop raises a click whose target is the backdrop, and
  // closing on that throws away what the user was typing.
  const handleBackdropMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      // preventDefault, or the browser's own mousedown behaviour moves focus
      // to the backdrop's nearest focusable ancestor (<body>) AFTER this
      // handler has already put focus back on the trigger — which is how a
      // backdrop dismissal used to leave the keyboard stranded on the
      // document while Escape and the close button restored it correctly.
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  /** A drag that misses the drop zone dies on the backdrop: no browser
   *  navigation to the dropped file, and nothing reaches the viewport. */
  const swallowDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      onAddFile(file);
      onClose();
    },
    [onAddFile, onClose],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      onAddFiles(files);
      onClose();
    },
    [onAddFiles, onClose],
  );

  const handleUrl = useCallback(
    (url: string) => {
      // Fire-and-forget on purpose: this affordance closes the dialog
      // immediately, so there is nothing left on screen to report the outcome
      // to. The app's own error state has it.
      void onAddUrl(url);
      onClose();
    },
    [onAddUrl, onClose],
  );

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onDragOver={swallowDrag}
      onDrop={swallowDrag}
      data-testid="add-layer-backdrop"
    >
      <div
        ref={dialogRef}
        // The catalog is a card grid and a map, not a form: inside `.modal`'s
        // 30 rem the grid collapses to a single column. Same widening the
        // standalone `StacBrowserDialog` wears.
        className={`modal add-layer-dialog${tab === "stac" ? " modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-layer-dialog-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="add-layer-dialog-title">
            Add layer
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
        {/* Three source families, one dialog. A tablist rather than three
            buttons so the keyboard and a screen reader get the relationship
            between the choice and the panel it changes. */}
        <div className="modal-tabs" role="tablist" aria-label="Source type">
          <button
            type="button"
            role="tab"
            id={`${tabIdPrefix}-city-tab`}
            aria-selected={tab === "city"}
            aria-controls={`${tabIdPrefix}-city-panel`}
            className={`modal-tab ${tab === "city" ? "is-active" : ""}`}
            onClick={() => setTab("city")}
          >
            City model
          </button>
          <button
            type="button"
            role="tab"
            id={`${tabIdPrefix}-geo-tab`}
            aria-selected={tab === "geo"}
            aria-controls={`${tabIdPrefix}-geo-panel`}
            className={`modal-tab ${tab === "geo" ? "is-active" : ""}`}
            onClick={() => setTab("geo")}
          >
            Geospatial
          </button>
          <button
            type="button"
            role="tab"
            id={`${tabIdPrefix}-stac-tab`}
            aria-selected={tab === "stac"}
            aria-controls={`${tabIdPrefix}-stac-panel`}
            className={`modal-tab ${tab === "stac" ? "is-active" : ""}`}
            onClick={() => setTab("stac")}
          >
            Catalog
          </button>
        </div>
        <div className="modal-body">
          {tab === "stac" ? (
            <div
              role="tabpanel"
              id={`${tabIdPrefix}-stac-panel`}
              aria-labelledby={`${tabIdPrefix}-stac-tab`}
            >
              {/* `onAddUrl`, NOT `handleUrl`: adding from the catalog must not
                  close the dialog. Picking several tiles out of one collection
                  is the normal case, and a dialog that shut after the first
                  would make the second a five-click round trip. */}
              <StacBrowser onAddUrl={onAddUrl} />
            </div>
          ) : tab === "city" ? (
            <div
              role="tabpanel"
              id={`${tabIdPrefix}-city-panel`}
              aria-labelledby={`${tabIdPrefix}-city-tab`}
            >
              <SourcePicker
                variant="panel"
                onFile={handleFile}
                onFiles={handleFiles}
                onUrl={handleUrl}
                loading={loading}
              />
            </div>
          ) : (
            <div
              role="tabpanel"
              id={`${tabIdPrefix}-geo-panel`}
              aria-labelledby={`${tabIdPrefix}-geo-tab`}
            >
              {/* Adds to `geoLayerStore` itself: a geospatial layer has no
                  parsing step, so there is no app-level loading path for it to
                  be routed through. The dialog only needs to know it happened. */}
              <GeospatialSourceForm onAdded={onClose} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
