/**
 * Weather is a toolbar popover beside the sun now, not a section of the
 * Rendering panel.
 *
 * These pin what the move must not lose — the four controls reach the same two
 * stores with the same disabled logic — plus the two things the move ADDS: the
 * popover behaviour the toolbar pattern requires, and the hint line that names
 * where the master switch went, since the dependency crosses surfaces and a
 * greyed-out popover otherwise has no visible cause.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WeatherMenu } from "../../../../src/ui/toolbar/WeatherMenu";
import { ViewerToolbar } from "../../../../src/ui/toolbar/ViewerToolbar";
import {
  DEFAULT_ATMOSPHERE_STATE,
  useAtmosphereStore,
} from "../../../../src/features/atmosphere/atmosphereStore";
import {
  DEFAULT_RENDER_DEBUG_STATE,
  useRenderDebugStore,
} from "../../../../src/features/debug/renderDebugStore";

beforeEach(() => {
  useAtmosphereStore.setState({ ...DEFAULT_ATMOSPHERE_STATE });
  useRenderDebugStore.setState({ ...DEFAULT_RENDER_DEBUG_STATE });
});

afterEach(() => {
  cleanup();
  useAtmosphereStore.setState({ ...DEFAULT_ATMOSPHERE_STATE });
  useRenderDebugStore.setState({ ...DEFAULT_RENDER_DEBUG_STATE });
});

/** Render the menu with its popover already open — every control under test
 *  lives inside it, and the trigger has its own cases below. */
function renderOpen() {
  const result = render(<WeatherMenu />);
  fireEvent.click(screen.getByLabelText("Weather"));
  return result;
}

describe("WeatherMenu", () => {
  it("names its trigger, and says what it opens", () => {
    render(<WeatherMenu />);
    const trigger = screen.getByLabelText("Weather");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // `data-tooltip`, not `title`: the toolbar's icon buttons draw the app's
    // own bubble and the two must never both appear.
    expect(trigger.getAttribute("data-tooltip")).toBe("Weather");
    expect(trigger.getAttribute("title")).toBeNull();
    // Nothing is rendered until it is asked for.
    expect(screen.queryByLabelText("Clouds")).toBeNull();
  });

  it("opens and closes from its own trigger", () => {
    render(<WeatherMenu />);
    const trigger = screen.getByLabelText("Weather");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Clouds")).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByLabelText("Clouds")).toBeNull();
  });

  it("dismisses on an outside click", () => {
    render(<WeatherMenu />);
    fireEvent.click(screen.getByLabelText("Weather"));
    expect(screen.getByLabelText("Clouds")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText("Clouds")).toBeNull();
  });

  it("stays open for a click INSIDE it — a slider drag is not a dismissal", () => {
    renderOpen();
    fireEvent.mouseDown(screen.getByLabelText("Clouds"));
    expect(screen.getByLabelText("Clouds")).not.toBeNull();
  });

  it("dismisses on Escape and puts focus back on the trigger", () => {
    render(<WeatherMenu />);
    const trigger = screen.getByLabelText("Weather");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Clouds")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus into the dialog when it opens", () => {
    renderOpen();
    expect(document.activeElement).toBe(screen.getByLabelText("Clouds"));
  });

  it("toggles clouds, which default OFF", () => {
    renderOpen();
    const clouds = screen.getByLabelText("Clouds");
    expect(clouds).not.toBeChecked();
    fireEvent.click(clouds);
    expect(useRenderDebugStore.getState().cloudsEnabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Clouds"));
    expect(useRenderDebugStore.getState().cloudsEnabled).toBe(false);
  });

  it("sets cloud coverage, and shows it as a percentage", () => {
    // Clouds ON first: the slider is gated on them, so changing it against the
    // default would assert nothing about a control the user can actually reach.
    useRenderDebugStore.setState({ cloudsEnabled: true });
    const { container } = renderOpen();
    const slider = screen.getByLabelText("Cloud Coverage");
    expect(slider).not.toBeDisabled();
    fireEvent.change(slider, { target: { value: "0.42" } });
    expect(useAtmosphereStore.getState().cloudCoverage).toBeCloseTo(0.42);
    expect(container.textContent).toContain("42%");
  });

  it("locks the coverage slider while clouds are off", () => {
    renderOpen();
    expect(screen.getByLabelText("Cloud Coverage")).toBeDisabled();
  });

  it("picks precipitation, which is one choice rather than two switches", () => {
    renderOpen();
    const picker = screen.getByLabelText("Precipitation");
    expect((picker as HTMLSelectElement).value).toBe("none");
    fireEvent.change(picker, { target: { value: "rain" } });
    expect(useAtmosphereStore.getState().precipitation).toBe("rain");
    // Selecting snow REPLACES rain: Navara models them as two meshes and
    // asking for both at once is not a state the scene can be in.
    fireEvent.change(picker, { target: { value: "snow" } });
    expect(useAtmosphereStore.getState().precipitation).toBe("snow");
    fireEvent.change(picker, { target: { value: "none" } });
    expect(useAtmosphereStore.getState().precipitation).toBe("none");
  });

  it("toggles the lens flare", () => {
    useAtmosphereStore.setState({ lensFlareEnabled: true });
    renderOpen();
    fireEvent.click(screen.getByLabelText("Lens Flare"));
    expect(useAtmosphereStore.getState().lensFlareEnabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Lens Flare"));
    expect(useAtmosphereStore.getState().lensFlareEnabled).toBe(true);
  });

  // The master switch is in the Rendering panel, on the other side of the
  // header. That dependency is the reason for the hint.
  describe("with post-processing off", () => {
    beforeEach(() => {
      useRenderDebugStore.setState({
        postProcessingEnabled: false,
        cloudsEnabled: true,
      });
    });

    it("disables every pass-backed control", () => {
      renderOpen();
      expect(screen.getByLabelText("Clouds")).toBeDisabled();
      expect(screen.getByLabelText("Cloud Coverage")).toBeDisabled();
      expect(screen.getByLabelText("Lens Flare")).toBeDisabled();
      // Precipitation is NOT pass-gated — it was not in the panel either, and
      // the move is verbatim.
      expect(screen.getByLabelText("Precipitation")).not.toBeDisabled();
    });

    it("says where the switch that disabled them is", () => {
      const { container } = renderOpen();
      const hint = container.querySelector(".weather-menu-hint");
      expect(hint?.textContent).toContain("Post-processing is off");
      expect(hint?.textContent).toContain("Rendering settings");
    });

    it("shows no hint while the chain is on", () => {
      useRenderDebugStore.setState({ postProcessingEnabled: true });
      const { container } = renderOpen();
      expect(container.querySelector(".weather-menu-hint")).toBeNull();
    });
  });
});

describe("ViewerToolbar sky cluster", () => {
  const baseProps = {
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

  // Sun then weather: both are controls for the SKY, and the adjacency is the
  // whole reason weather left the Rendering panel.
  it("puts the weather button immediately after the sun's", () => {
    const { container } = render(<ViewerToolbar {...baseProps} />);
    const sun = screen.getByLabelText("Sun position");
    const weather = screen.getByLabelText("Weather");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.indexOf(weather as HTMLButtonElement)).toBe(
      buttons.indexOf(sun as HTMLButtonElement) + 1,
    );
  });
});
