/**
 * The scene-theme policy table.
 *
 * The table IS the specification of what a theme means, so the assertions here
 * are about its SHAPE and its invariants rather than about any single tuned
 * number (the commander's browser pass owns those):
 *
 *   - photoreal is a provable no-op — every override null, every "off" flag
 *     false, so applying it pushes nothing anywhere;
 *   - every theme's `meshStyle` is ONE frozen object, because `handleSync`
 *     compares by identity to decide whether to re-extract every edge of every
 *     layer;
 *   - a theme that draws edges must say so, and a "tint" fill must carry the
 *     colour it tints with — a half-specified style would reach the plugin.
 */
import { describe, expect, it } from "vitest";
import {
  SCENE_THEMES,
  type SceneTheme,
} from "../../../src/features/sceneTheme/sceneThemeStore";
import { sceneThemePolicy } from "../../../src/scene/sceneThemePolicy";

describe("sceneThemePolicy", () => {
  it("has an entry for every theme", () => {
    for (const theme of SCENE_THEMES) {
      expect(sceneThemePolicy(theme)).toBeTruthy();
    }
  });

  it("makes photoreal a no-op: no override, nothing switched off", () => {
    const policy = sceneThemePolicy("photoreal");

    expect(policy.meshStyle).toEqual({ fill: "vertex", edges: null });
    expect(policy.basemapOverride).toBeNull();
    expect(policy.googleTilesOff).toBe(false);

    const env = policy.environment;
    expect(env.skyVisible).toBeNull();
    expect(env.starsBoost).toBeNull();
    expect(env.skyBoxColors).toBeNull();
    expect(env.glowGlobe).toBeNull();
    expect(env.globeWireframe).toBeNull();
    expect(env.globeColor).toBeNull();
    expect(env.toneMappingMode).toBeNull();
    expect(env.exposure).toBeNull();
    expect(env.apAlbedoScale).toBeNull();
    expect(env.skyLightProbeIntensity).toBeNull();
    expect(env.cloudsOff).toBe(false);
    expect(env.lensFlareOff).toBe(false);
  });

  it("hands out ONE frozen meshStyle per theme, stable across calls", () => {
    for (const theme of SCENE_THEMES) {
      const style = sceneThemePolicy(theme).meshStyle;
      // Identity, not equality: `handleSync` skips the push (and therefore a
      // full edge re-extraction) when the style is the same OBJECT.
      expect(sceneThemePolicy(theme).meshStyle).toBe(style);
      expect(Object.isFrozen(style)).toBe(true);
    }
  });

  it("freezes the policy objects themselves, so nothing downstream can edit the table", () => {
    for (const theme of SCENE_THEMES) {
      const policy = sceneThemePolicy(theme);
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.environment)).toBe(true);
    }
  });

  it("gives every non-photoreal theme a complete mesh style", () => {
    const themed = SCENE_THEMES.filter(
      (t): t is Exclude<SceneTheme, "photoreal"> => t !== "photoreal",
    );
    expect(themed).toHaveLength(3);

    for (const theme of themed) {
      const style = sceneThemePolicy(theme).meshStyle;
      // Every themed look draws edges — that is the whole point of the three.
      expect(style.edges).not.toBeNull();
      const edges = style.edges!;
      // A colour is always present as the non-HDR fallback, even when an HDR
      // triple is what the theme actually renders with.
      expect(typeof edges.color).toBe("number");
      if (edges.hdr !== undefined) expect(edges.hdr).toHaveLength(3);
      // A "tint" fill with no colour would multiply by `undefined`.
      if (style.fill === "tint") expect(style.tintRGB).toHaveLength(3);
      else expect(style.tintRGB).toBeUndefined();
    }
  });

  it("turns Google's photorealistic tiles off for every non-photoreal theme", () => {
    // Photoreal tiles under a cartoon or neon city is the one combination that
    // cannot be made to look deliberate.
    expect(sceneThemePolicy("cartoon").googleTilesOff).toBe(true);
    expect(sceneThemePolicy("cyber").googleTilesOff).toBe(true);
    expect(sceneThemePolicy("wireframe").googleTilesOff).toBe(true);
  });

  it("overrides the basemap where the theme needs one, and only there", () => {
    // Cartoon wants a pastel sheet under flat-coloured buildings; the two dark
    // themes want nothing at all under theirs.
    expect(sceneThemePolicy("cartoon").basemapOverride).toBe("carto-positron");
    expect(sceneThemePolicy("cyber").basemapOverride).toBe("none");
    expect(sceneThemePolicy("wireframe").basemapOverride).toBe("none");
  });

  it("never touches the globe's own setters, in ANY theme", () => {
    // Writing `view.globe.wireframe`/`view.globe.color` (live setters no code
    // path had ever exercised) blacks out the frame's irradiance on 0.0.5 —
    // browser-diagnosed 2026-08-06, recorded as upstream bug (i). This test is
    // the regression guard: no theme may reach for those levers again until
    // the engine fix is verified.
    for (const theme of [
      "photoreal",
      "cartoon",
      "cyber",
      "wireframe",
    ] as const) {
      expect(sceneThemePolicy(theme).environment.globeWireframe).not.toBe(true);
      expect(sceneThemePolicy(theme).environment.globeColor).toBeNull();
    }
  });

  it("gives cyber the Fresnel halo and the star boost, and nobody else", () => {
    const cyber = sceneThemePolicy("cyber").environment;
    expect(cyber.glowGlobe).not.toBeNull();
    expect(cyber.starsBoost).not.toBeNull();
    expect(sceneThemePolicy("cartoon").environment.glowGlobe).toBeNull();
    expect(sceneThemePolicy("wireframe").environment.glowGlobe).toBeNull();
  });

  it("gives cartoon the flat sky box, and nobody else", () => {
    expect(sceneThemePolicy("cartoon").environment.skyBoxColors).not.toBeNull();
    expect(sceneThemePolicy("cyber").environment.skyBoxColors).toBeNull();
    expect(sceneThemePolicy("wireframe").environment.skyBoxColors).toBeNull();
  });

  it("switches the weather and the lens flare off in every themed look", () => {
    for (const theme of ["cartoon", "cyber", "wireframe"] as const) {
      const env = sceneThemePolicy(theme).environment;
      expect(env.cloudsOff).toBe(true);
      expect(env.lensFlareOff).toBe(true);
      // Every themed look replaces the physical sky with its own backdrop.
      expect(env.skyVisible).toBe(false);
    }
  });

  it("keeps every exposure it names positive and finite", () => {
    for (const theme of SCENE_THEMES) {
      const { exposure, apAlbedoScale, skyLightProbeIntensity } =
        sceneThemePolicy(theme).environment;
      for (const value of [exposure, apAlbedoScale, skyLightProbeIntensity]) {
        if (value === null) continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      if (exposure !== null) expect(exposure).toBeGreaterThan(0);
    }
  });
});
