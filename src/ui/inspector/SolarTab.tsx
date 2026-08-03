/**
 * Solar tab in the inspector panel.
 *
 * The PRIMARY clock — date, time, play/pause, speed, "now" — moved to the top
 * header (`ui/toolbar/SolarControls.tsx`): it is global scene configuration,
 * and this panel is about the current selection. What stays here is what does
 * not fit a header row and does not need to be one click away:
 *
 *  - the seasonal × time-of-day preset grid, and
 *  - the read-only sun position (altitude, azimuth, above/below horizon).
 *
 * Deliberately NOT a second copy of the toolbar controls. Two live editors for
 * one `solarStore.datetime` is a UI that disagrees with itself the moment the
 * animation runs, and there is nothing this panel could offer that the header
 * does not already.
 */

import { useSolarStore } from "../../features/solar/solarStore";

// Preset dates: summer/winter solstice, spring equinox.
const PRESET_DATES = [
  { label: "Summer", month: 5, day: 21 },
  { label: "Equinox", month: 2, day: 20 },
  { label: "Winter", month: 11, day: 21 },
] as const;

const PRESET_TIMES = [
  { label: "Morning", hour: 9 },
  { label: "Noon", hour: 12 },
  { label: "Evening", hour: 17 },
] as const;

export function SolarTab() {
  const datetime = useSolarStore((s) => s.datetime);
  const sunPosition = useSolarStore((s) => s.sunPosition);
  const latLon = useSolarStore((s) => s.latLon);
  const setDatetime = useSolarStore((s) => s.setDatetime);

  const applyPreset = (month: number, day: number, hour: number) => {
    const year = datetime.getFullYear();
    setDatetime(new Date(year, month, day, hour, 0, 0));
  };

  if (!latLon) {
    return (
      <div className="inspector-placeholder">
        No geographic location derived from model CRS. Solar controls require a
        supported coordinate reference system.
      </div>
    );
  }

  return (
    <>
      {/* Where the clock actually lives now. Said once, here, so nobody hunts
          this tab for a control that moved. */}
      <div className="inspector-note">
        Date, time, playback and speed are in the toolbar.
      </div>

      {/* Presets */}
      <div className="attr-section">
        <div className="attr-section-title">Presets</div>
        <div className="solar-presets">
          {PRESET_DATES.map((date) =>
            PRESET_TIMES.map((time) => (
              <button
                key={`${date.label}-${time.label}`}
                className="solar-preset-btn"
                onClick={() => applyPreset(date.month, date.day, time.hour)}
                title={`${date.label} ${time.label}`}
              >
                <span className="solar-preset-date">{date.label}</span>
                <span className="solar-preset-time">{time.label}</span>
              </button>
            )),
          )}
        </div>
        <button
          className="solar-preset-btn solar-now-btn"
          onClick={() => setDatetime(new Date())}
        >
          Now
        </button>
      </div>

      {/* Sun position readout */}
      {sunPosition && (
        <div className="attr-section">
          <div
            className="attr-section-title"
            style={{ color: "var(--accent-text)" }}
          >
            Sun Position
          </div>
          <div className="attr-row">
            <span className="attr-key">Altitude</span>
            <span
              className={`attr-value ${sunPosition.altitudeDeg > 0 ? "highlight" : ""}`}
            >
              {sunPosition.altitudeDeg.toFixed(1)}&deg;
            </span>
          </div>
          <div className="attr-row">
            <span className="attr-key">Azimuth</span>
            <span className="attr-value">
              {cardinalFromDeg(sunPosition.azimuthDeg)} (
              {sunPosition.azimuthDeg.toFixed(0)}&deg;)
            </span>
          </div>
          <div className="attr-row">
            <span className="attr-key">Status</span>
            <span className="attr-value">
              {sunPosition.altitudeDeg > 0 ? "Above horizon" : "Below horizon"}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cardinalFromDeg(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return "N";
  if (deg < 67.5) return "NE";
  if (deg < 112.5) return "E";
  if (deg < 157.5) return "SE";
  if (deg < 202.5) return "S";
  if (deg < 247.5) return "SW";
  if (deg < 292.5) return "W";
  return "NW";
}
