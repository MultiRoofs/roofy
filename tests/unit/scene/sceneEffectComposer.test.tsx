import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { HalfFloatType } from "three";
import {
  SceneEffectComposer,
  syncEffectComposerCameraSettings,
} from "../../../src/scene/SceneEffectComposer";

const composerMock = { passes: [] as unknown[] };

vi.mock("postprocessing", () => {
  class MockNormalPass {
    readonly renderTarget = {
      texture: {
        type: 0,
      },
    };
  }

  class MockEffectMaterial {
    adoptCameraSettings = vi.fn();
  }

  return {
    NormalPass: MockNormalPass,
    EffectMaterial: MockEffectMaterial,
  };
});

vi.mock("@react-three/postprocessing", async () => {
  const React = await import("react");

  const EffectComposer = React.forwardRef(function MockEffectComposer(
    {
      children,
      enableNormalPass,
    }: {
      readonly children?: React.ReactNode;
      readonly enableNormalPass?: boolean;
    },
    forwardedRef: React.ForwardedRef<{ passes: unknown[] }>,
  ) {
    React.useImperativeHandle(forwardedRef, () => composerMock, []);
    return React.createElement(
      "div",
      {
        "data-enable-normal-pass": String(enableNormalPass ?? false),
      },
      children,
    );
  });

  return { EffectComposer };
});

afterEach(() => {
  cleanup();
  composerMock.passes = [];
});

describe("SceneEffectComposer", () => {
  it("upgrades the normal pass render target to half-float precision", async () => {
    const { NormalPass } = await import("postprocessing");
    const normalPass = new NormalPass();
    composerMock.passes = [normalPass];

    render(createElement(SceneEffectComposer, null, createElement("div")));

    expect(normalPass.renderTarget.texture.type).toBe(HalfFloatType);
  });
});

describe("syncEffectComposerCameraSettings", () => {
  it("adopts camera settings for fullscreen effect materials", async () => {
    const { EffectMaterial } = await import("postprocessing");
    const material = new EffectMaterial();
    const camera = { near: 1, far: 200000 };

    syncEffectComposerCameraSettings(
      {
        passes: [
          { fullscreenMaterial: material },
          { fullscreenMaterial: { adoptCameraSettings: vi.fn() } },
          {},
        ],
      },
      camera,
    );

    expect(material.adoptCameraSettings).toHaveBeenCalledOnce();
    expect(material.adoptCameraSettings).toHaveBeenCalledWith(camera);
  });
});
