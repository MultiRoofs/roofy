/**
 * Solar tab in the inspector panel.
 *
 * Provides datetime controls (date picker, time slider), time animation
 * (play/pause with speed selector), preset buttons (seasonal × time-of-day),
 * and read-only sun position display.
 */

import type { ChangeEvent } from "react";
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

const SPEED_OPTIONS = [
  { label: "1x", value: 1 },
  { label: "60x", value: 60 },
  { label: "6min/s", value: 360 },
  { label: "1hr/s", value: 3600 },
] as const;

export function SolarTab() {
  const datetime = useSolarStore((s) => s.datetime);
  const sunPosition = useSolarStore((s) => s.sunPosition);
  const latLon = useSolarStore((s) => s.latLon);
  const setDatetime = useSolarStore((s) => s.setDatetime);
  const timeAnimating = useSolarStore((s) => s.timeAnimating);
  const timeSpeed = useSolarStore((s) => s.timeSpeed);
  const setTimeAnimating = useSolarStore((s) => s.setTimeAnimating);
  const setTimeSpeed = useSolarStore((s) => s.setTimeSpeed);

  const dateStr = toLocalDateStr(datetime);
  const minuteOfDay = datetime.getHours() * 60 + datetime.getMinutes();

  const handleDateChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split("-").map(Number) as [number, number, number];
    const next = new Date(datetime);
    next.setFullYear(y, m - 1, d);
    setDatetime(next);
  };

  const handleTimeSlider = (e: ChangeEvent<HTMLInputElement>) => {
    const minutes = Number(e.target.value);
    const next = new Date(datetime);
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    setDatetime(next);
  };

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
      {/* Date + Time controls */}
      <div className="attr-section">
        <div className="attr-section-title">Date &amp; Time</div>
        <div className="solar-control-row">
          <input
            type="date"
            className="solar-input"
            value={dateStr}
            onChange={handleDateChange}
          />
        </div>
        <div className="solar-control-row">
          <input
            type="range"
            className="solar-slider"
            min={0}
            max={1425}
            step={15}
            value={minuteOfDay}
            onChange={handleTimeSlider}
          />
          <span className="solar-time-label">{formatTime(minuteOfDay)}</span>
        </div>
      </div>

      {/* Time animation */}
      <div className="attr-section">
        <div className="attr-section-title">Animation</div>
        <div className="solar-control-row">
          <button
            className={`solar-preset-btn ${timeAnimating ? "tb-btn-active" : ""}`}
            onClick={() => setTimeAnimating(!timeAnimating)}
            title={timeAnimating ? "Pause" : "Play"}
            style={{ minWidth: "3.5rem" }}
          >
            {timeAnimating ? "Pause" : "Play"}
          </button>
          <select
            className="solar-input"
            value={timeSpeed}
            onChange={(e) => setTimeSpeed(Number(e.target.value))}
            style={{ marginLeft: "0.5rem", flex: 1 }}
          >
            {SPEED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
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

function toLocalDateStr(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
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
