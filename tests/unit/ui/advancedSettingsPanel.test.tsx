import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdvancedSettingsPanel } from "../../../src/ui/viewport/AdvancedSettingsPanel";
import { useAtmosphereStore } from "../../../src/features/atmosphere/atmosphereStore";
import { useTilesStore } from "../../../src/features/tiles/tilesStore";
import {
  DEFAULT_RENDER_DEBUG_STATE,
  useRenderDebugStore,
} from "../../../src/features/debug/renderDebugStore";

describe("AdvancedSettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useAtmosphereStore.setState({
      cloudCoverage: 0.3,
      lensFlareEnabled: true,
    });
    useTilesStore.setState({ enabled: false });
    useRenderDebugStore.setState({
      ...DEFAULT_RENDER_DEBUG_STATE,
    });
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
    fireEvent.change(screen.getByLabelText("Ambient Light"), {
      target: { value: "1.2" },
    });
    // Last, because it disables the three post-processing checkboxes above.
    fireEvent.click(screen.getByLabelText("Post Processing"));
    fireEvent.click(screen.getByLabelText("Google 3D Tiles"));

    expect(useRenderDebugStore.getState()).toMatchObject({
      postProcessingEnabled: false,
      cloudsEnabled: false,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      exposure: 14,
      ambientIntensity: 1.2,
    });
    expect(useAtmosphereStore.getState().lensFlareEnabled).toBe(false);
    expect(useTilesStore.getState().enabled).toBe(true);
  });

  it("offers no control without an engine counterpart", () => {
    render(<AdvancedSettingsPanel onClose={() => {}} />);

    // The three that were pure state until this pass. They are gone rather
    // than wired: their counterpart is the city mesh's three.js material,
    // which lives in @cityjson/navara-cityjson, not in the app.
    for (const gone of ["City Shadows", "Double Sided", "City Material"]) {
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

  it("resets render settings without changing atmosphere controls", () => {
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
      ambientIntensity: 0,
    });

    render(<AdvancedSettingsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByText("Reset Rendering"));

    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
    expect(useAtmosphereStore.getState()).toMatchObject({
      cloudCoverage: 0.6,
      lensFlareEnabled: false,
    });
  });
});
