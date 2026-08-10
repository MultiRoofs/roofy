/**
 * Everything about the sun, in one popover hanging off one toolbar button —
 * which carries the scene's clock as its own label, so the time is legible
 * with the popover shut. That label was a separate `.sun-pill` in the toolbar
 * until the header shed its information pills: a read-only pill sitting beside
 * the button that sets the very thing it reads is two widgets for one subject.
 *
 * This is the merge of what used to be two separate controls: the scrubber
 * (day / time / speed sliders + play), which floated over the bottom-left of
 * the viewport, and the presets popover (seasonal jumps + the altitude/azimuth
 * readout), which hung off its own toolbar button beside it. Two buttons and
 * two surfaces for one subject meant the thing you wanted was always in the
 * other one — and the scrubber, being viewport furniture rather than a menu,
 * did not read as belonging to the header at all.
 *
 * The order inside is the order you reach for them: SWEEP first (the sliders
 * are the reason this control exists — "when does that roof fall into shadow"
 * is answered by dragging, not by typing), then JUMP (presets are discrete
 * choices, and `Now`), then READ (what the engine reports back).
 *
 * The two sliders are deliberately INDEPENDENT axes of the same instant: day of
 * year moves the sun through the seasonal arc, time of day through today's arc,
 * and neither disturbs the other (`solarClock.ts`).
 *
 * Reads and writes `solarStore` only, so the atmosphere push in
 * `NavaraViewport`, the animation loop and persistence are all untouched.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useSolarStore } from "../../features/solar/solarStore";
import {
  dayOfYear,
  daysInYear,
  formatClock,
  formatDayLabel,
  formatSpeed,
  hoursOfDay,
  sliderFromSpeed,
  speedFromSlider,
  withDayOfYear,
  withHoursOfDay,
} from "../../features/solar/solarClock";

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

/** `YYYY-MM-DD` in LOCAL time. `toISOString()` would shift the day for anyone
 *  east or west of UTC. */
function toLocalDateStr(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function SolarMenu() {
  const datetime = useSolarStore((s) => s.datetime);
  const setDatetime = useSolarStore((s) => s.setDatetime);
  const timeAnimating = useSolarStore((s) => s.timeAnimating);
  const setTimeAnimating = useSolarStore((s) => s.setTimeAnimating);
  const timeSpeed = useSolarStore((s) => s.timeSpeed);
  const setTimeSpeed = useSolarStore((s) => s.setTimeSpeed);
  const sunPosition = useSolarStore((s) => s.sunPosition);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const day = dayOfYear(datetime);
  const hours = hoursOfDay(datetime);
  const sunIsUp = sunPosition !== null && sunPosition.altitudeDeg > 0;

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
      if (e.key !== "Escape") return;
      setOpen(false);
      // Escape must not strand the focus ring on a node that has just been
      // unmounted: put it back where the user opened this from.
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Move focus INTO the dialog when it opens, onto the first slider — which is
  // the control this popover exists for, not merely the first focusable node.
  useEffect(() => {
    if (!open) return;
    const first =
      dialogRef.current?.querySelector<HTMLElement>("input, button");
    first?.focus();
  }, [open]);

  const applyPreset = (month: number, day: number, hour: number) => {
    setDatetime(new Date(datetime.getFullYear(), month, day, hour, 0, 0));
  };

  const handleDay = (e: ChangeEvent<HTMLInputElement>) =>
    setDatetime(withDayOfYear(datetime, Number(e.target.value)));

  const handleHours = (e: ChangeEvent<HTMLInputElement>) =>
    setDatetime(withHoursOfDay(datetime, Number(e.target.value)));

  const handleExactDate = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split("-").map(Number) as [number, number, number];
    const next = new Date(datetime);
    next.setFullYear(y, m - 1, d);
    setDatetime(next);
  };

  return (
    <div className="toolbar-solar-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className={`tb-btn sun-trigger ${open ? "tb-btn-active" : ""}`}
        // The visible label is a datetime, not a name, so the accessible name
        // stays on the aria-label.
        aria-label="Sun position"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          sunPosition
            ? // Magnitude, not the signed value: "-8.4° below horizon" states
              // the sign twice.
              `Sun ${Math.abs(sunPosition.altitudeDeg).toFixed(1)}° ${sunIsUp ? "above" : "below"} horizon`
            : "Sun position"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
        <span className="sun-trigger-label">
          {formatDatetimePill(datetime)}
        </span>
        {/* Same dot as the popover's own header, so the shut trigger and the
            open panel report the measured sun-up state identically. */}
        <span className={`solar-scrubber-dot ${sunIsUp ? "is-up" : ""}`} />
      </button>

      {open && (
        <div
          ref={dialogRef}
          className="toolbar-solar-popover solar-menu-popover"
          role="dialog"
          aria-modal="true"
          aria-label="Sun position"
        >
          <div className="attr-section">
            <div className="attr-section-title">
              <span>Time</span>
              <span className="solar-menu-summary">
                <span
                  className={`solar-scrubber-dot ${sunIsUp ? "is-up" : ""}`}
                />
                {formatDayLabel(datetime)} {formatClock(hours)}
              </span>
            </div>

            <div className="solar-scrubber-row">
              <label className="solar-scrubber-label" htmlFor="solar-day">
                Day
              </label>
              <input
                id="solar-day"
                className="solar-scrubber-slider"
                type="range"
                min={1}
                max={daysInYear(datetime.getFullYear())}
                step={1}
                value={day}
                aria-label="Day of year"
                aria-valuetext={formatDayLabel(datetime)}
                onChange={handleDay}
              />
              <output className="solar-scrubber-value">
                {formatDayLabel(datetime)}
              </output>
            </div>

            <div className="solar-scrubber-row">
              <label className="solar-scrubber-label" htmlFor="solar-time">
                Time
              </label>
              <input
                id="solar-time"
                className="solar-scrubber-slider"
                type="range"
                min={0}
                max={24}
                // A minute of travel per step: fine enough to walk a shadow
                // across a roof, coarse enough that the readout is stable.
                step={1 / 60}
                value={hours}
                aria-label="Time of day"
                aria-valuetext={formatClock(hours)}
                onChange={handleHours}
              />
              <output className="solar-scrubber-value">
                {formatClock(hours)}
              </output>
            </div>

            <div className="solar-scrubber-row">
              <label className="solar-scrubber-label" htmlFor="solar-speed">
                Speed
              </label>
              <input
                id="solar-speed"
                className="solar-scrubber-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sliderFromSpeed(timeSpeed)}
                aria-label="Animation speed"
                aria-valuetext={formatSpeed(timeSpeed)}
                onChange={(e) =>
                  setTimeSpeed(speedFromSlider(Number(e.target.value)))
                }
              />
              <output className="solar-scrubber-value">
                {formatSpeed(timeSpeed)}
              </output>
            </div>

            <div className="solar-scrubber-actions">
              <button
                className={`solar-scrubber-animate ${timeAnimating ? "is-running" : ""}`}
                aria-pressed={timeAnimating}
                onClick={() => setTimeAnimating(!timeAnimating)}
              >
                {timeAnimating ? "Pause" : "Play"}
              </button>
              {/* Exact entry earns its place beside the sliders: a slider
                  cannot land on 21 December on purpose, and comparing named
                  dates is half of what this tool is for. */}
              <input
                type="date"
                className="solar-scrubber-date"
                aria-label="Exact date"
                title="Exact date"
                value={toLocalDateStr(datetime)}
                onChange={handleExactDate}
              />
            </div>
          </div>

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

/** The trigger's compact clock: month, day and time, in LOCAL time. */
function formatDatetimePill(dt: Date): string {
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
