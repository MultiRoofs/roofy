import { useState } from "react";
import { useRenderDebugStore } from "../../features/debug/renderDebugStore";
import { useSolarStore } from "../../features/solar/solarStore";
import {
  civilTimeFor,
  civilToInstant,
  SOLAR_TIME_ZONES,
  zoneOffsetLabel,
} from "../../features/solar/solarTimeZone";
import "./sunShadeSheet.css";

const SEASONS = [
  ["Summer solstice", 6, 21],
  ["Winter solstice", 12, 21],
  ["Equinox", 3, 20],
] as const;

function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

export function SunShadeSheet({ onClose }: { readonly onClose: () => void }) {
  const datetime = useSolarStore((state) => state.datetime);
  const timeZone = useSolarStore((state) => state.timeZone);
  const setDatetime = useSolarStore((state) => state.setDatetime);
  const setTimeZone = useSolarStore((state) => state.setTimeZone);
  const timeAnimating = useSolarStore((state) => state.timeAnimating);
  const setTimeAnimating = useSolarStore((state) => state.setTimeAnimating);
  const timeSpeed = useSolarStore((state) => state.timeSpeed);
  const setTimeSpeed = useSolarStore((state) => state.setTimeSpeed);
  const sun = useSolarStore((state) => state.sunPosition);
  const shadows = useRenderDebugStore((state) => state.sunShadowsEnabled);
  const setShadows = useRenderDebugStore((state) => state.setSunShadowsEnabled);
  const [error, setError] = useState<string | null>(null);
  const civil = civilTimeFor(datetime, timeZone);

  const setCivil = (date: string, time: string) => {
    const result = civilToInstant(date, time, timeZone);
    if (result.date === null) {
      setError(result.error);
      return;
    }
    setError(null);
    setDatetime(result.date);
  };

  const setPreset = (month: number, day: number) => {
    const year = civil.date.slice(0, 4);
    setCivil(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      civil.time,
    );
  };
  const today = civilTimeFor(new Date(), timeZone).date;
  const sliderValue = Math.min(Math.round(civil.minutes / 10) * 10, 1430);

  return (
    <section
      className="sun-shade-sheet"
      role="dialog"
      aria-label="Sun and shade"
    >
      <header>
        <h2>Sun &amp; shade</h2>
        <button
          type="button"
          aria-label="Close Sun and shade"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <label>
        Date
        <input
          aria-label="Sun date"
          type="date"
          value={civil.date}
          onChange={(event) => setCivil(event.target.value, civil.time)}
        />
      </label>
      <input
        className="sun-shade-time"
        aria-label="Exact time"
        type="time"
        value={civil.time}
        onChange={(event) => setCivil(civil.date, event.target.value)}
      />
      <label>
        Time of day
        <input
          aria-label="Time of day"
          type="range"
          min="0"
          max="1440"
          step="10"
          value={sliderValue}
          onChange={(event) => {
            const minutes = Number(event.target.value);
            if (minutes === 1440) {
              setCivil(nextCalendarDate(civil.date), "00:00");
              return;
            }
            setCivil(
              civil.date,
              `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
            );
          }}
        />
        <span className="sun-shade-ticks" aria-hidden>
          0 <i /> 6 <i /> 12 <i /> 18 <i /> 24
        </span>
      </label>

      <label>
        Timezone
        <select
          aria-label="Timezone"
          value={timeZone}
          onChange={(event) => {
            setTimeZone(event.target.value);
            setError(null);
          }}
        >
          {SOLAR_TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone === "browser" ? "Browser" : zone}
            </option>
          ))}
        </select>
      </label>
      <p className="sun-shade-zone">{zoneOffsetLabel(datetime, timeZone)}</p>
      {error && (
        <p role="alert" className="sun-shade-error">
          {error}
        </p>
      )}

      <div className="sun-shade-actions">
        <button
          type="button"
          aria-pressed={timeAnimating}
          onClick={() => setTimeAnimating(!timeAnimating)}
        >
          {timeAnimating ? "Pause" : "Play"}
        </button>
        {[1, 10, 60].map((speed) => (
          <button
            type="button"
            key={speed}
            aria-pressed={timeSpeed === speed}
            onClick={() => setTimeSpeed(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>
      <div className="sun-shade-presets">
        <button type="button" onClick={() => setCivil(today, civil.time)}>
          Today
        </button>
        {SEASONS.map(([label, month, day]) => (
          <button
            type="button"
            key={label}
            onClick={() => setPreset(month, day)}
          >
            {label}
          </button>
        ))}
      </div>

      <p>
        Altitude {sun ? `${sun.altitudeDeg.toFixed(0)}°` : "—"} · Azimuth{" "}
        {sun ? `${sun.azimuthDeg.toFixed(0)}°` : "—"}
      </p>
      <label className="sun-shade-shadows">
        Shadows
        <input
          aria-label="Shadows"
          type="checkbox"
          checked={shadows}
          onChange={(event) => setShadows(event.target.checked)}
        />
      </label>
    </section>
  );
}
