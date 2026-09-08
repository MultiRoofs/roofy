import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SceneSettingsSheet } from "../../../src/ui/viewport/SceneSettingsSheet";
import {
  DEFAULT_RENDER_DEBUG_STATE,
  useRenderDebugStore,
} from "../../../src/features/debug/renderDebugStore";
import {
  DEFAULT_ATMOSPHERE_STATE,
  useAtmosphereStore,
} from "../../../src/features/atmosphere/atmosphereStore";
import { useSceneThemeStore } from "../../../src/features/sceneTheme/sceneThemeStore";

describe("SceneSettingsSheet", () => {
  beforeEach(() => {
    useRenderDebugStore.setState(DEFAULT_RENDER_DEBUG_STATE);
    useAtmosphereStore.setState(DEFAULT_ATMOSPHERE_STATE);
    useSceneThemeStore.setState({ theme: "photoreal" });
  });
  afterEach(cleanup);
  it("updates exposure, shadows and shadow quality", () => {
    render(<SceneSettingsSheet onClose={() => {}} />);
    fireEvent.change(screen.getByRole("slider", { name: "Exposure" }), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByLabelText("Sun shadows"));
    expect(screen.getByLabelText("Shadow quality")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Sun shadows"));
    fireEvent.change(screen.getByLabelText("Shadow quality"), {
      target: { value: "high" },
    });
    expect(useRenderDebugStore.getState()).toMatchObject({
      exposure: 14,
      sunShadowsEnabled: true,
      shadowQuality: "high",
    });
  });
  it("applies weather dependencies and presentation looks", () => {
    useRenderDebugStore.setState({ postProcessingEnabled: false });
    render(<SceneSettingsSheet onClose={() => {}} />);
    expect(screen.getByLabelText("Clouds")).toBeDisabled();
    expect(screen.getByLabelText("Lens flare")).toBeDisabled();
    fireEvent.click(screen.getByText("Presentation looks"));
    fireEvent.click(screen.getByText("Cyber"));
    expect(useSceneThemeStore.getState().theme).toBe("cyber");
  });
  it("resets render and atmosphere stores together", () => {
    useRenderDebugStore.setState({ exposure: 20, streamQueryBoxEnabled: true });
    useAtmosphereStore.setState({ precipitation: "rain" });
    render(<SceneSettingsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText("Reset render and atmosphere settings"));
    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
    expect(useAtmosphereStore.getState()).toMatchObject(
      DEFAULT_ATMOSPHERE_STATE,
    );
  });
});
