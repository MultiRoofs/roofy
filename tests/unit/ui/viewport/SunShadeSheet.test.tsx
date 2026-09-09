import { afterEach, describe, expect, it } from "vitest";
import {
  fireEvent,
  render,
  screen,
  cleanup,
  within,
} from "@testing-library/react";
import { SunShadeSheet } from "../../../../src/ui/viewport/SunShadeSheet";
import { civilTimeFor } from "../../../../src/features/solar/solarTimeZone";
import { useSolarStore } from "../../../../src/features/solar/solarStore";

afterEach(() => {
  cleanup();
  useSolarStore.setState({
    datetime: new Date("2026-07-15T12:00:00Z"),
    timeZone: "Europe/Amsterdam",
    timeAnimating: false,
    timeSpeed: 60,
    sunPosition: null,
  });
});
describe("SunShadeSheet", () => {
  it("groups the date and visibly labelled time as one edit", () => {
    render(<SunShadeSheet onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "Date and time" });
    expect(within(group).getByLabelText("Sun date")).toHaveAttribute(
      "type",
      "date",
    );
    expect(
      within(group).getByLabelText("Time", { exact: true }),
    ).toHaveAttribute("type", "time");
  });
  it("changes civil time in the selected zone and retains its instant when zone changes", () => {
    useSolarStore.setState({
      datetime: new Date("2026-07-15T12:00:00Z"),
      timeZone: "Europe/Amsterdam",
    });
    render(<SunShadeSheet onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Time of day"), {
      target: { value: "870" },
    });
    expect(useSolarStore.getState().datetime.toISOString()).toBe(
      "2026-07-15T12:30:00.000Z",
    );
    const instant = useSolarStore.getState().datetime;
    fireEvent.change(screen.getByLabelText("Timezone"), {
      target: { value: "UTC" },
    });
    expect(useSolarStore.getState().datetime).toBe(instant);
  });
  it("rejects a spring gap inline", () => {
    useSolarStore.setState({ datetime: new Date("2026-03-29T00:00:00Z") });
    render(<SunShadeSheet onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Time of day"), {
      target: { value: "150" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("does not exist");
  });
  it("edits the date while preserving the selected-zone clock", () => {
    useSolarStore.setState({
      datetime: new Date("2026-07-15T12:30:00Z"),
      timeZone: "Europe/Amsterdam",
    });
    render(<SunShadeSheet onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Sun date"), {
      target: { value: "2026-12-21" },
    });
    expect(
      civilTimeFor(useSolarStore.getState().datetime, "Europe/Amsterdam"),
    ).toMatchObject({ date: "2026-12-21", time: "14:30" });
  });
  it("presets preserve the selected-zone clock and supports the 24:00 endpoint", () => {
    useSolarStore.setState({
      datetime: new Date("2026-07-15T12:30:00Z"),
      timeZone: "Europe/Amsterdam",
    });
    render(<SunShadeSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Winter solstice" }));
    expect(
      civilTimeFor(useSolarStore.getState().datetime, "Europe/Amsterdam"),
    ).toMatchObject({ date: "2026-12-21", time: "14:30" });
    fireEvent.change(screen.getByLabelText("Time of day"), {
      target: { value: "1440" },
    });
    expect(
      civilTimeFor(useSolarStore.getState().datetime, "Europe/Amsterdam"),
    ).toMatchObject({ date: "2026-12-22", time: "00:00" });
  });
});

it("offers fast presets and a validated custom playback speed", () => {
  render(<SunShadeSheet onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "600×" }));
  expect(useSolarStore.getState().timeSpeed).toBe(600);
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom speed"), {
    target: { value: "3600" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply speed" }));
  expect(useSolarStore.getState().timeSpeed).toBe(3600);
});

import { useRenderDebugStore } from "../../../../src/features/debug/renderDebugStore";
it("enables the cloud rendering dependencies from the sun panel", () => {
  useRenderDebugStore.setState({
    cloudsEnabled: false,
    postProcessingEnabled: false,
    aerialPerspectiveEnabled: false,
  });
  render(<SunShadeSheet onClose={() => {}} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Clouds" }));
  expect(useRenderDebugStore.getState()).toMatchObject({
    cloudsEnabled: true,
    postProcessingEnabled: true,
    aerialPerspectiveEnabled: true,
  });
  expect(
    screen.getByRole("slider", { name: "Cloud coverage" }),
  ).toBeInTheDocument();
});
