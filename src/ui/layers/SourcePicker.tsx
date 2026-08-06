/**
 * The one way into the viewer: a real drop zone plus a remote-URL field.
 *
 * Both entry points render THIS component — the landing page's hero (before
 * anything is loaded) and the sidebar's "+ Add Layer" dialog (once something
 * is) — so the two feel like one product rather than two different loaders
 * with two different vocabularies. The copy, the accepted extensions and the
 * drag behaviour live here once; only the skin differs, through `variant`.
 *
 * Nothing here knows how a source is loaded. It hands a `File` or a URL string
 * to its caller, which routes it into the app's single loading path
 * (`useLayerFileLoader` via `App`'s `handleFile` / `handleUrl`).
 */

import { useCallback, useId, useRef, useState } from "react";

/** The extensions the file picker offers. `.json`/`.jsonl` are listed
 *  alongside the compound `.city.*` forms because a browser file dialog
 *  matches on the LAST dot only — without them a plain `foo.city.json`
 *  is still fine, but a file saved as `foo.json` would be greyed out. */
const ACCEPT = ".json,.city.json,.jsonl,.city.jsonl,.fcb,.gml,.citygml";

/** Stated in the UI, not just in the docs: the four formats this viewer
 *  reads. Kept next to {@link ACCEPT} so the two cannot drift. */
export const SUPPORTED_FORMATS = ".city.json · .city.jsonl · .fcb · .gml";

export interface SourcePickerProps {
  /** A local file was dropped or browsed to. */
  readonly onFile: (file: File) => void;
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
  onUrl,
  loading,
  variant = "hero",
  showFormatHint = true,
}: SourcePickerProps) {
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  /** Unique per instance: the label/field pairing must survive two pickers
   *  being mounted at once (a hero behind a dialog is not possible today, but
   *  a duplicated `id` silently breaks the label click on any day it is). */
  const urlFieldId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragging(true);
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
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
            : "Drop a CityJSON, CityJSONSeq, FlatCityBuf, or CityGML file here"}
        </p>
        <p className="drop-or">or</p>
        {/* A real button, not the usual `<label>` wrapping a hidden input: a
            hidden input is not focusable, so that pattern puts the only
            browse affordance out of reach of the keyboard. */}
        <button
          type="button"
          className="file-label"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
        >
          Browse files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={handleBrowse}
          hidden
        />
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
