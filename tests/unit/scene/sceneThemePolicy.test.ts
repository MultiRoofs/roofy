/**
 * The scene-theme policy table.
 *
 * The table IS the specification of what a theme means, so the assertions here
 * are about its SHAPE and its invariants rather than about any single tuned
 * number (the commander's browser pass owns those):
 *
 *   - photoreal's ENVIRONMENT is a provable no-op — every override null, every
 *     "off" flag false, so applying it pushes nothing anywhere; its mesh style
 *     is the plugin's default look plus the outline every theme draws;
 *   - every theme's `meshStyle` is ONE frozen object, because `handleSync`
 *     compares by identity to decide whether to re-extract every edge of every
 *     layer;
 *   - a theme that draws edges must say so, and a "tint" fill must carry the
 *     colour it tints with — a half-specified style would reach the plugin.
 */
import { describe, expect, it } from "vitest";
import { SCENE_THEMES } from "../../../src/features/sceneTheme/sceneThemeStore";
import { sceneThemePolicy } from "../../../src/scene/sceneThemePolicy";

describe("sceneThemePolicy", () => {
  it("has an entry for every theme", () => {
    for (const theme of SCENE_THEMES) {
      expect(sceneThemePolicy(theme)).toBeTruthy();
    }
  });

  it("makes photoreal's environment a no-op: no override, nothing switched off", () => {
    const policy = sceneThemePolicy("photoreal");

    expect(policy.meshStyle.fill).toBe("vertex");
    expect(policy.basemapOverride).toBeNull();
    expect(policy.googleTilesOff).toBe(false);

    const env = policy.environment;
    expect(env.skyVisible).toBeNull();
    expect(env.starsBoost).toBeNull();
    expect(env.skyBoxColors).toBeNull();
    expect(env.glowGlobe).toBeNull();
    expect(env.fogLights).toBeNull();
    expect(env.bloom).toBeNull();
    expect(env.globeWireframe).toBeNull();
    expect(env.globeColor).toBeNull();
    expect(env.toneMappingMode).toBeNull();
    expect(env.exposure).toBeNull();
    expect(env.sunIntensity).toBeNull();
    expect(env.skyLightProbeIntensity).toBeNull();
    expect(env.lensFlareOff).toBe(false);
  });

  it("outlines photoreal's buildings in a dark, non-HDR ink over their own colours", () => {
    // Issue #13: a lit block with no edge line still reads as a paper cut-out
    // where two faces meet at the same brightness. The outline is the
    // plugin's structural-edge extraction (the same lines cartoon draws),
    // in an ink dark enough to read as a crease and never as a glow.
    const style = sceneThemePolicy("photoreal").meshStyle;
    expect(style.fill).toBe("vertex");
    expect(style.tintRGB).toBeUndefined();
    const edges = style.edges!;
    expect(edges).not.toBeNull();
    expect(edges.hdr).toBeUndefined();
    const [r, g, b] = [
      (edges.color >> 16) & 0xff,
      (edges.color >> 8) & 0xff,
      edges.color & 0xff,
    ];
    for (const channel of [r, g, b]) {
      // Dark, but not pure black: a hairline of 0 reads as an artefact.
      expect(channel).toBeGreaterThan(0);
      expect(channel).toBeLessThan(0x60);
    }
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

  it("gives every theme a complete mesh style", () => {
    expect(SCENE_THEMES).toHaveLength(4);

    for (const theme of SCENE_THEMES) {
      const style = sceneThemePolicy(theme).meshStyle;
      // Every look draws edges: the three stylised ones because the line IS
      // the look, photoreal because a block without one reads flat (#13).
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
    // Cartoon wants a pastel sheet under flat-coloured buildings; cyber wants
    // CARTO's dark sheet, so the night city has STREETS under it rather than a
    // black void; wireframe wants nothing at all under its drawing.
    expect(sceneThemePolicy("cartoon").basemapOverride).toBe("carto-positron");
    expect(sceneThemePolicy("cyber").basemapOverride).toBe("carto-dark");
    expect(sceneThemePolicy("wireframe").basemapOverride).toBe("none");
  });

  it("never touches the globe's own setters, in ANY theme", () => {
    // Writing `view.globe.wireframe`/`view.globe.color` (live setters no code
    // path had ever exercised) kills the frame on 0.0.5 — recorded as upstream
    // bug (i). `wireframe` was RETESTED in the browser on 2026-08-06 against
    // the current code, both in the wireframe theme's entry path and as a bare
    // `globe.wireframe = true` with nothing else changed: presentation freezes
    // on the spot, writing `false` back does not recover it, and only a reload
    // does. The ban stands on evidence, and this test is its guard.
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

  it("keeps wireframe a DRAWING, not a void", () => {
    // The first pass shipped 1 / 0.05 / [0.02,0.02,0.03] and the look was a
    // set of hairlines on black: no ground, no relief, and occluding faces
    // that read as holes rather than as panels. These are the floors the
    // browser pass settled on, pinned as inequalities rather than as the exact
    // values (which stay tunable).
    const wireframe = sceneThemePolicy("wireframe");
    const env = wireframe.environment;
    expect(env.exposure!).toBeGreaterThan(1);
    expect(env.sunIntensity!).toBeGreaterThan(0.05);

    // The fill must be a visible dark panel, not zero.
    const tint = wireframe.meshStyle.tintRGB!;
    for (const channel of tint) expect(channel).toBeGreaterThan(0.02);

    // And the edges must stay clearly HDR against that brighter fill, or
    // raising the exposure alone would wash the drawing out.
    const hdr = wireframe.meshStyle.edges!.hdr!;
    for (const channel of hdr) expect(channel).toBeGreaterThan(1);
    expect(Math.max(...hdr)).toBeGreaterThan(3 * Math.max(...tint));
  });

  it("gives cyber the Fresnel halo and the star boost, and nobody else", () => {
    const cyber = sceneThemePolicy("cyber").environment;
    expect(cyber.glowGlobe).not.toBeNull();
    expect(cyber.starsBoost).not.toBeNull();
    expect(sceneThemePolicy("cartoon").environment.glowGlobe).toBeNull();
    expect(sceneThemePolicy("wireframe").environment.glowGlobe).toBeNull();
  });

  it("gives the two coloured-backdrop themes a flat sky box, and wireframe none", () => {
    expect(sceneThemePolicy("cartoon").environment.skyBoxColors).not.toBeNull();
    // Cyber's box is what makes its night deep BLUE instead of the clear
    // colour's black; wireframe's drawing wants the black.
    expect(sceneThemePolicy("cyber").environment.skyBoxColors).not.toBeNull();
    expect(sceneThemePolicy("wireframe").environment.skyBoxColors).toBeNull();
  });

  it("keeps cyber's sky blue and its buildings a NEAR-BLACK silhouette", () => {
    // The look is synthwave: the glowing wire carries the picture and the
    // surfaces recede almost to nothing. Both halves are pinned by CHANNEL
    // DOMINANCE rather than by exact values, which are browser-tuning
    // outcomes — blue must lead in each.
    const env = sceneThemePolicy("cyber").environment;
    const sky = env.skyBoxColors!;
    for (const hex of [sky.dayColor, sky.nightColor, sky.sunColor]) {
      const [r, g, b] = [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
    }

    const tint = sceneThemePolicy("cyber").meshStyle.tintRGB!;
    expect(tint[2]).toBeGreaterThan(tint[0]);
    expect(tint[2]).toBeGreaterThan(tint[1]);
    // Dark enough to read as a silhouette against the basemap...
    expect(tint[2]).toBeLessThan(0.15);
    // ...but strictly off zero on EVERY channel, so a building in front of
    // another is still a visible occluder rather than a hole in the frame.
    for (const channel of tint) expect(channel).toBeGreaterThan(0);
  });

  it("gives cyber HOT MAGENTA edges against the cyan globe rim", () => {
    // The reference's tension is magenta-vs-cyan: the lines carry the pink and
    // the Fresnel halo keeps the cyan. Pinned as dominance, not as numbers.
    const cyber = sceneThemePolicy("cyber");
    const hdr = cyber.meshStyle.edges!.hdr!;
    expect(hdr[0]).toBeGreaterThan(hdr[1]);
    expect(hdr[2]).toBeGreaterThan(hdr[1]);
    // Genuinely HDR — the whole reason the line glows rather than being bright.
    expect(hdr[0]).toBeGreaterThan(1);

    const fallback = cyber.meshStyle.edges!.color;
    const [r, g, b] = [
      (fallback >> 16) & 0xff,
      (fallback >> 8) & 0xff,
      fallback & 0xff,
    ];
    expect(r).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(g);

    const glow = cyber.environment.glowGlobe!.glowColor;
    expect((glow & 0xff) > ((glow >> 16) & 0xff)).toBe(true);
  });

  it("gives cyber volumetric fog lights, and nobody else", () => {
    // The DIFFUSION half of the look. Everything about it has to be usable by
    // the viewport without a second guess: a positive count, at least one
    // colour to cycle, and an ordered, non-negative intensity range.
    const fog = sceneThemePolicy("cyber").environment.fogLights!;
    expect(fog).not.toBeNull();
    expect(fog.count).toBeGreaterThan(0);
    expect(Number.isInteger(fog.count)).toBe(true);
    expect(fog.colors.length).toBeGreaterThan(0);
    const [lo, hi] = fog.intensityRange;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThanOrEqual(lo);
    expect(fog.radius).toBeGreaterThan(0);
    expect(fog.fogDensity).toBeGreaterThan(0);
    expect(fog.heightM).toBeGreaterThan(0);

    for (const theme of ["photoreal", "cartoon", "wireframe"] as const) {
      expect(sceneThemePolicy(theme).environment.fogLights).toBeNull();
    }
  });

  it("gives cyber a bloom block, and nobody else", () => {
    // The GLOW half of the synthwave look, and the only reason the fills can
    // sit at a near-silhouette: the wire has to carry the picture on its own.
    const bloom = sceneThemePolicy("cyber").environment.bloom!;
    expect(bloom).not.toBeNull();
    expect(bloom.intensity).toBeGreaterThan(0);
    expect(bloom.radius).toBeGreaterThan(0);
    expect(bloom.luminanceSmoothing).toBeGreaterThanOrEqual(0);
    // The threshold is what SELECTS the glow, so it has to sit above the fills
    // and below the edges — pinned as that relationship, not as a number,
    // since the number itself is a browser-tuning outcome.
    const style = sceneThemePolicy("cyber").meshStyle;
    expect(bloom.luminanceThreshold).toBeGreaterThan(
      Math.max(...style.tintRGB!),
    );
    expect(bloom.luminanceThreshold).toBeLessThan(
      Math.max(...style.edges!.hdr!),
    );

    // Photoreal and cartoon have no HDR lines to pick out at all, and the
    // hidden-line drawing wants its edges CRISP — a halo softens exactly the
    // two things that theme is made of.
    for (const theme of ["photoreal", "cartoon", "wireframe"] as const) {
      expect(sceneThemePolicy(theme).environment.bloom).toBeNull();
    }
  });

  it("switches the lens flare off in every themed look", () => {
    for (const theme of ["cartoon", "cyber", "wireframe"] as const) {
      const env = sceneThemePolicy(theme).environment;
      expect(env.lensFlareOff).toBe(true);
      // Every themed look replaces the physical sky with its own backdrop.
      expect(env.skyVisible).toBe(false);
    }
  });

  it("gives NO theme a way to suppress the clouds", () => {
    // All three themed looks used to carry `cloudsOff: true`, so changing the
    // look silently threw away weather the user had switched on. The lever is
    // gone, not merely set to false: the clouds have exactly one owner, the
    // user's toggle.
    for (const theme of SCENE_THEMES) {
      expect(sceneThemePolicy(theme).environment).not.toHaveProperty(
        "cloudsOff",
      );
    }
  });

  it("keeps every exposure it names positive and finite", () => {
    for (const theme of SCENE_THEMES) {
      const { exposure, sunIntensity, skyLightProbeIntensity } =
        sceneThemePolicy(theme).environment;
      for (const value of [exposure, sunIntensity, skyLightProbeIntensity]) {
        if (value === null) continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      if (exposure !== null) expect(exposure).toBeGreaterThan(0);
    }
  });
});
