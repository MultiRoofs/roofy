import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdvancedSettingsPanel } from "../../../src/ui/viewport/AdvancedSettingsPanel";
import {
  DEFAULT_ATMOSPHERE_STATE,
  useAtmosphereStore,
} from "../../../src/features/atmosphere/atmosphereStore";
import { useTilesStore } from "../../../src/features/tiles/tilesStore";
import {
  DEFAULT_RENDER_DEBUG_STATE,
  useRenderDebugStore,
} from "../../../src/features/debug/renderDebugStore";
import { useBasemapStore } from "../../../src/features/basemap/basemapStore";

describe("AdvancedSettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useAtmosphereStore.setState({
      cloudCoverage: 0.3,
      lensFlareEnabled: true,
      precipitation: "none",
    });
    useTilesStore.setState({ enabled: false });
    useBasemapStore.setState({ basemapId: "osm" });
    useRenderDebugStore.setState({
      ...DEFAULT_RENDER_DEBUG_STATE,
    });
  });

  it("picks precipitation, which is one choice rather than two switches", () => {
    render(<AdvancedSettingsPanel onClose={() => {}} />);
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

  it("updates the render stores from the panel controls", () => {
    render(<AdvancedSettingsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Clouds"));
    fireEvent.click(screen.getByLabelText("Aerial Perspective"));
    fireEvent.click(screen.getByLabelText("Lens Flare"));
    fireEvent.click(screen.getByLabelText("Sun Shadows"));
    fireEvent.change(screen.getByLabelText("Exposure"), {
      target: { value: "14" },
    });
    // Last, because it disables the three post-processing checkboxes above.
    fireEvent.click(screen.getByLabelText("Post Processing"));
    fireEvent.click(screen.getByLabelText("Google 3D Tiles"));

    expect(useRenderDebugStore.getState()).toMatchObject({
      postProcessingEnabled: false,
      // Clouds default OFF now, so the one click above turns them ON — the
      // assertion is "the control wrote to the store", not "everything is off".
      cloudsEnabled: true,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      exposure: 14,
    });
    expect(useAtmosphereStore.getState().lensFlareEnabled).toBe(false);
    expect(useTilesStore.getState().enabled).toBe(true);
  });

  it("toggles the streaming fetch-box diagnostic, which starts off", () => {
    render(<AdvancedSettingsPanel onClose={() => {}} />);
    const toggle = screen.getByLabelText("Streaming Fetch Box");
    expect(toggle).not.toBeChecked();
    // Independent of the post chain: the outline is a mesh, not a pass.
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);
    expect(useRenderDebugStore.getState().streamQueryBoxEnabled).toBe(true);
    fireEvent.click(toggle);
    expect(useRenderDebugStore.getState().streamQueryBoxEnabled).toBe(false);
  });

  it("offers no control without an engine counterpart", () => {
    render(<AdvancedSettingsPanel onClose={() => {}} />);

    // The three that were pure state until this pass. They are gone rather
    // than wired: their counterpart is the city mesh's three.js material,
    // which lives in @cityjson/navara-cityjson, not in the app.
    //
    // "Ambient Light" joins them for the opposite reason: it HAD a counterpart
    // (`view.addLight({ ambient })`), but it belonged to the scene-lights
    // calibration the scene no longer uses — the aerial-perspective pass lights
    // the frame from the physical atmosphere now, so a flat fill term is pure
    // over-exposure.
    for (const gone of [
      "City Shadows",
      "Double Sided",
      "City Material",
      "Ambient Light",
    ]) {
      expect(screen.queryByLabelText(gone)).toBeNull();
    }
  });

  it("disables the post-processing controls when the chain is off", () => {
    useRenderDebugStore.setState({ postProcessingEnabled: false });
    render(<AdvancedSettingsPanel onClose={() => {}} />);

    expect(screen.getByLabelText("Clouds")).toBeDisabled();
    expect(screen.getByLabelText("Aerial Perspective")).toBeDisabled();
    expect(screen.getByLabelText("Lens Flare")).toBeDisabled();
    expect(screen.getByLabelText("Cloud Coverage")).toBeDisabled();
    // Lighting is independent of the post chain.
    expect(screen.getByLabelText("Sun Shadows")).not.toBeDisabled();
    expect(screen.getByLabelText("Exposure")).not.toBeDisabled();
  });

  // The reset is a PANEL-WIDE footer action now, not a button tucked inside
  // the last section resetting only one of the two stores the panel's sliders
  // come from. Lens flare and cloud coverage live in `atmosphereStore` purely
  // for historical reasons; a reset that skipped them would leave two of the
  // controls it sits under untouched.
  it("resets every lighting and post-processing control, in both stores", () => {
    useAtmosphereStore.setState({
      cloudCoverage: 0.6,
      lensFlareEnabled: false,
    });
    useRenderDebugStore.setState({
      postProcessingEnabled: false,
      cloudsEnabled: false,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      exposure: 1,
    });

    render(<AdvancedSettingsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByText("Reset render settings"));

    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
    expect(useAtmosphereStore.getState()).toMatchObject(
      DEFAULT_ATMOSPHERE_STATE,
    );
  });

  // The other half of the coherence fix: the backdrop is a choice of what to
  // look AT, not of how it is rendered, so the reset must not silently swap the
  // user's imagery — and the button says so.
  it("leaves the backdrop choices alone, and says so", () => {
    useTilesStore.setState({ enabled: true });
    useBasemapStore.setState({ basemapId: "esri-imagery" });
    render(<AdvancedSettingsPanel onClose={() => {}} />);

    const reset = screen.getByText("Reset render settings");
    expect(reset.getAttribute("title")).toContain("left alone");

    fireEvent.click(reset);

    expect(useTilesStore.getState().enabled).toBe(true);
    expect(useBasemapStore.getState().basemapId).toBe("esri-imagery");
  });
});
