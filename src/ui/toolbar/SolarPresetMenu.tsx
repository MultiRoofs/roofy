/**
 * The seasonal preset grid and the sun-position readout, as a popover hanging
 * off the toolbar's solar cluster.
 *
 * These two were the last residents of the inspector's Solar tab, which is now
 * gone. Neither belongs in the right-hand inspector: that panel is about the
 * CURRENT SELECTION, and both of these are properties of the scene as a whole
 * — the same argument that moved the clock into the header in the previous
 * pass. A tab that exists to hold nine buttons and three read-only rows is a
 * tab the user has to go looking for; a popover on the control it configures
 * is one click from the clock it changes.
 *
 * Presets write `solarStore.datetime`, exactly as the tab did, so the
 * atmosphere push, the animation loop and persistence are untouched.
 */

import { useEffect, useRef, useState } from "react";
import { useSolarStore } from "../../features/solar/solarStore";

/** Preset dates: summer/winter solstice and the spring equinox. */
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

export function SolarPresetMenu() {
  const datetime = useSolarStore((s) => s.datetime);
  const sunPosition = useSolarStore((s) => s.sunPosition);
  const setDatetime = useSolarStore((s) => s.setDatetime);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click or Escape — a popover anchored in a toolbar
  // that only closes via its own button is a popover that covers the viewport
  // until the user finds that button again.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const applyPreset = (month: number, day: number, hour: number) => {
    const year = datetime.getFullYear();
    setDatetime(new Date(year, month, day, hour, 0, 0));
  };

  return (
    <div className="toolbar-solar-menu" ref={rootRef}>
      <button
        className={`tb-btn ${open ? "tb-btn-active" : ""}`}
        aria-label="Solar presets"
        aria-expanded={open}
        title="Solar presets and sun position"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      </button>

      {open && (
        <div className="toolbar-solar-popover" role="dialog" aria-label="Solar">
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

          <div className="attr-section">
            <div className="attr-section-title">Sun Position</div>
            {sunPosition ? (
              <>
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
                    {sunPosition.altitudeDeg > 0
                      ? "Above horizon"
                      : "Below horizon"}
                  </span>
                </div>
              </>
            ) : (
              // No site yet (nothing loaded, or a CRS the gate refused), so
              // the engine has no sun direction to report. Said explicitly
              // rather than rendered as an empty section.
              <div className="attr-row">
                <span className="attr-key">Sun</span>
                <span className="attr-value">Load a model to read the sun</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
