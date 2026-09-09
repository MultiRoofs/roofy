import { useAtmosphereStore } from "../../features/atmosphere/atmosphereStore";
import { useMemo, useState } from "react";
import { useRenderDebugStore } from "../../features/debug/renderDebugStore";
import { useSolarStore } from "../../features/solar/solarStore";
import {
  civilTimeFor,
  civilToInstant,
  SOLAR_TIME_ZONES,
  zoneOffsetLabel,
} from "../../features/solar/solarTimeZone";
import "./mapSheet.css";
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
  const clouds = useRenderDebugStore((s) => s.cloudsEnabled);
  const postProcessing = useRenderDebugStore((s) => s.postProcessingEnabled);
  const aerialPerspective = useRenderDebugStore(
    (s) => s.aerialPerspectiveEnabled,
  );
  const coverage = useAtmosphereStore((s) => s.cloudCoverage);
  const [customSpeed, setCustomSpeed] = useState(
    ![1, 60, 600].includes(timeSpeed),
  );
  const [speedDraft, setSpeedDraft] = useState(String(timeSpeed));
  const [speedError, setSpeedError] = useState("");
  const [zoneSearch, setZoneSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const zoneOptions = useMemo(
    () =>
      [...new Set([timeZone, ...SOLAR_TIME_ZONES])]
        .filter(
          (zone) =>
            zone === timeZone ||
            zone
              .toLowerCase()
              .replaceAll("_", " ")
              .includes(zoneSearch.toLowerCase()),
        )
        .map((zone) => (
          <option key={zone} value={zone}>
            {zone === "browser" ? "Browser" : zone}
          </option>
        )),
    [timeZone, zoneSearch],
  );
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
      className="sun-shade-sheet map-sheet"
      role="dialog"
      aria-label="Sun and shade"
    >
      <header className="map-sheet__header">
        <h2>Sun &amp; shade</h2>
        <button
          type="button"
          aria-label="Close Sun and shade"
          className="map-sheet__close"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </header>

      <div className="map-sheet__body sun-shade-body">
        <div
          className="sun-shade-datetime"
          role="group"
          aria-label="Date and time"
        >
          <label>
            Date
            <input
              aria-label="Sun date"
              type="date"
              value={civil.date}
              onChange={(event) => setCivil(event.target.value, civil.time)}
            />
          </label>
          <label>
            Time
            <input
              className="sun-shade-time"
              aria-label="Exact time"
              type="time"
              value={civil.time}
              onChange={(event) => setCivil(civil.date, event.target.value)}
            />
          </label>
        </div>
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
          Find timezone
          <input
            aria-label="Find timezone"
            placeholder="Search city or region"
            value={zoneSearch}
            onChange={(e) => setZoneSearch(e.target.value)}
          />
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
            {zoneOptions}
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
          {[1, 60, 600].map((speed) => (
            <button
              type="button"
              key={speed}
              aria-pressed={!customSpeed && timeSpeed === speed}
              onClick={() => {
                setCustomSpeed(false);
                setTimeSpeed(speed);
                setSpeedDraft(String(speed));
              }}
            >
              {speed}×
            </button>
          ))}
          <button
            type="button"
            aria-pressed={customSpeed}
            onClick={() => setCustomSpeed(true)}
          >
            Custom
          </button>
        </div>
        {customSpeed && (
          <form
            className="sun-speed-custom"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(speedDraft);
              if (
                !speedDraft.trim() ||
                !Number.isFinite(value) ||
                value <= 0 ||
                value > 86400
              ) {
                setSpeedError("Enter a speed greater than 0 and up to 86400×.");
                return;
              }
              setTimeSpeed(value);
              setSpeedError("");
            }}
          >
            <label>
              Custom speed
              <input
                type="number"
                min="0.01"
                max="86400"
                step="any"
                value={speedDraft}
                onChange={(e) => setSpeedDraft(e.target.value)}
              />
            </label>
            <button type="submit">Apply speed</button>
            {speedError && <p role="alert">{speedError}</p>}
          </form>
        )}
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

        <p className="sun-shade-position">
          Altitude {sun ? `${sun.altitudeDeg.toFixed(0)}°` : "—"} · Azimuth{" "}
          {sun ? `${sun.azimuthDeg.toFixed(0)}°` : "—"}
        </p>
        <label className="sun-shade-shadows">
          Clouds
          <input
            type="checkbox"
            aria-label="Clouds"
            checked={clouds}
            onChange={(e) => {
              const state = useRenderDebugStore.getState();
              state.setCloudsEnabled(e.target.checked);
              if (e.target.checked) {
                state.setPostProcessingEnabled(true);
                state.setAerialPerspectiveEnabled(true);
              }
            }}
          />
        </label>
        {clouds && (
          <label>
            Cloud coverage
            <input
              aria-label="Cloud coverage"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={coverage}
              onChange={(e) =>
                useAtmosphereStore
                  .getState()
                  .setCoverage(Number(e.target.value))
              }
            />
          </label>
        )}
        <p className="sun-shade-zone">
          {!clouds
            ? "Enable Clouds to see cloud shadows."
            : !postProcessing || !aerialPerspective
              ? "Cloud shadows need post processing and aerial perspective enabled in Scene settings."
              : coverage === 0
                ? "Increase cloud coverage to see cloud shadows."
                : "Shadows applies to buildings and clouds."}
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
      </div>
    </section>
  );
}
