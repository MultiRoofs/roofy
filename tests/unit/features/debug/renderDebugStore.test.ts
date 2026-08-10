import { beforeEach, describe, expect, it } from "vitest";
import {
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
  });

  // The reference look (Navara's /sky/sun-time) has no clouds pass at all, and
  // at the default coverage the cloud masses dominate the sky.
  it("starts with the clouds pass off", () => {
    expect(useRenderDebugStore.getState().cloudsEnabled).toBe(false);
  });

  // A diagnostic answers a question you went looking for; it must not be scene
  // furniture in a fresh workspace.
  it("starts with the streaming fetch-box diagnostic off", () => {
    expect(useRenderDebugStore.getState().streamQueryBoxEnabled).toBe(false);
  });

  it("updates each render flag independently", () => {
    useRenderDebugStore.getState().setPostProcessingEnabled(false);
    useRenderDebugStore.getState().setCloudsEnabled(false);
    useRenderDebugStore.getState().setAerialPerspectiveEnabled(false);
    useRenderDebugStore.getState().setSunShadowsEnabled(false);
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(true);
    useRenderDebugStore.getState().setExposure(4);

    expect(useRenderDebugStore.getState()).toMatchObject({
      postProcessingEnabled: false,
      cloudsEnabled: false,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      streamQueryBoxEnabled: true,
      exposure: 4,
    });
  });

  it("clamps exposure into its slider range", () => {
    useRenderDebugStore.getState().setExposure(1e6);
    expect(useRenderDebugStore.getState().exposure).toBe(EXPOSURE_RANGE.max);

    useRenderDebugStore.getState().setExposure(-3);
    expect(useRenderDebugStore.getState().exposure).toBe(EXPOSURE_RANGE.min);

    // A NaN exposure renders a black frame with no error anywhere, so it must
    // never reach the engine.
    useRenderDebugStore.getState().setExposure(Number.NaN);
    expect(useRenderDebugStore.getState().exposure).toBe(EXPOSURE_RANGE.min);
  });

  it("resets back to defaults", () => {
    useRenderDebugStore.getState().setPostProcessingEnabled(false);
    useRenderDebugStore.getState().setSunShadowsEnabled(false);
    useRenderDebugStore.getState().setStreamQueryBoxEnabled(true);
    useRenderDebugStore.getState().setExposure(1);

    useRenderDebugStore.getState().reset();

    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
  });
});
