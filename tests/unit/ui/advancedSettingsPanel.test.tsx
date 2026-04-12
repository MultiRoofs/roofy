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

  it("updates the scene debug stores from the panel controls", () => {
    render(<AdvancedSettingsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Clouds"));
    fireEvent.click(screen.getByLabelText("Aerial Perspective"));
    fireEvent.click(screen.getByLabelText("Normal Pass"));
    fireEvent.click(screen.getByLabelText("Post Processing"));
    fireEvent.click(screen.getByLabelText("Sun Shadows"));
    fireEvent.click(screen.getByLabelText("City Shadows"));
    fireEvent.click(screen.getByLabelText("Double Sided"));
    fireEvent.change(screen.getByLabelText("City Material"), {
      target: { value: "basic" },
    });
    fireEvent.click(screen.getByLabelText("Google 3D Tiles"));

    expect(useRenderDebugStore.getState()).toMatchObject({
      postProcessingEnabled: false,
      cloudsEnabled: false,
      aerialPerspectiveEnabled: false,
      normalPassEnabled: false,
      sunShadowsEnabled: false,
      cityShadowsEnabled: false,
      cityDoubleSided: true,
      cityMaterialMode: "basic",
    });
    expect(useTilesStore.getState().enabled).toBe(true);
  });

  it("resets debug settings without changing atmosphere controls", () => {
    useAtmosphereStore.setState({
      cloudCoverage: 0.6,
      lensFlareEnabled: false,
    });
    useRenderDebugStore.setState({
      postProcessingEnabled: false,
      cloudsEnabled: false,
      aerialPerspectiveEnabled: false,
      normalPassEnabled: false,
      sunShadowsEnabled: false,
      cityShadowsEnabled: false,
      cityDoubleSided: true,
      cityMaterialMode: "basic",
    });

    render(<AdvancedSettingsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByText("Reset Debug"));

    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
    expect(useAtmosphereStore.getState()).toMatchObject({
      cloudCoverage: 0.6,
      lensFlareEnabled: false,
    });
  });
});
