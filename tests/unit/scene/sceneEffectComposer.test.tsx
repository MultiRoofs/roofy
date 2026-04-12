import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { type Camera } from "three";
import { SceneEffectComposer } from "../../../src/scene/SceneEffectComposer";
import { syncEffectComposerCameraSettings } from "../../../src/scene/syncEffectComposerCameraSettings";

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
  it("forwards the normal-pass flag to the wrapped composer", () => {
    const { container } = render(
      <SceneEffectComposer enableNormalPass={false}>
        <div />
      </SceneEffectComposer>,
    );

    expect(container.firstChild).toHaveAttribute(
      "data-enable-normal-pass",
      "false",
    );
  });
});

describe("syncEffectComposerCameraSettings", () => {
  it("adopts camera settings for fullscreen effect materials", async () => {
    const { EffectMaterial } = await import("postprocessing");
    const material = new EffectMaterial();
    const camera = { near: 1, far: 200000 } as unknown as Camera;

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

    expect(
      (
        material.adoptCameraSettings as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls,
    ).toHaveLength(1);
    expect(
      (
        material.adoptCameraSettings as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls[0],
    ).toEqual([camera]);
  });
});
