/**
 * The solar clock, in the top header.
 *
 * Sun position is GLOBAL configuration — it changes the whole scene's lighting
 * and every shading result — so it belongs next to the other global controls,
 * not inside a tab of the right-hand inspector that is about the current
 * selection. This is the compact cluster: date, time, play/pause and speed,
 * rendered beside the existing sun pill.
 *
 * The inspector's `SolarTab` keeps what does NOT fit a header: the seasonal ×
 * time-of-day presets and the altitude/azimuth readout.
 *
 * All wiring is unchanged — this reads and writes exactly the `solarStore`
 * fields `SolarTab` did, so `NavaraViewport`'s atmosphere push, the animation
 * loop and the persistence layer are untouched.
 */

import type { ChangeEvent } from "react";
import { useSolarStore } from "../../features/solar/solarStore";

const SPEED_OPTIONS = [
  { label: "1×", value: 1 },
  { label: "60×", value: 60 },
  { label: "6min/s", value: 360 },
  { label: "1hr/s", value: 3600 },
] as const;

/** `YYYY-MM-DD` in LOCAL time — `toISOString()` would shift the date across
 *  midnight for anyone east or west of UTC. */
export function toLocalDateStr(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `HH:MM` in local time, for `<input type="time">`. */
export function toLocalTimeStr(dt: Date): string {
  const h = String(dt.getHours()).padStart(2, "0");
  const m = String(dt.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function SolarControls() {
  const datetime = useSolarStore((s) => s.datetime);
  const setDatetime = useSolarStore((s) => s.setDatetime);
  const timeAnimating = useSolarStore((s) => s.timeAnimating);
  const setTimeAnimating = useSolarStore((s) => s.setTimeAnimating);
  const timeSpeed = useSolarStore((s) => s.timeSpeed);
  const setTimeSpeed = useSolarStore((s) => s.setTimeSpeed);

  const handleDate = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split("-").map(Number) as [number, number, number];
    const next = new Date(datetime);
    next.setFullYear(y, m - 1, d);
    setDatetime(next);
  };

  const handleTime = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [h, min] = val.split(":").map(Number) as [number, number];
    const next = new Date(datetime);
    next.setHours(h, min, 0, 0);
    setDatetime(next);
  };

  return (
    <div className="toolbar-solar">
      <input
        type="date"
        className="toolbar-solar-input"
        aria-label="Scene date"
        title="Scene date"
        value={toLocalDateStr(datetime)}
        onChange={handleDate}
      />
      <input
        type="time"
        className="toolbar-solar-input toolbar-solar-time"
        aria-label="Scene time"
        title="Scene time"
        value={toLocalTimeStr(datetime)}
        onChange={handleTime}
      />
      <button
        className={`tb-btn ${timeAnimating ? "tb-btn-active" : ""}`}
        aria-label={timeAnimating ? "Pause time" : "Play time"}
        aria-pressed={timeAnimating}
        title={timeAnimating ? "Pause time" : "Play time"}
        onClick={() => setTimeAnimating(!timeAnimating)}
      >
        {timeAnimating ? (
          <svg viewBox="0 0 24 24">
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M6 4l14 8-14 8V4z" />
          </svg>
        )}
      </button>
      <select
        className="toolbar-solar-input toolbar-solar-speed"
        aria-label="Time speed"
        title="Time speed"
        value={timeSpeed}
        onChange={(e) => setTimeSpeed(Number(e.target.value))}
      >
        {SPEED_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        className="tb-btn"
        aria-label="Set time to now"
        title="Set time to now"
        onClick={() => setDatetime(new Date())}
      >
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
    </div>
  );
}
