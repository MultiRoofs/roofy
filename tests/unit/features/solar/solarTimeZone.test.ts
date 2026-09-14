import { describe, expect, it } from "vitest";
import {
  civilTimeFor,
  civilToInstant,
  normalizeSolarTimeZone,
  zoneOffsetLabel,
} from "../../../../src/features/solar/solarTimeZone";
import { useSolarStore } from "../../../../src/features/solar/solarStore";

describe("solarTimeZone", () => {
  it("formats Amsterdam winter and summer with their actual clocks", () => {
    expect(
      civilTimeFor(new Date("2026-01-15T12:00:00Z"), "Europe/Amsterdam"),
    ).toMatchObject({ date: "2026-01-15", time: "13:00", minutes: 780 });
    expect(
      civilTimeFor(new Date("2026-07-15T12:00:00Z"), "Europe/Amsterdam"),
    ).toMatchObject({ date: "2026-07-15", time: "14:00", minutes: 840 });
    expect(
      zoneOffsetLabel(new Date("2026-07-15T12:00:00Z"), "Europe/Amsterdam"),
    ).toContain("UTC+2");
  });

  it("supports UTC and browser zones and normalizes invalid input", () => {
    expect(civilTimeFor(new Date("2026-07-15T12:34:00Z"), "UTC")).toMatchObject(
      { time: "12:34" },
    );
    expect(
      civilTimeFor(new Date("2026-07-15T12:34:00Z"), "browser").time,
    ).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeSolarTimeZone("bad")).toBe("Europe/Amsterdam");
  });

  it("converts an ordinary civil edit in its selected zone", () => {
    expect(civilToInstant("2026-07-15", "14:30", "Europe/Amsterdam")).toEqual({
      date: new Date("2026-07-15T12:30:00.000Z"),
    });
  });

  it("rejects an invalid calendar date before DST handling", () => {
    expect(civilToInstant("2026-02-30", "12:00", "Europe/Amsterdam")).toEqual({
      date: null,
      error: "Enter a valid date and time.",
    });
  });

  it("rejects invalid clock fields before DST handling", () => {
    expect(civilToInstant("2026-07-15", "25:00", "Europe/Amsterdam")).toEqual({
      date: null,
      error: "Enter a valid date and time.",
    });
  });

  it("rejects the Amsterdam spring-forward gap", () => {
    expect(civilToInstant("2026-03-29", "02:30", "Europe/Amsterdam")).toEqual({
      date: null,
      error: "This time does not exist because clocks move forward.",
    });
  });

  it("chooses the earlier instant for an autumn ambiguous civil time", () => {
    expect(civilToInstant("2026-10-25", "02:30", "Europe/Amsterdam")).toEqual({
      date: new Date("2026-10-25T00:30:00.000Z"),
    });
  });

  it("keeps the instant when changing the display zone", () => {
    const instant = new Date("2026-07-15T12:00:00Z");
    useSolarStore.setState({ datetime: instant, timeZone: "Europe/Amsterdam" });
    useSolarStore.getState().setTimeZone("UTC");
    expect(useSolarStore.getState().datetime).toBe(instant);
    expect(useSolarStore.getState().timeZone).toBe("UTC");
  });
});

it("accepts IANA zones across regions, including fractional offsets", () => {
  expect(normalizeSolarTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  expect(
    civilTimeFor(new Date("2026-01-15T12:00:00Z"), "Asia/Kolkata").time,
  ).toBe("17:30");
  expect(
    civilToInstant(
      "2026-01-15",
      "07:00",
      "America/New_York",
    ).date?.toISOString(),
  ).toBe("2026-01-15T12:00:00.000Z");
});
