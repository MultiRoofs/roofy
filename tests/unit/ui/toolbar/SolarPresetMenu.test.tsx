/**
 * The presets grid and the sun readout, after they left the inspector's Solar
 * tab for a popover on the toolbar's solar cluster.
 *
 * These pin the behaviour the tab used to own — a preset writes
 * `solarStore.datetime`, the readout reports what the engine published — plus
 * the two things a popover has to get right: it starts closed, and it can be
 * dismissed without hunting for its own button again.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SolarPresetMenu } from "../../../../src/ui/toolbar/SolarPresetMenu";
import { useSolarStore } from "../../../../src/features/solar/solarStore";

const BASE = new Date(2026, 5, 21, 13, 45, 0, 0);

afterEach(() => {
  cleanup();
  useSolarStore.setState({ datetime: BASE, sunPosition: null, latLon: null });
});

describe("SolarPresetMenu", () => {
  it("starts closed and opens on its toolbar button", () => {
    render(<SolarPresetMenu />);
    expect(screen.queryByText("Presets")).toBeNull();

    fireEvent.click(screen.getByLabelText("Solar presets"));
    expect(screen.getByText("Presets")).not.toBeNull();
    expect(
      screen.getByLabelText("Solar presets").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("applies a seasonal preset to the scene clock", () => {
    useSolarStore.setState({ datetime: BASE });
    render(<SolarPresetMenu />);
    fireEvent.click(screen.getByLabelText("Solar presets"));

    fireEvent.click(screen.getByTitle("Winter Morning"));

    const dt = useSolarStore.getState().datetime;
    // Same year as the current scene date; December 21st at 09:00 local.
    expect([dt.getFullYear(), dt.getMonth(), dt.getDate()]).toEqual([
      2026, 11, 21,
    ]);
    expect([dt.getHours(), dt.getMinutes()]).toEqual([9, 0]);
  });

  it("jumps to the current time", () => {
    useSolarStore.setState({ datetime: BASE });
    render(<SolarPresetMenu />);
    fireEvent.click(screen.getByLabelText("Solar presets"));
    fireEvent.click(screen.getByText("Now"));
    expect(
      Math.abs(useSolarStore.getState().datetime.getTime() - Date.now()),
    ).toBeLessThan(5000);
  });

  it("shows the sun position the engine published", () => {
    useSolarStore.setState({
      sunPosition: { altitudeDeg: 42.3, azimuthDeg: 181, direction: [0, 0, 1] },
    });
    render(<SolarPresetMenu />);
    fireEvent.click(screen.getByLabelText("Solar presets"));

    expect(screen.getByText("42.3°")).not.toBeNull();
    expect(screen.getByText("S (181°)")).not.toBeNull();
    expect(screen.getByText("Above horizon")).not.toBeNull();
  });

  it("says the sun is below the horizon rather than hiding the row", () => {
    useSolarStore.setState({
      sunPosition: { altitudeDeg: -8, azimuthDeg: 300, direction: [0, 0, -1] },
    });
    render(<SolarPresetMenu />);
    fireEvent.click(screen.getByLabelText("Solar presets"));
    expect(screen.getByText("Below horizon")).not.toBeNull();
  });

  it("explains the empty readout when nothing is loaded", () => {
    render(<SolarPresetMenu />);
    fireEvent.click(screen.getByLabelText("Solar presets"));
    expect(screen.getByText("Load a model to read the sun")).not.toBeNull();
  });

  it("closes on Escape and on an outside click", () => {
    render(<SolarPresetMenu />);
    const button = screen.getByLabelText("Solar presets");

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Presets")).toBeNull();

    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Presets")).toBeNull();
  });

  it("stays open when the click lands inside it", () => {
    render(<SolarPresetMenu />);
    fireEvent.click(screen.getByLabelText("Solar presets"));
    fireEvent.mouseDown(screen.getByText("Presets"));
    expect(screen.getByText("Presets")).not.toBeNull();
  });
});
