/**
 * "Detected: CityJSON [Change…]" — the one line that replaced a tab choice.
 *
 * Detection from a name is a GUESS (a server that serves FlatCityBuf from
 * `/model.json` is not exotic, and a `.json` is as likely to be CityJSON as
 * GeoJSON), so it is never applied silently. The guess is stated, in the user's
 * vocabulary, next to a select that corrects it — before anything is fetched,
 * because a correction after a failed load costs the user the load.
 *
 * Rendered by both places a source is named: the dialog's File tab (after a
 * drop or a browse) and its URL tab (after a detect). Same words, same control.
 */
import { useId } from "react";
import {
  SOURCE_OVERRIDES,
  sourceFromKey,
  sourceKey,
  type DetectedSource,
} from "../../features/layers/detectSource";

export interface DetectionLineProps {
  /** What the name says this is — possibly already corrected. */
  readonly detected: DetectedSource;
  /** The user picked a different format. */
  readonly onChange: (next: DetectedSource) => void;
  /** What was named, shown above the line (a file name, a package's file
   *  count). Omitted on the URL tab, where the field itself is right there. */
  readonly subject?: string;
  /**
   * The formats the select may be corrected TO. Defaults to every format the
   * app loads; the File tab passes a narrower list, because two of the
   * geospatial kinds are remote by definition (a tile template and a tileset
   * are URLs, not files) and a control that offers a choice it cannot honour
   * is worse than one that does not offer it.
   */
  readonly options?: ReadonlyArray<DetectedSource>;
  /**
   * Offer the correction select at all.
   *
   * Off for a MULTI-FILE pick: several files are one CityParquet package by
   * construction (that is the only format this app reads as a directory), so
   * there is nothing to correct it to.
   */
  readonly changeable?: boolean;
}

export function DetectionLine({
  detected,
  onChange,
  subject,
  options = SOURCE_OVERRIDES,
  changeable = true,
}: DetectionLineProps) {
  const selectId = useId();

  return (
    <div className="detected-source" data-testid="detected-source">
      {subject !== undefined && (
        <p className="detected-subject" title={subject}>
          {subject}
        </p>
      )}
      <div className="detected-row">
        <p className="detected-format">
          <span className="detected-label">Detected:</span>{" "}
          <strong
            className={
              detected.kind === "unknown"
                ? "detected-name is-unknown"
                : "detected-name"
            }
          >
            {detected.label}
          </strong>
        </p>
        {changeable && (
          <div className="detected-change">
            <label className="detected-change-label" htmlFor={selectId}>
              Change…
            </label>
            <select
              id={selectId}
              className="detected-change-select"
              value={sourceKey(detected)}
              onChange={(e) => {
                const next = sourceFromKey(e.target.value);
                if (next) onChange(next);
              }}
            >
              {/* An UNKNOWN detection is not one of the options (nobody
                  chooses "unknown"), so it needs a placeholder of its own to
                  be the select's current value — otherwise the browser shows
                  the first option and the line and the select disagree. */}
              {detected.kind === "unknown" && (
                <option value="unknown">Choose a format…</option>
              )}
              {options.map((option) => (
                <option key={sourceKey(option)} value={sourceKey(option)}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
