import { beforeEach, describe, expect, it } from "vitest";
import {
  AMBIENT_RANGE,
  DEFAULT_AMBIENT_INTENSITY,
  DEFAULT_EXPOSURE,
  DEFAULT_RENDER_DEBUG_STATE,
  EXPOSURE_RANGE,
  useRenderDebugStore,
} from "../../../../src/features/debug/renderDebugStore";

describe("renderDebugStore", () => {
  beforeEach(() => {
    useRenderDebugStore.setState({
      ...DEFAULT_RENDER_DEBUG_STATE,
    });
  });

  it("starts with the expected defaults", () => {
    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
  });

  // The whole of Issue 2: three's default exposure is 1, Navara's own
  // getting-started uses 10, and shipping 1 is what made the scene dark.
  it("defaults the exposure to Navara's own sample value", () => {
    expect(DEFAULT_EXPOSURE).toBe(10);
    expect(useRenderDebugStore.getState().exposure).toBe(10);
    expect(useRenderDebugStore.getState().ambientIntensity).toBe(
      DEFAULT_AMBIENT_INTENSITY,
    );
  });

  it("updates each render flag independently", () => {
    useRenderDebugStore.getState().setPostProcessingEnabled(false);
    useRenderDebugStore.getState().setCloudsEnabled(false);
    useRenderDebugStore.getState().setAerialPerspectiveEnabled(false);
    useRenderDebugStore.getState().setSunShadowsEnabled(false);
    useRenderDebugStore.getState().setExposure(4);
    useRenderDebugStore.getState().setAmbientIntensity(1.5);

    expect(useRenderDebugStore.getState()).toMatchObject({
      postProcessingEnabled: false,
      cloudsEnabled: false,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      exposure: 4,
      ambientIntensity: 1.5,
    });
  });

  it("clamps exposure and ambient intensity into their slider ranges", () => {
    useRenderDebugStore.getState().setExposure(1e6);
    expect(useRenderDebugStore.getState().exposure).toBe(EXPOSURE_RANGE.max);

    useRenderDebugStore.getState().setExposure(-3);
    expect(useRenderDebugStore.getState().exposure).toBe(EXPOSURE_RANGE.min);

    // A NaN exposure renders a black frame with no error anywhere, so it must
    // never reach the engine.
    useRenderDebugStore.getState().setExposure(Number.NaN);
    expect(useRenderDebugStore.getState().exposure).toBe(EXPOSURE_RANGE.min);

    useRenderDebugStore.getState().setAmbientIntensity(99);
    expect(useRenderDebugStore.getState().ambientIntensity).toBe(
      AMBIENT_RANGE.max,
    );
    useRenderDebugStore.getState().setAmbientIntensity(-1);
    expect(useRenderDebugStore.getState().ambientIntensity).toBe(
      AMBIENT_RANGE.min,
    );
  });

  it("resets back to defaults", () => {
    useRenderDebugStore.getState().setPostProcessingEnabled(false);
    useRenderDebugStore.getState().setSunShadowsEnabled(false);
    useRenderDebugStore.getState().setExposure(1);

    useRenderDebugStore.getState().reset();

    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
  });
});
