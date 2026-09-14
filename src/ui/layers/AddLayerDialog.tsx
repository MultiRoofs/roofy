import { useDrawStore } from "../../features/drawing/drawStore";
/**
 * The "Add layer" modal: WHERE the source is, then WHAT it is.
 *
 * Its tabs used to be FAMILIES — "City model", "Geospatial", "Catalog" — which
 * asked the user to answer a question they should never have been asked. A
 * person with a file in their hand knows where it is, not which of this app's
 * two loading pipelines reads it; and being on the wrong tab was silently
 * fatal (a GeoJSON dropped on the city tab failed as malformed CityJSON). So
 * the tabs are the three PLACES a source comes from — File, URL, Catalog — and
 * the format is DETECTED, shown in one line, and correctable before anything
 * is loaded.
 *
 * The two-beat rhythm is the point. A pick or a paste stages the source and
 * names it ("Detected: CityJSON [Change…]"); the filled "Add layer" button is
 * the second beat, so a wrong guess costs a click rather than a failed load.
 * Detection is a pure function of the name ({@link detectSourceFromName}),
 * shared with the landing page.
 *
 * Routing, once the user confirms:
 *  - a CITY format goes out through `onAddFile` / `onAddFiles` / `onAddUrl`
 *    with the detection attached, which the loader takes as its encoding
 *    override — the correction reaching the parser is the whole point of
 *    showing it;
 *  - a GEOSPATIAL one never touches that path: a geo layer has no parsing
 *    step, so {@link addGeoSourceFromUrl} / {@link addGeoSourceFromFile} write
 *    it straight to the store and activate it.
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
import { UrlSourceForm } from "./UrlSourceForm";
import { DetectionLine } from "./DetectionLine";
import { StacBrowser, type AddUrlResult } from "../stac/StacBrowser";
import {
  SOURCE_OVERRIDES,
  UNKNOWN_SOURCE,
  detectSourceFromName,
  type DetectedSource,
} from "../../features/layers/detectSource";
import {
  addGeoSourceFromFile,
  addGeoSourceFromUrl,
} from "../../features/geoLayers/addGeoSource";

interface AddLayerDialogProps {
  readonly onClose: () => void;
  /** The file, and what the user confirmed it is — the loader's encoding
   *  override. */
  readonly onAddFile: (file: File, override?: DetectedSource) => void;
  /** Several files as ONE layer — a CityParquet package folder, or a
   *  multi-file drop. Closes the dialog exactly like `onAddFile`. */
  readonly onAddFiles: (files: File[], override?: DetectedSource) => void;
  /** Resolves `{ok: true}` once a layer has landed. The URL tab ignores the
   *  answer (it closes the dialog either way, and the app reports the
   *  failure); the catalog tab needs it to roll a failed "Added ✓" back and
   *  to show the loader's sentence beside the item. */
  readonly onAddUrl: (
    url: string,
    override?: DetectedSource,
  ) => Promise<AddUrlResult>;
  readonly loading: boolean;
  /** Which tab to open on. Defaults to `"file"` — see {@link SourceTab}. */
  readonly initialTab?: SourceTab;
}

/**
 * Where the source is.
 *
 * `"file"` is the default because it is the shortest path for the commonest
 * act (a model on disk), and because the drop zone doubles as the affordance
 * that TEACHES the gesture. The other two are one click away.
 */
export type SourceTab = "file" | "url" | "catalog" | "draw";

/** A local pick, waiting to be confirmed. `files` is the whole selection; a
 *  group of them is one CityParquet package. */
interface StagedFiles {
  readonly files: ReadonlyArray<File>;
  readonly detected: DetectedSource;
}

/** What a FILE can be corrected to. GeoJSON is the only geospatial format a
 *  file carries: an XYZ template and a 3D Tiles tileset are remote sources by
 *  definition, and offering them for a local pick would be a choice the tab
 *  could not honour. */
const FILE_SOURCE_OVERRIDES: ReadonlyArray<DetectedSource> =
  SOURCE_OVERRIDES.filter(
    (source) => source.kind !== "geo" || source.geoKind === "geojson",
  );

/** A multi-file selection is a CityParquet package by construction: it is the
 *  only format this app reads as a directory of files. */
const PACKAGE: DetectedSource = {
  kind: "city",
  encoding: "cityparquet",
  label: "CityParquet",
};

export function AddLayerDialog({
  onClose,
  onAddFile,
  onAddFiles,
  onAddUrl,
  loading,
  initialTab,
}: AddLayerDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SourceTab>(initialTab ?? "file");
  const [staged, setStaged] = useState<StagedFiles | null>(null);
  /** A refusal from the geospatial path (a CityJSON dropped and corrected to
   *  GeoJSON, a URL that is not one). Shown in place; the dialog stays open,
   *  because the answer to it is right here. */
  const [error, setError] = useState<string | null>(null);
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

  /** A pick STAGES; it does not load. The user has not seen what the app
   *  thinks the file is yet. */
  const stageFile = useCallback((file: File) => {
    setError(null);
    const detected = detectSourceFromName(file.name);
    setStaged({
      files: [file],
      // A dropped `tileset.json` really does name 3D Tiles — but a tileset is
      // a URL the engine walks, not a file it reads, so this tab cannot honour
      // it and the select does not offer it. Saying "3D Tiles" beside a
      // disabled button, with the select showing something else, would be
      // three controls telling three stories; "Unknown format" is the honest
      // one here, and the URL tab still gives the name its real answer.
      detected:
        detected.kind === "geo" && detected.geoKind !== "geojson"
          ? UNKNOWN_SOURCE
          : detected,
    });
  }, []);

  const stageFiles = useCallback((files: File[]) => {
    setError(null);
    setStaged({ files, detected: PACKAGE });
  }, []);

  /** The second beat: load what was staged, as whatever it was confirmed to
   *  be. */
  const addStaged = useCallback(() => {
    if (staged === null || staged.detected.kind === "unknown") return;
    const { files, detected } = staged;
    if (detected.kind === "geo") {
      // Unreachable through the select (see FILE_SOURCE_OVERRIDES), and stated
      // anyway: reading a tile template out of a local file is not a thing
      // this tab could do, and a silent GeoJSON parse of one would report the
      // wrong failure.
      if (detected.geoKind !== "geojson") {
        setError(
          "XYZ tiles and 3D Tiles are remote sources — add them on the URL tab.",
        );
        return;
      }
      void addGeoSourceFromFile(files[0]!).then((result) => {
        if (result.ok) onClose();
        else setError(result.error);
      });
      return;
    }
    if (files.length > 1) onAddFiles([...files], detected);
    else onAddFile(files[0]!, detected);
    onClose();
  }, [onAddFile, onAddFiles, onClose, staged]);

  /**
   * A URL the user confirmed.
   *
   * City sources go out to the app's one loading path, fire-and-forget on
   * purpose: this closes immediately, so there is nothing left on screen to
   * report the outcome to (the app's own error state has it). A geospatial one
   * is added here and reports its refusal in place.
   */
  const submitUrl = useCallback(
    (url: string, detected: DetectedSource, name?: string): string | null => {
      if (detected.kind === "unknown") return null;
      if (detected.kind === "geo") {
        const result = addGeoSourceFromUrl(url, detected.geoKind, name);
        if (!result.ok) return result.error;
        onClose();
        return null;
      }
      void onAddUrl(url, detected);
      onClose();
      return null;
    },
    [onAddUrl, onClose],
  );

  const tabs: ReadonlyArray<readonly [SourceTab, string]> = [
    ["file", "File"],
    ["url", "URL"],
    ["catalog", "Catalog"],
    ["draw", "Draw"],
  ];

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
        className={`modal add-layer-dialog${tab === "catalog" ? " modal-wide" : ""}`}
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
        {/* Three places a source comes from, one dialog. A tablist rather than
            three buttons so the keyboard and a screen reader get the
            relationship between the choice and the panel it changes. */}
        <div className="modal-tabs" role="tablist" aria-label="Source">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${tabIdPrefix}-${value}-tab`}
              aria-selected={tab === value}
              aria-controls={`${tabIdPrefix}-${value}-panel`}
              className={`modal-tab ${tab === value ? "is-active" : ""}`}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {tab === "draw" && (
            <div
              role="tabpanel"
              id={`${tabIdPrefix}-draw-panel`}
              aria-labelledby={`${tabIdPrefix}-draw-tab`}
              className="add-layer-draw"
            >
              <h3>Create a draw layer</h3>
              <p>
                Sketch a polygon on the map, then keep it flat or extrude it
                into a solid.
              </p>
              <p>
                Drawing starts automatically. Double-click to close the
                footprint, move to adjust the height, then click to finish.
              </p>
              <button
                type="button"
                className="fcb-url-btn"
                onClick={() => {
                  useDrawStore.getState().create();
                  onClose();
                }}
              >
                Add draw layer
              </button>
            </div>
          )}
          {/* The catalog is mounted only while it is SHOWING: it pulls in
              MapLibre and fetches a STAC catalog, and doing that behind the
              other two tabs would spend a user's network on a tab they never
              opened. The other two stay mounted (see below). */}
          {tab === "catalog" && (
            <div
              role="tabpanel"
              id={`${tabIdPrefix}-catalog-panel`}
              aria-labelledby={`${tabIdPrefix}-catalog-tab`}
            >
              {/* `onAddUrl`, NOT `submitUrl`: adding from the catalog must not
                  close the dialog. Picking several tiles out of one collection
                  is the normal case, and a dialog that shut after the first
                  would make the second a five-click round trip. The catalog's
                  items are typed CityJSON assets it has already identified, so
                  they need no detection pass. */}
              <StacBrowser onAddUrl={onAddUrl} />
            </div>
          )}
          {/* HIDDEN, not unmounted: a URL typed on one tab and corrected by
              hand must survive a look at the file tab, and unmounting the
              panel throws both away. `useModalChrome` skips a hidden subtree,
              so nothing in here can take the keyboard. */}
          <div
            role="tabpanel"
            id={`${tabIdPrefix}-file-panel`}
            aria-labelledby={`${tabIdPrefix}-file-tab`}
            hidden={tab !== "file"}
          >
            <SourcePicker
              variant="panel"
              onFile={stageFile}
              onFiles={stageFiles}
              loading={loading}
            />
            {staged !== null && (
              <div className="staged-source">
                <DetectionLine
                  detected={staged.detected}
                  options={FILE_SOURCE_OVERRIDES}
                  subject={
                    staged.files.length > 1
                      ? `${staged.files.length} files`
                      : staged.files[0]!.name
                  }
                  // A group is a package by construction, so there is
                  // nothing to correct it to.
                  changeable={staged.files.length === 1}
                  onChange={(detected) => {
                    // The refusal on screen was about the LAST choice; this
                    // is a new one.
                    setError(null);
                    setStaged((current) =>
                      current === null ? current : { ...current, detected },
                    );
                  }}
                />
                <button
                  type="button"
                  className="fcb-url-btn"
                  onClick={addStaged}
                  disabled={loading || staged.detected.kind === "unknown"}
                >
                  {loading ? "Loading…" : "Add layer"}
                </button>
              </div>
            )}
            {error !== null && (
              <p className="geo-source-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div
            role="tabpanel"
            id={`${tabIdPrefix}-url-panel`}
            aria-labelledby={`${tabIdPrefix}-url-tab`}
            hidden={tab !== "url"}
          >
            <UrlSourceForm
              variant="panel"
              onSubmit={submitUrl}
              loading={loading}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
