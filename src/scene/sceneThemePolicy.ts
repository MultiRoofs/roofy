/**
 * What a scene theme MEANS, as a table.
 *
 * The twin of `viewModePolicy.ts`, and pure and ENGINE-FREE for the same
 * reason: the viewport applies the table, the UI reads it to say what a theme
 * overrode, and the tests are the specification. One table, so a theme cannot
 * mean one thing to the city meshes and another to the sky.
 *
 * NO `three` and NO `@navaramap/*` here, not even transitively — `ThemeStyle`
 * arrives as a TYPE-ONLY import (`@cityjson/navara-cityjson`'s runtime module
 * pulls in `three` for the edge geometry it builds), which is what keeps this
 * module importable under plain Node.
 *
 * Two invariants the tests pin, both load-bearing:
 *
 *   1. **Photoreal is a provable no-op.** Every override is `null` and every
 *      "off" flag `false`, so the viewport's theme effects push nothing at all
 *      and the default rendering is reached by not being touched, rather than
 *      by being restored to a value this file happens to remember.
 *   2. **One frozen `meshStyle` object per theme.** `handleSync` compares the
 *      style by IDENTITY before pushing it, and pushing it re-extracts every
 *      structural edge of every layer; a table free to hand out a fresh (but
 *      equal) object would pay that cost on every unrelated store change.
 *
 * Every number below is a STARTING VALUE, deliberately: exposure, albedo scale
 * and probe intensity interact through the physical atmosphere in ways only a
 * screenshot settles, so this file ships the levers and the commander's browser
 * pass ships the values.
 */
import type { ThemeStyle } from "@cityjson/navara-cityjson";
import type { BasemapId } from "./basemaps";
import type { SceneTheme } from "../features/sceneTheme/sceneThemeStore";

/**
 * The environment half of a theme: everything outside the city meshes.
 *
 * Every field is nullable-or-false and `null`/`false` means DO NOT TOUCH, so a
 * theme states only what it changes and photoreal states nothing.
 */
export interface ThemeEnvironment {
  /** The physical `SkyMesh`. `false` hands the backdrop to the theme's own
   *  sky box (cartoon) or to the clear colour (cyber/wireframe). */
  readonly skyVisible: boolean | null;
  /** Star field size/brightness, for a theme that wants a night sky it can
   *  actually see. */
  readonly starsBoost: {
    readonly pointSize: number;
    readonly intensity: number;
  } | null;
  /** A flat-colour sky box, added on first use and toggled thereafter. Not
   *  part of the default photoreal scene, which is why it is a mesh the
   *  viewport creates rather than a handle it already holds. */
  readonly skyBoxColors: {
    readonly dayColor: number;
    readonly nightColor: number;
    readonly sunColor: number;
  } | null;
  /** The Fresnel halo around the globe (cyber's neon rim). Same
     add-once-then-toggle treatment as the sky box. */
  readonly glowGlobe: {
    readonly glowColor: number;
    readonly opacity: number;
  } | null;
  /** `view.globe.wireframe` — a live engine setter. */
  readonly globeWireframe: boolean | null;
  /** `view.globe.color`, as 0xRRGGBB. The viewport saves the prior colour once
   *  and puts it back on the way out. */
  readonly globeColor: number | null;
  /** Which tone curve the frame is mapped through. AgX is the photoreal
   *  default; LINEAR is what a flat, un-filmic look needs. */
  readonly toneMappingMode: "AGX" | "LINEAR" | null;
  /** Overrides the user's exposure slider WITHOUT writing it — the effective
   *  value is `policy.exposure ?? renderDebugStore.exposure`. */
  readonly exposure: number | null;
  /** The aerial-perspective pass's `albedoScale`: how much of the scene's own
   *  albedo survives the atmospheric irradiance. Below 1 darkens everything
   *  the atmosphere lights, which is how the two night themes get dark without
   *  going anywhere near the solar clock. */
  readonly apAlbedoScale: number | null;
  /** The sky light probe's intensity — the ambient half of the same. */
  readonly skyLightProbeIntensity: number | null;
  /** Suppress the volumetric clouds whatever the user's advanced-settings
   *  toggle says. Composed with it, never written to it. */
  readonly cloudsOff: boolean;
  /** Suppress the lens flare, likewise. */
  readonly lensFlareOff: boolean;
}

export interface SceneThemePolicy {
  /** Pushed to every static and streaming layer handle
   *  (`CityModelHandle.setThemeStyle` / `FcbStreamLayerHandle.setThemeStyle`).
   *  ONE frozen object per theme — see this module's header. */
  readonly meshStyle: ThemeStyle;
  /** Which basemap the theme demands, or `null` for the user's own choice.
   *  Applied as a DERIVED value (`override ?? userChoice`); `basemapStore` is
   *  never written, so leaving the theme restores the picker's selection
   *  without anything having to remember it. */
  readonly basemapOverride: BasemapId | null;
  /** Whether Google's photorealistic tiles are suppressed. Composed with
   *  `tilesStore.enabled` the same way. */
  readonly googleTilesOff: boolean;
  readonly environment: ThemeEnvironment;
}

/** The environment nobody touches — photoreal's, and the base every themed
 *  entry below spreads over so a new field cannot be silently omitted. */
const NO_ENVIRONMENT: ThemeEnvironment = {
  skyVisible: null,
  starsBoost: null,
  skyBoxColors: null,
  glowGlobe: null,
  globeWireframe: null,
  globeColor: null,
  toneMappingMode: null,
  exposure: null,
  apAlbedoScale: null,
  skyLightProbeIntensity: null,
  cloudsOff: false,
  lensFlareOff: false,
};

/**
 * Photoreal's mesh style, spelled out rather than imported.
 *
 * It is `DEFAULT_THEME_STYLE` by value, but importing that constant would drag
 * `@cityjson/navara-cityjson`'s RUNTIME module — and therefore `three` — into
 * a file whose whole point is being engine-free. Three fields, checked against
 * the plugin's default by the compiler through `ThemeStyle`.
 */
const PHOTOREAL_STYLE: ThemeStyle = Object.freeze({
  fill: "vertex",
  edges: null,
});

/** Near-black ink, read as sRGB. Not pure black: a hairline of pure 0 against
 *  a pastel sheet reads as an artefact rather than as a drawn line. */
const CARTOON_INK = 0x1a1a1a;

const CARTOON_STYLE: ThemeStyle = Object.freeze({
  fill: "vertex",
  edges: Object.freeze({ color: CARTOON_INK }),
});

/** Tron cyan, LINEAR and unclamped: > 1 is a genuine HDR value under the
 *  exposure-10 AgX pipeline, which is what makes the line glow rather than
 *  merely being bright. `color` is the sRGB fallback for the same hue. */
const CYBER_STYLE: ThemeStyle = Object.freeze({
  fill: "tint",
  tintRGB: Object.freeze([0.06, 0.07, 0.12]) as readonly [
    number,
    number,
    number,
  ],
  edges: Object.freeze({
    color: 0x33e0ff,
    hdr: Object.freeze([0.4, 2.2, 2.6]) as readonly [number, number, number],
  }),
});

/** Architectural hidden-line: fills dark enough to read as unlit but still
 *  OCCLUDING (which is the whole difference between a hidden-line drawing and
 *  a see-through wireframe), lines bright enough to carry the drawing. */
const WIREFRAME_STYLE: ThemeStyle = Object.freeze({
  fill: "tint",
  tintRGB: Object.freeze([0.02, 0.02, 0.03]) as readonly [
    number,
    number,
    number,
  ],
  edges: Object.freeze({
    color: 0xe8fff0,
    hdr: Object.freeze([0.9, 2.0, 1.2]) as readonly [number, number, number],
  }),
});

const POLICIES: Record<SceneTheme, SceneThemePolicy> = {
  photoreal: Object.freeze({
    meshStyle: PHOTOREAL_STYLE,
    basemapOverride: null,
    googleTilesOff: false,
    environment: Object.freeze({ ...NO_ENVIRONMENT }),
  }),

  // Flat colours with dark ink. CARTO Positron is the pastel sheet the look is
  // drawn on; the physical sky gives way to a flat two-colour box, and the
  // LINEAR tone curve keeps the fills flat instead of rolling them off.
  cartoon: Object.freeze({
    meshStyle: CARTOON_STYLE,
    basemapOverride: "carto-positron",
    googleTilesOff: true,
    environment: Object.freeze({
      ...NO_ENVIRONMENT,
      skyVisible: false,
      skyBoxColors: Object.freeze({
        dayColor: 0xa9d4f2,
        nightColor: 0x2b3653,
        sunColor: 0xfff1cc,
      }),
      globeWireframe: false,
      toneMappingMode: "LINEAR",
      // LINEAR at the atmosphere's exposure-10 calibration would clip the
      // whole frame; a flat look wants the curve's bottom, not its shoulder.
      exposure: 1.4,
      apAlbedoScale: 1.5,
      skyLightProbeIntensity: 1.4,
      cloudsOff: true,
      lensFlareOff: true,
    }),
  }),

  // Dark neon. Nothing under the city, the night sky turned up, a cyan Fresnel
  // rim on the globe, and the atmosphere's own contribution turned right down
  // — darkness by EXPOSURE and albedo, never by touching `atmosphere.date`,
  // which is solar time and belongs to the analysis.
  cyber: Object.freeze({
    meshStyle: CYBER_STYLE,
    basemapOverride: "none",
    googleTilesOff: true,
    environment: Object.freeze({
      ...NO_ENVIRONMENT,
      skyVisible: false,
      // Against the engine's own default (pointSize 1, intensity 10) this is a
      // real boost, not a reduction — with the physical sky off, the stars ARE
      // the backdrop.
      starsBoost: Object.freeze({ pointSize: 2.5, intensity: 30 }),
      glowGlobe: Object.freeze({ glowColor: 0x00e5ff, opacity: 0.55 }),
      globeWireframe: false,
      // NO globeColor: writing `view.globe.color` (a live setter no code path
      // had ever exercised on 0.0.5) blacked out the whole frame's irradiance
      // term — the globe's g-buffer normals go bad and NaN-poison the shared
      // buffer, the same failure Known Issue (e) documents for a missing
      // terrain layer. Darkness comes from exposure/albedo instead.
      globeColor: null,
      toneMappingMode: "AGX",
      exposure: 3,
      apAlbedoScale: 0.15,
      skyLightProbeIntensity: 0.05,
      cloudsOff: true,
      lensFlareOff: true,
    }),
  }),

  // Hidden-line. Everything that is not an edge goes: no imagery, no sky, no
  // weather, no flare — and the globe itself becomes its own wireframe so the
  // ground reads as a drawing rather than as a surface.
  wireframe: Object.freeze({
    meshStyle: WIREFRAME_STYLE,
    basemapOverride: "none",
    googleTilesOff: true,
    environment: Object.freeze({
      ...NO_ENVIRONMENT,
      skyVisible: false,
      // Not `globeWireframe: true` — see cyber's globeColor note: the globe's
      // untouched-by-anyone live setters corrupt the shared normal buffer on
      // 0.0.5 and black the frame. The hidden-line look survives on the city
      // meshes alone, over an imagery-less globe at low exposure.
      globeWireframe: false,
      globeColor: null,
      toneMappingMode: "LINEAR",
      exposure: 1,
      apAlbedoScale: 0.05,
      skyLightProbeIntensity: 0,
      cloudsOff: true,
      lensFlareOff: true,
    }),
  }),
};

export function sceneThemePolicy(theme: SceneTheme): SceneThemePolicy {
  return POLICIES[theme];
}

/**
 * Whether this theme takes the backdrop choice out of the user's hands — what
 * the basemap and Google-tiles panels say so a picker that has visibly stopped
 * mattering explains itself instead of looking broken.
 */
export function isBasemapOverridden(theme: SceneTheme): boolean {
  return sceneThemePolicy(theme).basemapOverride !== null;
}

export function areGoogleTilesOverridden(theme: SceneTheme): boolean {
  return sceneThemePolicy(theme).googleTilesOff;
}

/** The one sentence both panels show when the theme has taken over. */
export const THEME_OVERRIDE_HINT = "Overridden by the scene theme";
