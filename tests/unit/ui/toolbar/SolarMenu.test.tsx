/**
 * Everything about the sun lives in ONE toolbar popover now: the sliders that
 * sweep it, the presets that jump it, and the readout the engine reports back.
 *
 * These pin what that merge must not lose — the sliders reach the same
 * `solarStore` fields, the two axes stay independent, and the presets still
 * work — plus the popover behaviour the toolbar pattern requires.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SolarMenu } from "../../../../src/ui/toolbar/SolarMenu";
import { ViewerToolbar } from "../../../../src/ui/toolbar/ViewerToolbar";
import { useSolarStore } from "../../../../src/features/solar/solarStore";

const BASE = new Date(2026, 5, 21, 13, 45, 0, 0);

afterEach(() => {
  cleanup();
  useSolarStore.setState({
    datetime: new Date(),
    timeAnimating: false,
    timeSpeed: 60,
    sunPosition: null,
    latLon: null,
  });
});

/** Render the menu with its popover already open — every control under test
 *  lives inside it, and the trigger is covered by its own case below. */
function renderOpen() {
  const result = render(<SolarMenu />);
  fireEvent.click(screen.getByLabelText("Sun position"));
  return result;
}

describe("SolarMenu", () => {
  it("shows the store's datetime on both sliders, in LOCAL time", () => {
    useSolarStore.setState({ datetime: BASE });
    renderOpen();
    // 21 June 2026 is day 172; 13:45 is 13.75 hours.
    expect(
      (screen.getByLabelText("Day of year") as HTMLInputElement).value,
    ).toBe("172");
    expect(
      (screen.getByLabelText("Time of day") as HTMLInputElement).value,
    ).toBe("13.75");
  });

  it("sweeps the date without disturbing the time of day", () => {
    useSolarStore.setState({ datetime: BASE });
    renderOpen();
    fireEvent.change(screen.getByLabelText("Day of year"), {
      target: { value: "355" },
    });
    const dt = useSolarStore.getState().datetime;
    expect([dt.getMonth(), dt.getDate()]).toEqual([11, 21]);
    expect([dt.getHours(), dt.getMinutes()]).toEqual([13, 45]);
  });

  it("sweeps the time without disturbing the date", () => {
    useSolarStore.setState({ datetime: BASE });
    renderOpen();
    fireEvent.change(screen.getByLabelText("Time of day"), {
      target: { value: "6.5" },
    });
    const dt = useSolarStore.getState().datetime;
    expect([dt.getHours(), dt.getMinutes(), dt.getSeconds()]).toEqual([
      6, 30, 0,
    ]);
    expect([dt.getMonth(), dt.getDate()]).toEqual([5, 21]);
  });

  it("sets the animation speed from the slider's log scale", () => {
    renderOpen();
    fireEvent.change(screen.getByLabelText("Animation speed"), {
      target: { value: "1" },
    });
    expect(useSolarStore.getState().timeSpeed).toBe(3600);
    fireEvent.change(screen.getByLabelText("Animation speed"), {
      target: { value: "0" },
    });
    expect(useSolarStore.getState().timeSpeed).toBe(1);
  });

  it("toggles the animation, and the button says what it will do next", () => {
    renderOpen();
    const play = screen.getByRole("button", { name: "Play" });
    expect(play.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(play);
    expect(useSolarStore.getState().timeAnimating).toBe(true);
    const pause = screen.getByRole("button", { name: "Pause" });
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pause);
    expect(useSolarStore.getState().timeAnimating).toBe(false);
  });

  it("keeps exact date entry, which a slider cannot do on purpose", () => {
    useSolarStore.setState({ datetime: BASE });
    renderOpen();
    fireEvent.change(screen.getByLabelText("Exact date"), {
      target: { value: "2026-12-21" },
    });
    const dt = useSolarStore.getState().datetime;
    expect([dt.getFullYear(), dt.getMonth(), dt.getDate()]).toEqual([
      2026, 11, 21,
    ]);
    expect([dt.getHours(), dt.getMinutes()]).toEqual([13, 45]);
  });

  it("follows a datetime the animation loop published", () => {
    useSolarStore.setState({ datetime: BASE });
    renderOpen();
    act(() =>
      useSolarStore.setState({ datetime: new Date(2026, 5, 21, 18, 5) }),
    );
    expect(
      (screen.getByLabelText("Time of day") as HTMLInputElement).value,
    ).toBe(String(18 + 5 / 60));
  });

  it("restates the date, time and sun-up state in its own header", () => {
    useSolarStore.setState({
      datetime: BASE,
      sunPosition: { altitudeDeg: 42, azimuthDeg: 180, direction: [0, 0, 1] },
    });
    const { container } = renderOpen();
    // Scoped to the header: the time also appears in the slider's own readout,
    // which is the point — the reading and its control sit together.
    const summary = container.querySelector(".solar-menu-summary");
    expect(summary?.textContent).toContain("13:45");
    expect(summary?.textContent).toContain("Jun 21");
    expect(container.querySelector(".solar-scrubber-dot.is-up")).not.toBeNull();
  });

  it("dismisses on Escape and puts focus back on the trigger", () => {
    render(<SolarMenu />);
    const trigger = screen.getByLabelText("Sun position");
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Time of day")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Time of day")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the presets, which the merge folded in from their own popover", () => {
    useSolarStore.setState({ datetime: BASE });
    renderOpen();
    fireEvent.click(screen.getByTitle("Winter Noon"));
    const dt = useSolarStore.getState().datetime;
    expect([dt.getMonth(), dt.getDate(), dt.getHours()]).toEqual([11, 21, 12]);
  });
});

describe("ViewerToolbar solar cluster", () => {
  const baseProps = {
    fileName: null,
    layerCount: 1,
    pickMode: "object" as const,
    toolMode: "select" as const,
    onSetPickMode: () => undefined,
    onSetToolMode: () => undefined,
    onClose: () => undefined,
    onToggleInspector: () => undefined,
    onToggleLeftSidebar: () => undefined,
    onFitAll: () => undefined,
    theme: "dark" as const,
    onToggleTheme: () => undefined,
  };

  it("offers ONE sun button, not a separate presets one beside it", () => {
    render(<ViewerToolbar {...baseProps} />);
    expect(screen.getByLabelText("Sun position")).not.toBeNull();
    expect(screen.queryByLabelText("Solar presets")).toBeNull();
    // The clock is in the popover; the toolbar must not carry a second copy.
    expect(screen.queryByLabelText("Scene date")).toBeNull();
    expect(screen.queryByLabelText("Play time")).toBeNull();
  });

  it("keeps the sun pill, the only clock on screen while the popover is shut", () => {
    useSolarStore.setState({
      datetime: BASE,
      sunPosition: { altitudeDeg: 42, azimuthDeg: 180, direction: [0, 0, 1] },
    });
    const { container } = render(<ViewerToolbar {...baseProps} />);
    expect(container.querySelector(".sun-pill")).not.toBeNull();
  });
});
