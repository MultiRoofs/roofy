/**
 * The one way into the viewer: a real drop zone plus a remote-URL field.
 *
 * Both entry points render THIS component — the landing page's hero (before
 * anything is loaded) and the sidebar's "+ Add Layer" dialog (once something
 * is) — so the two feel like one product rather than two different loaders
 * with two different vocabularies. The copy, the accepted extensions and the
 * drag behaviour live here once; only the skin differs, through `variant`.
 *
 * Nothing here knows how a source is loaded. It hands a `File`, a GROUP of
 * files, or a URL string to its caller, which routes it into the app's single
 * loading path (`useLayerFileLoader` via `App`'s `handleFile` / `handleFiles`
 * / `handleUrl`).
 *
 * The group is what a CityParquet package needs: it is a DIRECTORY of parquet
 * tables plus a `metadata.json`, not one file, so both the folder button and a
 * multi-file drop report the whole selection and let the loader decide which
 * members it can use.
 */

import { useCallback, useId, useRef, useState } from "react";

/** The extensions the file picker offers. `.json`/`.jsonl` are listed
 *  alongside the compound `.city.*` forms because a browser file dialog
 *  matches on the LAST dot only — without them a plain `foo.city.json`
 *  is still fine, but a file saved as `foo.json` would be greyed out. */
const ACCEPT =
  ".json,.city.json,.jsonl,.city.jsonl,.fcb,.gml,.citygml,.parquet";

/** Stated in the UI, not just in the docs: the formats this viewer reads.
 *  Kept next to {@link ACCEPT} so the two cannot drift. */
export const SUPPORTED_FORMATS =
  ".city.json · .city.jsonl · .fcb · .gml · .parquet";

export interface SourcePickerProps {
  /** A local file was dropped or browsed to. */
  readonly onFile: (file: File) => void;
  /**
   * Several files were picked at once — a CityParquet package folder, or a
   * multi-file drop — and belong to ONE layer.
   *
   * Optional because this component renders in two places and only the app
   * shell knows how to group files; a caller without it still gets the first
   * file through {@link SourcePickerProps.onFile}, which is the old behaviour
   * rather than a silently ignored drop.
   */
  readonly onFiles?: (files: File[]) => void;
  /** A remote URL was submitted. Already trimmed and non-empty. */
  readonly onUrl: (url: string) => void;
  /** A load is in flight: every control that would start a second one is
   *  disabled and the primary button says so. */
  readonly loading: boolean;
  /**
   * `hero` keeps the landing page's large, light-on-parchment treatment;
   * `panel` re-skins the same markup in the app's design tokens for the
   * dark/light chrome of the Add Layer dialog. Markup and copy are identical
   * — see the CSS section of the same name.
   */
  readonly variant?: "hero" | "panel";
  /** Show the supported-extension line. Off on the landing page, whose
   *  summary paragraph already lists them one line above. */
  readonly showFormatHint?: boolean;
}

export function SourcePicker({
  onFile,
  onFiles,
  onUrl,
  loading,
  variant = "hero",
  showFormatHint = true,
}: SourcePickerProps) {
  const [dragging, setDragging] = useState(false);
  /** A gesture this picker cannot honour, explained in place. Cleared by the
   *  next drop or folder pick — it is about the LAST attempt, not a state. */
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  /** Unique per instance: the label/field pairing must survive two pickers
   *  being mounted at once (a hero behind a dialog is not possible today, but
   *  a duplicated `id` silently breaks the label click on any day it is). */
  const urlFieldId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  /**
   * Nesting depth of the drag inside the zone.
   *
   * `dragenter`/`dragleave` fire for every descendant the cursor crosses, so a
   * plain boolean flickers off the moment the pointer passes from the zone's
   * padding onto the paragraph inside it. Counting enters and leaves is the
   * standard fix: the highlight drops only when the drag has really left.
   */
  const dragDepth = useRef(0);

  const isFileDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes("Files");

  /** True when any dropped item is a directory. `webkitGetAsEntry` is
   *  non-standard but implemented everywhere this app runs; a browser (or a
   *  test's hand-built `DataTransfer`) without it answers "no", which is the
   *  old behaviour rather than a crash. */
  const containsDirectory = (dt: DataTransfer): boolean =>
    Array.from(dt.items ?? []).some(
      (item) => item.webkitGetAsEntry?.()?.isDirectory === true,
    );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragging(true);
    // A new attempt supersedes the last one's complaint.
    setDropHint(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Without preventDefault on dragOVER the browser refuses the drop and
    // navigates to the file instead — this, not the drop handler, is what
    // makes a drop zone a drop zone.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  /**
   * Hand a picked GROUP over, whatever produced it.
   *
   * One file is one file even when it arrived through the folder button — a
   * single `.parquet` is a valid one-table package and the caller's per-file
   * path already routes it. Only a genuine group needs `onFiles`, and without
   * that prop the first file is better than nothing at all.
   */
  const emitFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (files.length === 1) {
        onFile(files[0]!);
        return;
      }
      if (onFiles) onFiles(files);
      else onFile(files[0]!);
    },
    [onFile, onFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragging(false);
      setDropHint(null);
      // A dropped DIRECTORY arrives as ONE zero-byte `File` named after the
      // folder: handing it to the loader produces "failed to load delft",
      // which reads like a broken package rather than an unsupported gesture.
      // Reading its members would need `webkitGetAsEntry` recursion (and would
      // still lose `webkitRelativePath`, which is how the layer gets its
      // name), so the folder BUTTON is the supported way in — say so.
      if (containsDirectory(e.dataTransfer)) {
        setDropHint(
          "Dropping a folder isn’t supported — use “Choose folder”, or drop the files inside it.",
        );
        return;
      }
      emitFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [emitFiles],
  );

  /** The whole folder, unfiltered: a CityParquet package is parquet tables
   *  plus a `metadata.json`, and deciding which members matter is the
   *  loader's job, not the picker's. */
  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDropHint(null);
      emitFiles(Array.from(e.target.files ?? []));
      // Cleared so re-picking the SAME folder fires `change` again.
      e.target.value = "";
    },
    [emitFiles],
  );

  const handleBrowse = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
      // Cleared so re-selecting the SAME file fires `change` again.
      e.target.value = "";
    },
    [onFile],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;
      onUrl(trimmed);
      setUrl("");
    },
    [onUrl, url],
  );

  return (
    <div className={`source-picker source-picker-${variant}`}>
      <div
        className={`drop-zone${dragging ? " is-dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="source-picker-drop-zone"
      >
        <p>
          {dragging
            ? "Release to load this file"
            : "Drop a CityJSON, CityJSONSeq, FlatCityBuf, or CityGML file here — or the files of a CityParquet folder"}
        </p>
        <p className="drop-or">or</p>
        {/* A real button, not the usual `<label>` wrapping a hidden input: a
            hidden input is not focusable, so that pattern puts the only
            browse affordance out of reach of the keyboard. */}
        <div className="file-label-row">
          <button
            type="button"
            className="file-label"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            Browse files
          </button>
          {/* A CityParquet package is a DIRECTORY, so it needs a picker that
              can return one — a file dialog cannot select a folder. */}
          <button
            type="button"
            className="file-label"
            onClick={() => folderInputRef.current?.click()}
            disabled={loading}
            title="Pick a CityParquet package folder"
          >
            Choose folder
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={handleBrowse}
          hidden
        />
        {/* Spread, not a plain attribute: `webkitdirectory` is not in React's
            JSX intrinsic types, and this passes it to the DOM without an
            error suppression. No `accept` — the folder's non-parquet members
            (`metadata.json`) are part of the package. */}
        <input
          ref={folderInputRef}
          type="file"
          {...{ webkitdirectory: "" }}
          onChange={handleFolderChange}
          hidden
        />
        {dropHint && (
          <p className="source-picker-hint" role="alert">
            {dropHint}
          </p>
        )}
        {showFormatHint && (
          <p className="source-picker-formats">{SUPPORTED_FORMATS}</p>
        )}
      </div>

      <form className="fcb-url-form" onSubmit={handleSubmit}>
        <label className="fcb-url-label" htmlFor={urlFieldId}>
          Or load from URL:
        </label>
        <div className="fcb-url-row">
          <input
            id={urlFieldId}
            type="url"
            className="fcb-url-input"
            placeholder="https://example.com/model.city.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="fcb-url-btn"
            disabled={loading || !url.trim()}
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
      </form>
    </div>
  );
}
