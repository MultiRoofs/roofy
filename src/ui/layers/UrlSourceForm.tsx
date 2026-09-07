/**
 * A remote source, named by URL: type it, see what it is, add it.
 *
 * Split out of {@link SourcePicker}, which used to carry a drop zone and a URL
 * field in one component with one "Load" button that guessed the format
 * silently — and out of the old `GeospatialSourceForm`, which had a URL field
 * of its own with a kind select the city tab did not have. There is one URL
 * field in the app now, and it answers for every format: the guess is shown
 * ({@link DetectionLine}) and correctable before anything is fetched.
 *
 * DETECTION IS A SEPARATE BEAT from adding. The user pastes, leaves the field
 * (or presses Enter, or clicks Detect), reads what it is, corrects it if the
 * name lied, and only then adds. A single "Load" button would have to guess in
 * silence, which is what this replaces.
 *
 * Routing is the caller's: this component knows what a URL IS, never what to
 * do with it. `onSubmit` hands back a sentence to show in place (a URL that is
 * not one) or `null` when the caller has taken it.
 */
import { useCallback, useId, useState } from "react";
import {
  detectSourceFromName,
  type DetectedSource,
} from "../../features/layers/detectSource";
import { DetectionLine } from "./DetectionLine";

export interface UrlSourceFormProps {
  /**
   * Add the source. `name` is the optional label for a geospatial layer (the
   * city path names a layer after its file). Returns an error sentence to
   * render under the field, or `null` when the add was taken.
   */
  readonly onSubmit: (
    url: string,
    detected: DetectedSource,
    name?: string,
  ) => string | null;
  /** A load is in flight: nothing here may start a second one. */
  readonly loading?: boolean;
  /** `hero` for the landing page, `panel` for the dialog — the same markup in
   *  the two skins, exactly as {@link SourcePicker} wears them. */
  readonly variant?: "hero" | "panel";
}

export function UrlSourceForm({
  onSubmit,
  loading = false,
  variant = "panel",
}: UrlSourceFormProps) {
  const [url, setUrl] = useState("");
  /** `null` until the user has asked. Nothing is detected AS THEY TYPE: a
   *  half-typed URL classifies as something else every keystroke, and a line
   *  that flickers through three formats is noise, not information. */
  const [detected, setDetected] = useState<DetectedSource | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const urlFieldId = useId();
  const nameFieldId = useId();

  const detect = useCallback(() => {
    const trimmed = url.trim();
    setDetected(trimmed === "" ? null : detectSourceFromName(trimmed));
    setError(null);
  }, [url]);

  const handleAdd = useCallback(() => {
    const trimmed = url.trim();
    if (trimmed === "" || detected === null || detected.kind === "unknown") {
      return;
    }
    setError(onSubmit(trimmed, detected, name.trim() || undefined));
  }, [detected, name, onSubmit, url]);

  return (
    <form
      className={`url-source-form fcb-url-form url-source-form-${variant}`}
      data-testid="url-source-form"
      onSubmit={(e) => {
        // Enter in the field DETECTS rather than adds: the user has not seen
        // the format yet, and adding on the same keystroke would make the
        // correction control unreachable for anyone who never touches a mouse.
        e.preventDefault();
        detect();
      }}
    >
      <label className="fcb-url-label" htmlFor={urlFieldId}>
        Source URL
      </label>
      <div className="fcb-url-row">
        <input
          id={urlFieldId}
          type="text"
          className="fcb-url-input"
          placeholder="https://example.com/model.city.json"
          value={url}
          disabled={loading}
          onChange={(e) => {
            setUrl(e.target.value);
            // The old answer described the old URL.
            setDetected(null);
            setError(null);
          }}
          // Only when there is no answer yet. `onChange` clears the answer,
          // so an EDITED URL still re-detects on the way out — but simply
          // clicking back into an untouched field must not overwrite a format
          // the user corrected by hand. Detect and Enter stay the explicit
          // "classify this again".
          onBlur={() => {
            if (detected === null) detect();
          }}
        />
        <button
          type="submit"
          className="fcb-url-btn is-secondary"
          disabled={loading || !url.trim()}
        >
          Detect
        </button>
      </div>

      {detected !== null && (
        <>
          <DetectionLine detected={detected} onChange={setDetected} />
          {/* Only for a geospatial layer: a city model is named after its
              file, and a second name for it would be a second source of
              truth the layer list has to reconcile. */}
          {detected.kind === "geo" && (
            <div className="url-source-name">
              <label className="fcb-url-label" htmlFor={nameFieldId}>
                Layer name
              </label>
              <input
                id={nameFieldId}
                type="text"
                className="fcb-url-input"
                placeholder="Optional — defaults to the URL"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
        </>
      )}

      <div className="url-source-actions">
        <button
          type="button"
          className="fcb-url-btn"
          onClick={handleAdd}
          disabled={loading || detected === null || detected.kind === "unknown"}
        >
          {loading ? "Loading…" : "Add layer"}
        </button>
      </div>

      {error !== null && (
        <p className="geo-source-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
