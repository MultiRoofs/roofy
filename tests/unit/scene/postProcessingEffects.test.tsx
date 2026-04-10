import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PostProcessingEffects } from "../../../src/scene/PostProcessingEffects";

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
      viewport: { width: 1280, height: 720 },
    }),
}));

vi.mock("postprocessing", () => ({
  BlendFunction: { NORMAL: "NORMAL" },
  ToneMappingMode: { AGX: "AGX" },
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
        "data-correct-geometric-error": String(
          correctGeometricError ?? false,
        ),
        "data-sky": String(sky ?? false),
        "data-sky-light": String(skyLight ?? false),
        "data-sun-light": String(sunLight ?? false),
      }),
  };
});

afterEach(() => {
  cleanup();
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
  });
});
