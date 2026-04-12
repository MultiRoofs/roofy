import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PostProcessingEffects } from "../../../src/scene/PostProcessingEffects";

const lensFlareInstances: Array<{
  uniforms: Map<
    string,
    { value: { x?: number; y?: number } | boolean | number }
  >;
}> = [];

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
  useThree: (selector: (state: unknown) => unknown) =>
    selector({
      camera: { far: 1000 },
      scene: { children: [] },
      raycaster: {
        setFromCamera: vi.fn(),
        intersectObjects: vi.fn(() => []),
      },
      size: { width: 1920, height: 1080 },
      viewport: { width: 1280, height: 720 },
    }),
}));

vi.mock("postprocessing", () => ({
  BlendFunction: { NORMAL: "NORMAL", SCREEN: "SCREEN" },
  ToneMappingMode: { AGX: "AGX" },
  VignetteTechnique: { DEFAULT: "DEFAULT" },
}));

vi.mock("@react-three/postprocessing", async () => {
  const React = await import("react");

  class MockLensFlareEffect {
    readonly uniforms = new Map([
      ["lensPosition", { value: { x: 0, y: 0 } }],
      ["screenRes", { value: { x: 0, y: 0 } }],
      ["enabled", { value: true }],
      ["opacity", { value: 1 }],
    ]);

    constructor() {
      lensFlareInstances.push(this);
    }
  }

  return {
    EffectComposer: ({
      children,
      ...props
    }: {
      readonly children: React.ReactNode;
      readonly enableNormalPass?: boolean;
    }) =>
      React.createElement(
        "div",
        {
          "data-testid": "effect-composer",
          "data-enable-normal-pass": String(props.enableNormalPass ?? false),
        },
        children,
      ),
    SMAA: () => React.createElement("div", { "data-testid": "smaa" }),
    Vignette: () => React.createElement("div", { "data-testid": "vignette" }),
    ToneMapping: ({
      exposure,
      mode,
    }: {
      readonly exposure?: number;
      readonly mode?: string;
    }) =>
      React.createElement("div", {
        "data-testid": "tone-mapping",
        "data-exposure": String(exposure ?? ""),
        "data-mode": String(mode ?? ""),
      }),
    LensFlareEffect: MockLensFlareEffect,
  };
});

vi.mock("../../../src/scene/SceneEffectComposer", async () => {
  const React = await import("react");
  return {
    SceneEffectComposer: React.forwardRef(
      (
        {
          children,
          enableNormalPass,
        }: {
          readonly children: React.ReactNode;
          readonly enableNormalPass?: boolean;
        },
        _ref: React.Ref<unknown>,
      ) =>
        React.createElement(
          "div",
          {
            "data-testid": "effect-composer",
            "data-enable-normal-pass": String(enableNormalPass ?? false),
          },
          children,
        ),
    ),
    syncEffectComposerCameraSettings: vi.fn(),
  };
});

vi.mock("@takram/three-clouds/r3f", async () => {
  const React = await import("react");
  return {
    Clouds: ({ qualityPreset }: { readonly qualityPreset?: string }) =>
      React.createElement("div", {
        "data-testid": "clouds",
        "data-quality-preset": String(qualityPreset ?? ""),
      }),
  };
});

vi.mock("@takram/three-atmosphere/r3f", async () => {
  const React = await import("react");
  return {
    LightingMask: ({ selectionLayer }: { readonly selectionLayer?: number }) =>
      React.createElement("div", {
        "data-testid": "lighting-mask",
        "data-selection-layer": String(selectionLayer ?? ""),
      }),
    AerialPerspective: ({
      albedoScale,
      correctGeometricError,
      sky,
      skyLight,
      sunLight,
    }: {
      readonly albedoScale?: number;
      readonly correctGeometricError?: boolean;
      readonly sky?: boolean;
      readonly skyLight?: boolean;
      readonly sunLight?: boolean;
    }) =>
      React.createElement("div", {
        "data-testid": "aerial-perspective",
        "data-albedo-scale": String(albedoScale ?? ""),
        "data-correct-geometric-error": String(correctGeometricError ?? false),
        "data-sky": String(sky ?? false),
        "data-sky-light": String(skyLight ?? false),
        "data-sun-light": String(sunLight ?? false),
      }),
  };
});

afterEach(() => {
  cleanup();
  lensFlareInstances.length = 0;
});

describe("PostProcessingEffects", () => {
  it("uses Takram-style aerial perspective lighting defaults", () => {
    render(
      createElement(PostProcessingEffects, {
        hasAtmosphere: true,
        cloudCoverage: 0.3,
        lensFlareEnabled: true,
        atmosphereRef: { current: null },
      }),
    );

    const aerialPerspective = screen.getByTestId("aerial-perspective");
    expect(aerialPerspective).toHaveAttribute("data-sky", "true");
    expect(aerialPerspective).toHaveAttribute("data-sun-light", "true");
    expect(aerialPerspective).toHaveAttribute("data-sky-light", "true");
    expect(aerialPerspective).toHaveAttribute(
      "data-correct-geometric-error",
      "true",
    );
    expect(aerialPerspective).toHaveAttribute(
      "data-albedo-scale",
      String(2 / Math.PI),
    );

    // LightingMask should be present with the correct selection layer
    const lightingMask = screen.getByTestId("lighting-mask");
    expect(lightingMask).toHaveAttribute("data-selection-layer", "10");
  });

  it("passes pixel canvas size to the lens flare screen resolution uniform", () => {
    render(
      createElement(PostProcessingEffects, {
        hasAtmosphere: true,
        cloudCoverage: 0.3,
        lensFlareEnabled: true,
        atmosphereRef: { current: null },
      }),
    );

    expect(lensFlareInstances).toHaveLength(1);
    const instance = lensFlareInstances.at(0);
    expect(instance).toBeDefined();
    if (!instance) {
      throw new Error("Expected lens flare instance to be created");
    }
    const screenRes = instance.uniforms.get("screenRes");
    expect(screenRes).toBeDefined();
    expect(screenRes?.value).toMatchObject({ x: 1920, y: 1080 });
  });
});
