import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_RENDER_DEBUG_STATE,
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

  it("updates each debug flag independently", () => {
    useRenderDebugStore.getState().setSunShadowsEnabled(false);
    useRenderDebugStore.getState().setCityShadowsEnabled(false);
    useRenderDebugStore.getState().setCityDoubleSided(true);
    useRenderDebugStore.getState().setCityMaterialMode("basic");

    expect(useRenderDebugStore.getState()).toMatchObject({
      sunShadowsEnabled: false,
      cityShadowsEnabled: false,
      cityDoubleSided: true,
      cityMaterialMode: "basic",
    });
  });

  it("resets back to defaults", () => {
    useRenderDebugStore.getState().setSunShadowsEnabled(false);
    useRenderDebugStore.getState().setCityMaterialMode("basic");

    useRenderDebugStore.getState().reset();

    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
  });
});
