/**
 * The scrubber's two axes must stay independent — that is the whole premise of
 * the control — so these pin "moving one does not disturb the other" from both
 * directions, plus the clamps that keep a drag inside one year and one day.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SPEED,
  MIN_SPEED,
  dayOfYear,
  daysInYear,
  formatClock,
  formatSpeed,
  hoursOfDay,
  sliderFromSpeed,
  speedFromSlider,
  withDayOfYear,
  withHoursOfDay,
} from "../../../../src/features/solar/solarClock";

describe("daysInYear", () => {
  it("follows the Gregorian leap rule, centuries included", () => {
    expect(daysInYear(2025)).toBe(365);
    expect(daysInYear(2024)).toBe(366);
    // Divisible by 100 but not 400 — the rule most naive implementations miss.
    expect(daysInYear(1900)).toBe(365);
    expect(daysInYear(2000)).toBe(366);
  });
});

describe("dayOfYear", () => {
  it("counts from 1 on 1 January to the year's length on 31 December", () => {
    expect(dayOfYear(new Date(2026, 0, 1, 8, 30))).toBe(1);
    expect(dayOfYear(new Date(2026, 11, 31, 23, 59))).toBe(365);
    expect(dayOfYear(new Date(2024, 11, 31))).toBe(366);
  });

  it("is unaffected by the time of day", () => {
    expect(dayOfYear(new Date(2026, 5, 21, 0, 0))).toBe(
      dayOfYear(new Date(2026, 5, 21, 23, 59)),
    );
  });
});

describe("withDayOfYear", () => {
  it("moves the date while holding the time of day", () => {
    const next = withDayOfYear(new Date(2026, 5, 21, 13, 45, 30), 1);
    expect([next.getMonth(), next.getDate()]).toEqual([0, 1]);
    expect([next.getHours(), next.getMinutes()]).toEqual([13, 45]);
  });

  it("round-trips through dayOfYear across the whole year", () => {
    const base = new Date(2026, 0, 1, 9, 0);
    for (const day of [1, 59, 60, 200, 364, 365]) {
      expect(dayOfYear(withDayOfYear(base, day))).toBe(day);
    }
  });

  it("clamps to the year's real length instead of rolling into the next year", () => {
    // 2026 is a common year: dragging to 366 must stay on 31 December rather
    // than silently becoming 1 January 2027 and taking the sun with it.
    const next = withDayOfYear(new Date(2026, 5, 21, 12, 0), 366);
    expect(next.getFullYear()).toBe(2026);
    expect([next.getMonth(), next.getDate()]).toEqual([11, 31]);
    const low = withDayOfYear(new Date(2026, 5, 21, 12, 0), 0);
    expect(dayOfYear(low)).toBe(1);
  });
});

describe("hoursOfDay / withHoursOfDay", () => {
  it("reads the time as fractional hours", () => {
    expect(hoursOfDay(new Date(2026, 5, 21, 13, 30))).toBeCloseTo(13.5, 10);
  });

  it("moves the time while holding the date", () => {
    const next = withHoursOfDay(new Date(2026, 5, 21, 13, 45), 6.5);
    expect([next.getHours(), next.getMinutes(), next.getSeconds()]).toEqual([
      6, 30, 0,
    ]);
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([
      2026, 5, 21,
    ]);
  });

  it("clamps the slider's top end to 23:59 rather than rolling to tomorrow", () => {
    const next = withHoursOfDay(new Date(2026, 5, 21, 13, 45), 24);
    expect(next.getDate()).toBe(21);
    expect([next.getHours(), next.getMinutes()]).toEqual([23, 59]);
  });
});

describe("formatClock", () => {
  it("zero-pads both fields so the readout column cannot jitter mid-drag", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(9.5)).toBe("09:30");
    expect(formatClock(13.5)).toBe("13:30");
  });
});

describe("speed mapping", () => {
  it("spans the full range from real time to an hour a second", () => {
    expect(speedFromSlider(0)).toBe(MIN_SPEED);
    expect(speedFromSlider(1)).toBe(MAX_SPEED);
  });

  it("round-trips a speed through the slider position", () => {
    for (const speed of [1, 60, 360, 3600]) {
      expect(speedFromSlider(sliderFromSpeed(speed))).toBe(speed);
    }
  });

  it("is logarithmic, so the watchable speeds are not crushed into the start", () => {
    // Linearly, 60x would sit at 1.6% of the track. The midpoint should land
    // an order of magnitude up instead.
    expect(speedFromSlider(0.5)).toBeGreaterThan(50);
    expect(speedFromSlider(0.5)).toBeLessThan(80);
  });

  it("clamps out-of-range input from either end", () => {
    expect(speedFromSlider(-1)).toBe(MIN_SPEED);
    expect(speedFromSlider(2)).toBe(MAX_SPEED);
    expect(sliderFromSpeed(0)).toBe(0);
    expect(sliderFromSpeed(99_999)).toBe(1);
  });
});

describe("formatSpeed", () => {
  it("says how much scene time passes per real second, not the raw multiplier", () => {
    expect(formatSpeed(1)).toBe("1 s/s");
    expect(formatSpeed(60)).toBe("1 min/s");
    expect(formatSpeed(1800)).toBe("30 min/s");
    expect(formatSpeed(3600)).toBe("1 h/s");
  });

  it("drops the decimal when the value is whole", () => {
    expect(formatSpeed(90)).toBe("1.5 min/s");
    expect(formatSpeed(120)).toBe("2 min/s");
  });
});
