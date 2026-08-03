/**
 * The scene clock lives in the top header now (it is global configuration, not
 * a property of the current selection). These tests pin the two halves that
 * matter: the cluster REACHES the same `solarStore` fields the inspector tab
 * used to, and the toolbar actually renders it.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SolarControls } from "../../../../src/ui/toolbar/SolarControls";
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

describe("SolarControls", () => {
  it("shows the store's datetime in LOCAL time", () => {
    useSolarStore.setState({ datetime: BASE });
    render(<SolarControls />);
    // Local, not UTC: `toISOString()` would shift the date across midnight for
    // anyone not on UTC.
    expect(
      (screen.getByLabelText("Scene date") as HTMLInputElement).value,
    ).toBe("2026-06-21");
    expect(
      (screen.getByLabelText("Scene time") as HTMLInputElement).value,
    ).toBe("13:45");
  });

  it("edits the date without disturbing the time of day", () => {
    useSolarStore.setState({ datetime: BASE });
    render(<SolarControls />);
    fireEvent.change(screen.getByLabelText("Scene date"), {
      target: { value: "2026-12-21" },
    });
    const dt = useSolarStore.getState().datetime;
    expect([dt.getFullYear(), dt.getMonth(), dt.getDate()]).toEqual([
      2026, 11, 21,
    ]);
    expect([dt.getHours(), dt.getMinutes()]).toEqual([13, 45]);
  });

  it("edits the time without disturbing the date", () => {
    useSolarStore.setState({ datetime: BASE });
    render(<SolarControls />);
    fireEvent.change(screen.getByLabelText("Scene time"), {
      target: { value: "06:30" },
    });
    const dt = useSolarStore.getState().datetime;
    expect([dt.getHours(), dt.getMinutes(), dt.getSeconds()]).toEqual([
      6, 30, 0,
    ]);
    expect(dt.getMonth()).toBe(5);
  });

  it("toggles the animation, and shows which state it is in", () => {
    render(<SolarControls />);
    const play = screen.getByLabelText("Play time");
    expect(play.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(play);
    expect(useSolarStore.getState().timeAnimating).toBe(true);
    // The label flips, so the button says what it will DO next.
    const pause = screen.getByLabelText("Pause time");
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pause);
    expect(useSolarStore.getState().timeAnimating).toBe(false);
  });

  it("sets the animation speed", () => {
    render(<SolarControls />);
    fireEvent.change(screen.getByLabelText("Time speed"), {
      target: { value: "3600" },
    });
    expect(useSolarStore.getState().timeSpeed).toBe(3600);
  });

  it("jumps to the current time", () => {
    useSolarStore.setState({ datetime: BASE });
    render(<SolarControls />);
    fireEvent.click(screen.getByLabelText("Set time to now"));
    expect(
      Math.abs(useSolarStore.getState().datetime.getTime() - Date.now()),
    ).toBeLessThan(5000);
  });

  it("follows a datetime the animation loop published", () => {
    useSolarStore.setState({ datetime: BASE });
    render(<SolarControls />);
    act(() =>
      useSolarStore.setState({ datetime: new Date(2026, 5, 21, 18, 5) }),
    );
    expect(
      (screen.getByLabelText("Scene time") as HTMLInputElement).value,
    ).toBe("18:05");
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

  it("renders the clock in the header, with or without a sun readout", () => {
    render(<ViewerToolbar {...baseProps} />);
    expect(screen.getByLabelText("Scene date")).not.toBeNull();
    expect(screen.getByLabelText("Play time")).not.toBeNull();
    // The pill needs a site to read the sun at; the CONTROLS do not, so a
    // model whose CRS has not resolved yet can still be dated.
    expect(screen.queryByText("Sun")).toBeNull();
  });

  it("keeps the sun pill beside the cluster once there is a sun position", () => {
    useSolarStore.setState({
      datetime: BASE,
      sunPosition: { altitudeDeg: 42, azimuthDeg: 180, direction: [0, 0, 1] },
    });
    const { container } = render(<ViewerToolbar {...baseProps} />);
    expect(container.querySelector(".sun-pill")).not.toBeNull();
    expect(container.querySelector(".toolbar-solar")).not.toBeNull();
  });
});
