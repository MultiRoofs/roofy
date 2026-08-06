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
  /** VOLUMETRIC DIFFUSION: neon point lights bleeding into the air above the
   *  city, through the engine's `fogLight` post effect.
   *
   *  The one theme lever that depends on the DATA rather than only on the
   *  scene: the lights are scattered over the bounds of what is loaded, so
   *  with nothing loaded there is nothing to light and the effect stays
   *  hidden. `null` means the theme wants no fog lights at all.
   *
   *  `colors` is cycled by light index and `intensityRange` interpolated the
   *  same way, both DETERMINISTICALLY (see the viewport's layout function):
   *  a per-render `Math.random` would make the neon crawl about the city on
   *  every unrelated re-render. */
  readonly fogLights: {
    readonly count: number;
    /** Cycled by index — magenta/cyan, so the air carries the same tension as
     *  the edges and the globe rim. */
    readonly colors: readonly number[];
    readonly intensityRange: readonly [number, number];
    /** World-space influence radius, metres. */
    readonly radius: number;
    /** The pass's own fog density (the engine's default is 5). */
    readonly fogDensity: number;
    /** Metres above the BASE of what is loaded, so the lights hang among the
     *  roofs. Anchored to the low edge rather than the high one on purpose: a
     *  single church tower would otherwise lift every light a hundred metres
     *  into the sky, where they read as floating lanterns instead of as a
     *  city's glow. */
    readonly heightM: number;
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
  /** Suppress the lens flare whatever the user's atmosphere setting says.
   *  Composed with it, never written to it.
   *
   *  There is deliberately NO `cloudsOff` beside it. A theme used to kill the
   *  clouds (all three did), which meant switching look silently threw away
   *  weather the user had turned on and only the flare came back. The clouds
   *  follow the user's toggle in EVERY theme now; they composite through the
   *  aerial-perspective pass, so a theme's exposure and albedo restyle them
   *  the way they restyle everything else — stylised, on purpose. */
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
  fogLights: null,
  globeWireframe: null,
  globeColor: null,
  toneMappingMode: null,
  exposure: null,
  apAlbedoScale: null,
  skyLightProbeIntensity: null,
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

/**
 * Neon-noir, not Tron: HOT MAGENTA lines over a deep blue-violet fill.
 *
 * The reference look is night PHOTOGRAPHY — pink neon signage against a blue
 * ambient, with the cyan left to the globe's Fresnel rim so the frame carries
 * a magenta/cyan tension instead of a single hue. The fill is deliberately
 * blue-VIOLET and well off zero: a near-black tint made every building read as
 * a hole cut in the sky, which is the "black void" this restyle exists to end.
 *
 * `hdr` is LINEAR and unclamped: > 1 is a genuine HDR value under the AgX
 * pipeline, which is what makes the line glow rather than merely being bright.
 * `color` is the sRGB fallback for the same hue.
 */
const CYBER_STYLE: ThemeStyle = Object.freeze({
  fill: "tint",
  tintRGB: Object.freeze([0.06, 0.08, 0.32]) as readonly [
    number,
    number,
    number,
  ],
  edges: Object.freeze({
    color: 0xff3fb0,
    hdr: Object.freeze([3.0, 0.45, 2.0]) as readonly [number, number, number],
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
      lensFlareOff: true,
    }),
  }),

  // NEON-NOIR. A deep blue NIGHT, not a black void: CARTO Dark Matter keeps the
  // streets legible under the city, a night-blue sky box replaces the physical
  // sky, magenta neon rides the building edges and the cyan stays on the
  // globe's Fresnel rim. Darkness comes from EXPOSURE and albedo, never from
  // touching `atmosphere.date`, which is solar time and belongs to the analysis.
  cyber: Object.freeze({
    meshStyle: CYBER_STYLE,
    // Streets, canals and blocks under the neon — the single biggest reason
    // the old "none" read as a void. Same provider family as cartoon's sheet.
    basemapOverride: "carto-dark",
    googleTilesOff: true,
    environment: Object.freeze({
      ...NO_ENVIRONMENT,
      skyVisible: false,
      // KEPT alongside the sky box below, and that is a browser finding rather
      // than an assumption: the box is a full-screen triangle drawn with
      // `transparent: true` at alpha 0.3, so it TINTS the backdrop instead of
      // occluding it and the stars still read through the blue.
      starsBoost: Object.freeze({ pointSize: 2.5, intensity: 30 }),
      // A deep night-blue box rather than the black clear colour: the "never a
      // black void" half of the look lives here, and the horizon reads as air
      // rather than as the edge of the render.
      skyBoxColors: Object.freeze({
        dayColor: 0x142a66,
        nightColor: 0x080f2b,
        sunColor: 0x3350aa,
      }),
      glowGlobe: Object.freeze({ glowColor: 0x00e5ff, opacity: 0.55 }),
      // The DIFFUSION half of the look: light bleeding into the air, which is
      // what separates neon-noir photography from a flat neon drawing.
      fogLights: Object.freeze({
        count: 16,
        colors: Object.freeze([
          0xff2d9e, 0x00e5ff, 0xff2d9e, 0xff2d9e,
        ]) as readonly number[],
        intensityRange: Object.freeze([0.12, 0.28]) as readonly [
          number,
          number,
        ],
        radius: 150,
        fogDensity: 5,
        heightM: 25,
      }),
      globeWireframe: false,
      // NO globeColor: writing `view.globe.color` (a live setter no code path
      // had ever exercised on 0.0.5) blacked out the whole frame's irradiance
      // term — the globe's g-buffer normals go bad and NaN-poison the shared
      // buffer, the same failure Known Issue (e) documents for a missing
      // terrain layer. Darkness comes from exposure/albedo instead.
      globeColor: null,
      toneMappingMode: "AGX",
      // BRIGHT night, not void: the old 3 / 0.15 / 0.05 triple crushed the
      // basemap and the fills into black and left only the edge lines. These
      // three are the ambient-light budget of the look and were tuned together
      // by screenshot.
      exposure: 4.5,
      apAlbedoScale: 0.6,
      skyLightProbeIntensity: 0.15,
      lensFlareOff: true,
    }),
  }),

  // Hidden-line. Everything that is not an edge goes: no imagery, no sky, no
  // flare. The clouds are the one exception, and a deliberate one — they are
  // the user's weather, not the theme's (see `lensFlareOff`).
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
