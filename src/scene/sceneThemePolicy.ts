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
 *   1. **Photoreal's environment is a provable no-op.** Every override is
 *      `null` and every "off" flag `false`, so the viewport's theme effects
 *      push nothing at all and the default rendering is reached by not being
 *      touched, rather than by being restored to a value this file happens to
 *      remember. Its MESH style is not empty, though: every theme draws the
 *      plugin's structural edges, photoreal in a dark ink (issue #13 — a lit
 *      block whose faces meet at one brightness reads as a paper cut-out).
 *   2. **One frozen `meshStyle` object per theme.** `handleSync` compares the
 *      style by IDENTITY before pushing it, and pushing it re-extracts every
 *      structural edge of every layer; a table free to hand out a fresh (but
 *      equal) object would pay that cost on every unrelated store change.
 *
 * Every number below is a STARTING VALUE, deliberately: exposure, sun
 * intensity and probe intensity interact through the physical atmosphere in
 * ways only a screenshot settles, so this file ships the levers and the
 * commander's browser pass ships the values.
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
  /** BLOOM: a full-screen threshold glow, so the theme's HDR edge lines bleed
   *  into the air around them instead of stopping at the line.
   *
   *  `null` means "do not touch" like every other field here — and, unlike the
   *  handles the rest of this block drives, the pass does not exist until a
   *  theme asks for one (`bloomEffect.ts` registers a custom descriptor at
   *  first need), so a `null` costs nothing at all.
   *
   *  TUNING, for the browser pass: `luminanceThreshold` is what the glow
   *  SELECTS — it is compared against pre-tone-mapping radiance, so if nothing
   *  glows, lower it (try 0.5, then 0.2); if the whole city glows, raise it.
   *  `intensity` scales the halo, `radius` spreads it, and
   *  `luminanceSmoothing` is the soft knee that keeps the selection from
   *  looking cut out. */
  readonly bloom: {
    readonly intensity: number;
    readonly luminanceThreshold: number;
    readonly luminanceSmoothing: number;
    readonly radius: number;
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
  /** The sun light's `intensity` (the engine's `SunLightDesc`, direction and
   *  colour from the atmosphere): the key-light half of how bright every lit
   *  surface — city, terrain, basemap — comes out. Below 1 darkens everything
   *  the sun reaches, which is how the two night themes get dark without going
   *  anywhere near the solar clock; its shadows scale with it. */
  readonly sunIntensity: number | null;
  /** The sky light probe's intensity — the ambient half of the same. */
  readonly skyLightProbeIntensity: number | null;
  /** Suppress the lens flare whatever the user's atmosphere setting says.
   *  Composed with it, never written to it.
   *
   *  There is deliberately NO `cloudsOff` beside it. A theme used to kill the
   *  clouds (all three did), which meant switching look silently threw away
   *  weather the user had turned on and only the flare came back. The clouds
   *  follow the user's toggle in EVERY theme now; they composite through the
   *  aerial-perspective pass, so a theme's exposure and sun restyle them the
   *  way they restyle everything else — stylised, on purpose. */
  readonly lensFlareOff: boolean;
}

/** One theme's bloom block, named so the engine seam can take it without
 *  importing the whole environment type. */
export type ThemeBloom = NonNullable<ThemeEnvironment["bloom"]>;

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
  bloom: null,
  globeWireframe: null,
  globeColor: null,
  toneMappingMode: null,
  exposure: null,
  sunIntensity: null,
  skyLightProbeIntensity: null,
  lensFlareOff: false,
};

/**
 * Photoreal's mesh style: the palette's own colours, scaled to an albedo,
 * and NO outline. Issue #13 first asked for "more distinctive outlines" and
 * an unlit dark ink line was drawn here; once the faces were actually lit
 * (the albedo below, the shadow tuning) the maintainer dropped it (2026-09-08):
 * a hairline drawn unlit at the scene's exposure glows white at night and
 * reads as a wire over a photograph by day, and lit faces that meet at
 * different brightnesses no longer need a line to say where they end.
 * Cartoon, wireframe and cyber keep theirs — there the line IS the look.
 *
 * `fill: "tint"` with a NEUTRAL grey is not a colour cast: `material.color`
 * multiplies the vertex colours before the lighting equation, so this is the
 * surfaces' albedo. The palette (`cityColors.ts`) is a set of DISPLAY colours
 * — a wall of #d9dcd4 is 0.85 linear, near white — and handed to the lit
 * material as-is at the scene's exposure it left a sunlit wall at the same
 * value as the sunlit ground and clipped every roof, so the sun's orientation
 * term (six times more light on a west wall than on a south one at the Delft
 * sample's sun) survived as a difference of a few counts; the buildings read
 * as flat pale slabs with blue edges (issue #13, second report). Browser
 * measurements at the fixed 200 m camera, sunlit west wall / south wall /
 * sky-lit east wall / roof red channel: tint 1.0 gave 185/138/117/251(clip),
 * 0.7 gave 170/121/101/242, 0.5 gave 155/107/86/231, 0.4 gave 145/97/77/223
 * against a sunlit ground of about 226. Half: the sunlit wall sits clearly
 * below the ground, the roof keeps twenty counts of headroom, the shaded side
 * still reads. Not the exposure: that would drag the globe, which the engine
 * calibrated for its own imagery, down with the buildings.
 *
 * Spelled out rather than built from `DEFAULT_THEME_STYLE`, because importing
 * that constant would drag `@cityjson/navara-cityjson`'s RUNTIME module — and
 * therefore `three` — into a file whose whole point is being engine-free.
 */
const PHOTOREAL_ALBEDO = 0.5;

const PHOTOREAL_STYLE: ThemeStyle = Object.freeze({
  fill: "tint",
  tintRGB: Object.freeze([
    PHOTOREAL_ALBEDO,
    PHOTOREAL_ALBEDO,
    PHOTOREAL_ALBEDO,
  ]) as readonly [number, number, number],
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
 * SYNTHWAVE: hot magenta wire over a city that is nearly a silhouette.
 *
 * The reference look is a neon grid at night — the LINE carries the picture and
 * the building surfaces are all but black, so the drawing reads as glowing wire
 * rather than as lit blocks with an outline.
 *
 * The fill was once deliberately raised ([0.06, 0.08, 0.32], a deep
 * blue-violet) because a near-black tint made every building read as a hole cut
 * in the sky. That balance has changed and the fill comes back down: the
 * backdrop is no longer black to be a hole IN — CARTO Dark Matter draws the
 * streets under the city and the night-blue sky box tints the horizon — and the
 * edges now bloom (see the environment's `bloom` block), so a building is read
 * by its glowing wire against the basemap rather than by its face. A whisper of
 * blue-violet is kept rather than pure zero: the faces must still OCCLUDE
 * visibly, so that a building in front of another is a silhouette and not a gap.
 *
 * `hdr` is LINEAR and unclamped: > 1 is a genuine HDR value under the AgX
 * pipeline, which is what makes the line glow rather than merely being bright —
 * and it is also what the bloom pass THRESHOLDS on, so these components are the
 * reason the halo picks the edges and not the fills. `color` is the sRGB
 * fallback for the same hue.
 */
const CYBER_STYLE: ThemeStyle = Object.freeze({
  fill: "tint",
  tintRGB: Object.freeze([0.015, 0.02, 0.06]) as readonly [
    number,
    number,
    number,
  ],
  edges: Object.freeze({
    color: 0xff3fb0,
    hdr: Object.freeze([4.5, 0.7, 3.2]) as readonly [number, number, number],
  }),
});

/**
 * Architectural hidden-line: fills dark enough to read as unlit but still
 * OCCLUDING (which is the whole difference between a hidden-line drawing and a
 * see-through wireframe), lines bright enough to carry the drawing.
 *
 * The fill is a dark blue-grey PANEL, not a hole. At [0.02, 0.02, 0.03] under
 * exposure 1 the faces reached the frame at essentially zero, so a building
 * that hid another read as a gap in the drawing rather than as a solid in
 * front of it; the whole point of hidden-line over see-through wireframe is
 * that the occluder is visible AS an occluder.
 */
const WIREFRAME_STYLE: ThemeStyle = Object.freeze({
  fill: "tint",
  tintRGB: Object.freeze([0.04, 0.05, 0.08]) as readonly [
    number,
    number,
    number,
  ],
  edges: Object.freeze({
    color: 0xe8fff0,
    // HDR and unclamped, like cyber's: > 1 is what makes the line carry at mid
    // zoom instead of dissolving into the fill it is drawn against.
    hdr: Object.freeze([1.6, 3.2, 2.0]) as readonly [number, number, number],
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
      sunIntensity: 1.5,
      skyLightProbeIntensity: 1.4,
      lensFlareOff: true,
    }),
  }),

  // NEON-NOIR. A deep blue NIGHT, not a black void: CARTO Dark Matter keeps the
  // streets legible under the city, a night-blue sky box replaces the physical
  // sky, magenta neon rides the building edges and the cyan stays on the
  // globe's Fresnel rim. Darkness comes from EXPOSURE and the sun's intensity,
  // never from touching `atmosphere.date`, which is solar time and belongs to
  // the analysis.
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
      //
      // Navara 0.1.1 rewrote the fog-light pass: `radius` is now the light's
      // TRUE volumetric extent (`min(radius, hMax)`, honoured by the tile
      // culling too) and a `haloFalloff` attenuation exists (engine default
      // 0.1, not set here). A/B'd against 0.0.5 on the Delft sample on
      // 2026-09-05: the look is unchanged, so the values stay. A model a few
      // tens of metres across washes out pink under these sixteen lights on
      // BOTH versions — that is the light placement, not the engine bump.
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
      // The GLOW half of the look, and the reason the fill could come down to
      // a near-silhouette. The threshold is compared against PRE-tone-mapping
      // luminance, and what reaches it depends on the lighting calibration:
      // under the earlier deferred pass the wire was re-lit and attenuated
      // like everything else and arrived "well under 1.0" (0.3 was bisected
      // for that, 2026-08-10); under the forward-lit calibration (issue #13)
      // the edge lines are unlit and arrive at their true HDR value — the
      // magenta wire's luminance is ~1.7 — and 0.3 selected the whole frame,
      // flooding it pink (browser A/B against the previous calibration,
      // 2026-09-06; with the bloom off the two matched). 1.0 sits under the
      // wire and above the fills, the fog blobs and the carto-dark ground —
      // and the INTENSITY comes down with it by about the same order, because
      // the wire now carries ~10x the energy into the blur and a dense wire
      // network blurred at this radius sums into a flood at the old value
      // (browser-seen at 2 and 3; 0.25 restores the baseline's halo).
      // The halo is what makes the wire read as neon rather than as a bright
      // hairline; diffuse on purpose (mipmap blur at a wide radius).
      bloom: Object.freeze({
        intensity: 0.25,
        luminanceThreshold: 1,
        luminanceSmoothing: 0.3,
        radius: 0.9,
      }),
      globeWireframe: false,
      // NO globeColor: writing `view.globe.color` (a live setter no code path
      // had ever exercised on 0.0.5) blacked out the whole frame's irradiance
      // term — the globe's g-buffer normals go bad and NaN-poison the shared
      // buffer, the same failure Known Issue (e) documents for a missing
      // terrain layer. Darkness comes from exposure and the sun instead.
      globeColor: null,
      toneMappingMode: "AGX",
      // BRIGHT night, not void: the old 3 / 0.15 / 0.05 triple crushed the
      // basemap and the fills into black and left only the edge lines. These
      // three are the ambient-light budget of the look and were tuned together
      // by screenshot.
      exposure: 4.5,
      // Half a sun, alongside the near-black fill (carried over from the
      // earlier albedo scale of the same value): the sun is what LIFTS the
      // basemap and the fills, so leaving it at 1 would hand back a good part
      // of the darkness the tint just bought. Exposure stays at 4.5 — the
      // basemap, the sky box and the fog lights are all budgeted against it.
      sunIntensity: 0.5,
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
      // Still NOT `globeWireframe: true`, and now on evidence rather than on
      // suspicion: the flag was RETESTED on 2026-08-06 against the current code
      // (both the frame-killers it was originally convicted alongside are
      // fixed), in isolation, and it still freezes frame presentation for the
      // rest of the session — see Known Issue (i). The globe cannot be part of
      // this drawing on 0.0.5; the hidden-line look lives on the city meshes.
      globeWireframe: false,
      globeColor: null,
      // NO bloom, deliberately, even though this theme's edges are HDR too
      // ([1.6, 3.2, 2.0]) and would glow. A hidden-line elevation is a
      // DRAWING: its lines have to stay crisp and the near-black fills have to
      // read as occluding panels, and a halo softens exactly those two. The
      // glow belongs to the neon look, not to the drawing.
      toneMappingMode: "LINEAR",
      // BRIGHTER than the first pass's 1 / 0.05 / 0. That triple was a drawing
      // on black: the fills, the terrain and the ground all reached the frame
      // at zero, so a hidden-line elevation had nothing to sit on and the edges
      // were the only lit thing on screen. These three are the look's whole
      // light budget and were tuned together by screenshot, exactly like
      // cyber's.
      exposure: 2.2,
      sunIntensity: 0.2,
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
