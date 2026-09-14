import { useDrawStore } from "../features/drawing/drawStore";
import { forwardCloudShadowShader } from "./cloudShadowShader";
import { captureFrame } from "../features/export/captureFrame";
import { copySceneImage } from "../features/export/sceneImage";
import { customBasemapOption } from "../features/basemap/customBasemap";
/**
 * Navara viewport: owns the `ThreeView` lifecycle and exposes the imperative
 * {@link CitySceneHandle} `App.tsx` drives the camera through.
 *
 * Replacement for `CitySceneR3F.tsx` (spec 4.1). No React Three Fiber: Navara
 * is imperative, so the whole engine lives behind refs and focused effects, and
 * React only owns the DOM around it.
 *
 * SCOPE (Tasks B11b + B14 + B15): engine lifecycle, the photorealistic globe,
 * the static layer store -> `CityModelHandle` mirror (`handleSync.ts`)
 * including per-layer rule styling, fit/align against the live handles'
 * geodetic bounds, the triangle readout, the init-failure panel, and the
 * interaction hub — pointer events -> pick intents -> `selectionStore`,
 * selection/hover -> `setHighlight`, and the source-CRS cursor readout.
 *
 * This file is the ENGINE SEAM for interaction, and holds only that: which
 * engine event carries what, and how a screen point becomes an ECEF ray. Every
 * decision it feeds is pure and tested elsewhere — `pickEventHandlers.ts`
 * (nearest-hit routing, tool gating, drag suppression, intents),
 * `handleSync.ts` (the handle registries) and `cursorCrsReadout.ts` (geodetic
 * -> source CRS, throttling).
 *
 * Task C13 turned STREAMING on: the FlatCityBuf plugin joins the session's
 * ordered plugin list (registered before `view.init()`, which is the only
 * moment the engine accepts one), is published through `streamPlugin.ts` and
 * handed out by `getStreamingPlugin()`, and every open stream's handle joins
 * `streamsRef` — the second half of the one interaction registry, so a streamed
 * cell picks, highlights, fits and counts exactly like a static one. Only
 * STYLING branches (`setRules` vs `setStyle`), and every programmatic camera
 * move is bracketed by `suppressSettle` so it cannot masquerade as a gesture.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ThreeView, {
  Color,
  ColorMap,
  geodeticToVector3,
  getPickRay,
  TERRARIUM_ELEVATION_DECODER,
  vector3ToGeodetic,
  type PickedFeature,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Vector2 } from "three";
// The tone-curve enum, from `postprocessing` DIRECTLY rather than through
// `@navaramap/three-default-descs` (which re-exports it): that package imports
// `@navaramap/three` at module scope, and this file is unit-tested under Node
// with the engine mocked (NODE_IMPORT_SAFE = false). `postprocessing` is a
// pinned direct dependency and imports cleanly.
import { ToneMappingMode } from "postprocessing";
// The engine-bound subpaths, NOT the package barrels: the barrels must stay
// importable from Node (Global Constraints -> NODE_IMPORT_SAFE = false).
import { CityJSONPlugin } from "@cityjson/navara-cityjson/plugin";
import { FlatCityBufPlugin } from "@cityjson/navara-flatcitybuf/plugin";
import { geodeticBoundsFromBBox } from "@cityjson/navara-cityjson";
import type { BBox3 } from "@cityjson/navara-core";
import type {
  EcefRay,
  GeodeticBounds,
  ScreenPoint,
} from "@cityjson/navara-cityjson";
import type { QueryRegion } from "@cityjson/navara-flatcitybuf";
import { useLayerStore } from "../features/layers/layerStore";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useSolarStore } from "../features/solar/solarStore";
import { useStreamStore } from "../features/streaming/streamStore";
import { useTilesStore } from "../features/tiles/tilesStore";
import { useGeoLayerStore } from "../features/geoLayers/geoLayerStore";
import {
  filterGeoRecords,
  geoRecordId,
  geoRecords,
} from "../features/geoLayers/geoRecords";
import { useGeoFeatureVisibilityStore } from "../features/geoLayers/geoFeatureVisibilityStore";
import { layerQuery, useQueryStore } from "../features/query/queryStore";
import {
  useBasemapStore,
  type HeatmapSettings,
} from "../features/basemap/basemapStore";
import { useAtmosphereStore } from "../features/atmosphere/atmosphereStore";
import { useRenderDebugStore } from "../features/debug/renderDebugStore";
import { setStreamPlugin } from "../features/streaming/streamPlugin";
import { useQueryRegionStore } from "../features/streaming/queryRegionStore";
import {
  closeAllStreamingLayers,
  closeStreamingLayer,
} from "../features/streaming/openStreamingLayer";
import { CITY_COLORS } from "./cityColors";
import {
  allInteractionHandles,
  interactionHandles,
  syncHighlight,
  syncLayers,
  syncStreamState,
  syncStyles,
  totalTriangles,
  type HighlightMemo,
  type InteractionHandle,
  type LiveLayer,
  type StreamInteractionHandle,
  type StreamSyncMemo,
} from "./handleSync";
import {
  acceptsPointer,
  applyPickIntent,
  canvasPointOf,
  createClickGate,
  geoSelectionFromStash,
  narrowToMode,
  pickIntentFor,
  resolveNearestHit,
  sameSelection,
  type EnginePickStash,
} from "./pickEventHandlers";
import { createThrottle, epsgForLayer } from "./cursorCrsReadout";
import {
  createNavaraSession,
  NavaraSessionDisposedError,
  type NavaraSession,
} from "./navaraSession";
import { advanceTime } from "./timeAnimation";
import { siteEnuFrame, sunPositionFromEcef } from "./sunWriter";
import {
  alignCameraForBounds,
  cameraForBounds,
  unionGeodeticBounds,
  type FlyToTarget,
  type GeographicCameraState,
  type ViewDirection,
} from "./geographicCamera";
import {
  northedCamera,
  zoomedCamera,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "./cameraControls";
import {
  geoLayerIdForEngineLayerId,
  removeAllGeoLayerHandles,
  syncGeoFeatureVisibility,
  syncGeoHighlight,
  syncGeoLayers,
  type LiveGeoLayer,
} from "./geoLayerSync";
import { publishCameraPose } from "./cameraPose";
import { useViewModeStore } from "../features/viewMode/viewModeStore";
import { selectedObjectBounds } from "./selectedObjectBounds";
import {
  entryCameraFor,
  VIEW_MODE_ENTRY_MS,
  viewModePolicy,
} from "./viewModePolicy";
import { googleTilesConfig } from "./googleTiles";
import { useSceneThemeStore } from "../features/sceneTheme/sceneThemeStore";
import { shadowTuningFor } from "./shadowQuality";
import { sceneThemePolicy, type ThemeEnvironment } from "./sceneThemePolicy";
import { bloomEffectConfig, registerBloomEffect } from "./bloomEffect";
import { basemapById, type BasemapOption } from "./basemaps";
import { TERRAIN, TERRAIN_ATTRIBUTION } from "./terrain";
import { isAutoFitSuppressed } from "./autoFitSuppression";
import { addQueryBox, type QueryBoxMesh } from "./streamQueryBox";
import { AttributionOverlay } from "../ui/viewport/AttributionOverlay";
import { ScaleBar } from "../ui/viewport/ScaleBar";
import { StreamQueryBoxOverlay } from "../ui/viewport/StreamQueryBoxOverlay";

/**
 * The engine `Color` factory `geoLayerSync` takes as a seam.
 *
 * `.setHex()` rather than a constructor argument: the engine's `Color`
 * declares NO constructor parameters, and the documented forms are
 * `new Color().setHex(...)` / `.setStyle(...)` — the same class every mesh desc
 * insists on (docs/architecture-notes.md, Known Issue (i): a bare hex makes `addMesh` throw).
 *
 * A module-level BINDING but not a module-level INSTANCE: the six viewport test
 * suites mock `@navaramap/three`, and a `new Color()` evaluated at import time
 * would call `undefined` as a constructor before the mock's factory has linked.
 * One shared identity matters — `geoLayerSync` stores the factory on each live
 * entry so the `featureCreated` subscription can re-apply a highlight on its
 * own, so both call sites below must hand it the SAME function.
 */
const makeEngineColor = (hex: number): unknown => new Color().setHex(hex);

export interface CitySceneHandle {
  projectDrawingPoint?: (
    point: readonly [number, number, number],
  ) => { x: number; y: number } | null;
  pickDrawingPoint?: (
    x: number,
    y: number,
  ) => readonly [number, number, number] | null;
  captureImage: (
    credits: readonly string[],
  ) => Promise<import("../features/export/sceneImage").SceneImage>;
  fitAll: () => void;
  fitLayer: (layerId: string) => void;
  /** Frame exactly the selected source objects and their child parts. */
  fitObjects: (layerId: string, objectIds: readonly string[]) => void;
  /** Fly to frame caller-supplied bounds — the geo-layer fit, whose extents
   *  the app computes itself (`geoLayerBounds.ts`); the engine has no bounds
   *  API for its own geo layers. Same framing and settle suppression as
   *  `fitLayer`. */
  fitBounds: (bounds: GeodeticBounds) => void;
  /** Imperative camera commands for App-owned map controls. */
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
  alignView: (direction: ViewDirection) => void;
  getCameraState: () => GeographicCameraState | null;
  setCameraState: (state: GeographicCameraState) => void;
  /**
   * Fly to a point on the globe — what the address search commands.
   *
   * A POINT and a height only: the ORIENTATION is the active view mode's to
   * decide (a 2D plan view must not be tilted back to an oblique because
   * someone searched for a street), so the caller does not get to name it.
   * Animated (`view.flyTo`), unlike `setCameraState`, precisely because it
   * emits the full `movestart..moveend` chain — the streaming layers commit
   * for the destination and the pose readout follows the flight for free.
   */
  flyTo: (target: FlyToTarget, durationMs?: number) => void;
  /** Resolves once the engine is live (`view.init()` + plugins registered);
   *  REJECTS with the init error if it never came up. App.tsx awaits this
   *  inside try/catch instead of a 100 ms setTimeout — see Task C20. */
  readonly ready: Promise<void>;
  /**
   * The live FlatCityBuf plugin, once the engine is up.
   *
   * A promise rather than the instance, because a `.fcb` open can be requested
   * during the first render — a share hash, a restored workspace — when the
   * plugin does not exist yet. Awaiting {@link ready} first means such a call
   * QUEUES instead of dereferencing a null ref, and an engine that never comes
   * up REJECTS this rather than leaving the caller hanging.
   */
  getStreamingPlugin(): Promise<FlatCityBufPlugin>;
}

export interface NavaraViewportProps {
  readonly onTriangleCount: (count: number) => void;
  readonly onFps?: (fps: number) => void;
  /** WGS84 [longitude, latitude, ellipsoidal height] from the depth hit. */
  readonly onCursorPosition?: (
    pos: readonly [lng: number, lat: number, ellipsoidalHeight: number] | null,
  ) => void;
  readonly onLayerError?: (layerId: string, message: string) => void;
  /** Active licence lines, mirrored in the expanded data drawer. */
  readonly onAttributionChange?: (lines: readonly string[]) => void;
}

type ViewInstance = InstanceType<typeof ThreeView>;

interface ReadyGate {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Serialises engine lifetimes across mounts. BROWSER-VERIFIED requirement, not
 * a precaution: `@navaramap/three` keeps its tile worker pool in a MODULE-LEVEL
 * singleton, so a second `view.init()` that starts before the first view's
 * `dispose()` has run `terminateWorkerPool()` throws "Worker pool has already
 * been initialized." and both views come up dead. React StrictMode's
 * mount/unmount/mount does exactly that.
 *
 * Every mount therefore queues behind this promise: it constructs nothing
 * until the previous view is gone, and a mount cancelled before its turn (the
 * StrictMode first pass) never constructs a view at all — so StrictMode boots
 * the engine exactly once instead of twice.
 *
 * Corollary: at most ONE `NavaraViewport` may be mounted at a time. That is an
 * engine constraint, not a design choice — {@link mountedViewports} enforces
 * it loudly in development.
 */
let engineSlot: Promise<unknown> = Promise.resolve();

/**
 * How many `NavaraViewport`s are mounted right now. StrictMode never pushes
 * this past 1 (its first pass is cleaned up before the second mounts), so
 * anything above 1 is a genuine second instance — which cannot come up until
 * the first unmounts, because of the worker-pool singleton above.
 */
let mountedViewports = 0;

/** How far above the tallest loaded geometry the precipitation volume is
 *  anchored, in metres. Enough clearance that the particles are falling past
 *  the roofs rather than spawning level with them. */
const PRECIPITATION_HEIGHT_M = 150;

/**
 * How often the camera's pose is published to the compass overlay while the
 * camera is moving, in milliseconds.
 *
 * ~10 Hz, the same beat the solar animation publishes on and for the same
 * reason: the engine emits `move` per frame, and a React render per frame for a
 * dial nobody can read that fast is pure cost. `moveend` publishes unthrottled,
 * so the value the compass comes to rest on is exact.
 */
const POSE_PUBLISH_MS = 100;

/**
 * The tilt a searched place is flown to in a mode that does not pin one — the
 * same -60 `cameraForBounds` frames a model at, so arriving somewhere by search
 * looks like arriving there by "Zoom to fit".
 */
const SEARCH_PITCH_DEG = -60;

/** Default flight time for {@link CitySceneHandle.flyTo}. Long enough to read
 *  as a journey across the map rather than a cut. */
const SEARCH_FLIGHT_MS = 1200;

function createReadyGate(): ReadyGate {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nobody may ever await it (the component can unmount first), so make sure a
  // rejection is never reported as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/**
 * A source plus the layer that renders it, as one unit — what both backdrops
 * (the Google tileset and the raster basemap) add and remove together.
 */
interface SourceLayerHandles {
  readonly layer: ReturnType<ViewInstance["addLayer"]>;
  readonly source: ReturnType<ViewInstance["addSource"]>;
}

/** The half of `EffectHandle` the clouds wiring uses. Structural rather than
 *  the engine's generic type, which needs the descriptor class as a parameter
 *  (`EffectHandle<CloudsEffectDesc>`) and would drag `@navaramap/
 *  three-default-descs` into this file's type surface for two methods.
 *
 *  `ref` is the `CloudsEffectDesc` itself, and `ref.raw` the `Clouds` pass —
 *  reached only by {@link disposeCloudsPass}, which explains why. */
interface CloudsHandle {
  update: (updates: unknown) => void;
  delete: () => void;
  readonly ref?: { readonly raw?: { dispose?: () => void } };
}

/**
 * Dispose the clouds PASS, before its handle is deleted.
 *
 * ENGINE-BUG WORKAROUND (`@navaramap/three` 0.0.5). `handle.delete()` alone
 * does NOT take the clouds out of the frame — browser-verified, and the reason
 * why is visible in the bundle:
 *
 *   * clouds do not composite themselves. `Clouds` publishes its output buffer
 *     as `atmosphere.overlay`, and the AERIAL-PERSPECTIVE pass is what samples
 *     it (`AerialPerspective.onOverlayChanged` -> `rawEffect.overlay`, compiled
 *     into the AP shader as `HAS_OVERLAY`).
 *   * `EffectDesc.onDestroy()` only calls `ctx.removePass(...)`, which forwards
 *     to `postprocessing`'s `EffectComposer.removePass` — and that never calls
 *     `pass.dispose()`. Yet `Clouds.dispose()` is exactly what resets
 *     `atmosphere.overlay/shadow/shadowLength` to `null`.
 *
 * So deleting the handle unhooks the clouds pass while leaving the AP pass
 * sampling its last rendered buffer: the clouds FREEZE into the sky instead of
 * disappearing, which is why the Advanced Settings toggle and the coverage
 * slider read as inert. Disposing the pass ourselves first restores both. The
 * symptom that hid it: switching the whole post chain (or just the AP pass) off
 * does remove the clouds, so the bug looks like "the toggle sometimes works".
 *
 * Worth reporting upstream; until then this is the disable path.
 */
function disposeCloudsPass(handle: CloudsHandle): void {
  try {
    handle.ref?.raw?.dispose?.();
  } catch (error) {
    console.error(
      "NavaraViewport: the clouds pass could not be disposed; the clouds may " +
        "stay composited into the sky until the aerial-perspective pass is " +
        "toggled.",
      error,
    );
  }
}

/**
 * What `DefaultPlugin.addDefaultPhotorealScene()` hands back.
 *
 * Captured — it used to be discarded (`void defaultPlugin.addDefault…()`) —
 * because these handles ARE the engine counterparts of the Advanced Settings
 * panel. Without them the panel's aerial-perspective, lens-flare and
 * sun-shadow switches had nothing to drive and were pure state.
 *
 * Structural, and every member optional, for two reasons: the engine's own
 * types would drag `@navaramap/three-default-descs` in for four property
 * reads, and `lensFlare` is genuinely `| undefined` in the engine's signature
 * (0.0.5 omits it on backends that cannot afford the pass). A defensive
 * `?? undefined` shape also means an engine build that stops returning one of
 * these degrades to "that toggle does nothing" instead of a TypeError inside a
 * store subscription.
 */
interface PhotorealScene {
  readonly sky?: VisibilityHandle;
  /** `update` too, since Task M9: a theme with the physical sky switched off
   *  turns the star field up to carry the backdrop. */
  readonly stars?: UpdatableHandle;
  /** Likewise — the probe's intensity is the ambient half of how a dark theme
   *  gets dark WITHOUT going near `atmosphere.date`. */
  readonly skyLightProbe?: UpdatableHandle;
  readonly sun?: UpdatableHandle;
  readonly aerialPerspective?: UpdatableHandle;
  readonly lensFlare?: VisibilityHandle;
  /** `update` carries the tone-curve mode (`{ toneMapping: { mode } }`), which
   *  a flat look swaps from AgX to LINEAR. */
  readonly toneMapping?: UpdatableHandle;
  readonly antialiasing?: VisibilityHandle;
}

/** `BaseHandle`'s `visible` accessor, which every mesh/light/effect handle
 *  inherits (`@navaramap/three` `BaseHandle`). */
interface VisibilityHandle {
  visible: boolean;
}

/** The handles the theme layer CONFIGURES rather than merely shows and hides.
 *  `update` is typed `unknown` for the same reason the rest of this block is
 *  structural: the engine's own update types are generic in their descriptor
 *  class and would drag `@navaramap/three-default-descs` into a file that must
 *  stay importable from Node. */
interface UpdatableHandle extends VisibilityHandle {
  update: (updates: unknown) => void;
}

/**
 * Push one engine mutation, reporting rather than propagating a refusal.
 *
 * The settings panel is a debug surface: a toggle the engine rejects — a
 * handle already deleted, a pass that failed to compile on this GPU — must
 * leave the viewer running, exactly as the clouds/tiles/basemap paths do.
 */
function applyToEngine(what: string, mutate: () => void): void {
  try {
    mutate();
  } catch (error) {
    console.error(`NavaraViewport: ${what} could not be applied.`, error);
  }
}

/**
 * State the lighting calibration: the engine's own FORWARD-LIT default.
 *
 * `addDefaultPhotorealScene()` adds a `SunLightDesc` (direction and colour
 * from the atmosphere, cascaded shadow maps) and a `SkyLightProbeDesc`, and
 * every LIT material — the terrain, the draped basemap, Google's tiles, and
 * the city meshes, which `@cityjson/navara-cityjson` draws with a Lambert
 * material registered for the shadow maps — is shaded by those two in the
 * forward pass. The aerial-perspective pass then only hazes what they
 * produced (`irradiance: false`, its default), and the tone mapper runs at
 * `DEFAULT_EXPOSURE = 10`, the exposure the engine's own samples sit at.
 *
 * The DEFERRED alternative the app ran until issue #13 — `view.lit = false`
 * with the pass in `irradiance` mode, re-lighting the G-buffer albedo from the
 * atmosphere — is deliberately NOT used any more. It is a fine calibration for
 * imagery on terrain, but it cannot show a cast shadow: the irradiance term
 * reads the normal buffer only, and no built-in effect reads the shadow
 * G-buffer the lit pipeline writes, so a building could darken a wall by its
 * normal but never by the tower next to it. Mixing the two calibrations — lit
 * materials AND the irradiance pass, at exposure 10 — is what once clipped
 * the whole scene to white; the pass is therefore never written from here.
 *
 * `lit` is written rather than inherited: the engine defaults to `true`, but
 * this app's calibration should be stated where its exposure and its "no
 * ambient fill" rule are, so a future default flip cannot silently take the
 * shadows with it. Reported rather than propagated, like every other engine
 * push in this file.
 */
function applyForwardLighting(view: Pick<ThreeView, "lit">): void {
  applyToEngine("the forward-lit calibration", () => {
    view.lit = true;
  });
}

// ---------------------------------------------------------------------------
// Scene themes: the environment half
//
// `sceneThemePolicy.ts` says WHAT a theme wants of the sky, the globe and the
// post chain; everything below is the engine seam that pushes it. Two rules
// run through all of it:
//
//   * a theme NEVER writes a user store, and never touches `atmosphere.date`
//     (solar time — see the spec's solar-hygiene note). It darkens a scene with
//     exposure, sun intensity, probe intensity and sky visibility, all of which
//     are presentation;
//   * leaving a theme RESTORES, and restores to the engine's own defaults —
//     which is why the four constants below are values read out of the 0.0.5
//     bundle rather than numbers invented here.
// ---------------------------------------------------------------------------

/** `DEFAULT_STARS_OPTIONS` in `@navaramap/three-default-descs` 0.0.5. Copied
 *  rather than imported: that package pulls `@navaramap/three` in at module
 *  scope, which cannot be loaded under Node. */
const PHOTOREAL_STARS = { pointSize: 1, intensity: 10 } as const;

/** `LightProbe`'s own default in three r183 — `SkyLightProbeDesc` passes the
 *  option straight through and adds no default of its own. */
const PHOTOREAL_SKY_LIGHT_PROBE_INTENSITY = 1;

/** `SunLightOptions.intensity`'s default in `@navaramap/three-default-descs`. */
const PHOTOREAL_SUN_INTENSITY = 1;

/** The sun's cascaded-shadow-map tuning lives in `shadowQuality.ts` (one
 *  row per quality level; the store picks the level) and is written together
 *  with `castShadow` below. */

/** `DEFAULT_TONE_MAPPING_OPTIONS.mode` in the same bundle. */
const PHOTOREAL_TONE_MAPPING_MODE = ToneMappingMode.AGX;

/** The policy's tone-curve names, as the enum the pass actually takes. */
const TONE_MAPPING_MODES: Record<
  NonNullable<ThemeEnvironment["toneMappingMode"]>,
  ToneMappingMode
> = {
  AGX: ToneMappingMode.AGX,
  LINEAR: ToneMappingMode.LINEAR,
};

/** A mesh a theme owns: added on first need, then shown/hidden and updated. */
interface ThemeMesh {
  visible: boolean;
  update: (updates: unknown) => void;
  delete: () => void;
}

/** A post effect a theme owns, on the same add-once-then-toggle contract. */
interface ThemeEffect {
  visible: boolean;
  update: (updates: unknown) => void;
  delete: () => void;
}

/**
 * One neon light in the air, in GEODETIC terms.
 *
 * Deliberately not ECEF: the layout below is pure arithmetic that a Node test
 * can run, and the engine's `geodeticToVector3` is applied at the last moment
 * by the effect that pushes them.
 */
interface ThemeFogLightSite {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly color: number;
  readonly intensity: number;
  readonly radius: number;
}

/**
 * Scatter a theme's fog lights over the bounds of what is loaded — the same
 * set every time, for the same inputs.
 *
 * DETERMINISM is the whole point of the arithmetic here. `Math.random()` per
 * render would make the neon crawl around the city on every unrelated store
 * change, and a "shuffle once and remember" scheme would have to survive the
 * engine being torn down and rebuilt. Instead the position of light `i` is the
 * i-th point of the R2 low-discrepancy sequence (the 2-D generalisation of the
 * golden-ratio sequence): a closed form in `i` alone, and far more evenly
 * spread over the rectangle than a random sample of the same size — which
 * matters at 14 lights, where random clumping is the normal case rather than
 * the exception.
 *
 * Colours cycle through the palette by index and intensity walks a third
 * irrational, so neighbouring lights differ in both without any state.
 */
const R2_ALPHA_X = 0.7548776662466927;
const R2_ALPHA_Y = 0.5698402909980532;
const GOLDEN_FRACTION = 0.6180339887498949;

function themeFogLightSites(
  spec: NonNullable<ThemeEnvironment["fogLights"]>,
  bounds: GeodeticBounds,
): ThemeFogLightSite[] {
  const sites: ThemeFogLightSite[] = [];
  const [lo, hi] = spec.intensityRange;
  const height = bounds.minHeight + spec.heightM;
  for (let i = 0; i < spec.count; i += 1) {
    // `i + 1`, so the first light is not the sequence's degenerate (0.5, 0.5)
    // centre point — which would sit a light exactly on the camera's fit target.
    const u = (0.5 + R2_ALPHA_X * (i + 1)) % 1;
    const v = (0.5 + R2_ALPHA_Y * (i + 1)) % 1;
    const t = (0.5 + GOLDEN_FRACTION * (i + 1)) % 1;
    sites.push({
      lng: bounds.west + u * (bounds.east - bounds.west),
      lat: bounds.south + v * (bounds.north - bounds.south),
      height,
      color: spec.colors[i % spec.colors.length]!,
      intensity: lo + t * (hi - lo),
      radius: spec.radius,
    });
  }
  return sites;
}

/**
 * What the theme layer has to REMEMBER between switches.
 *
 * Two meshes that the default photoreal scene does not create at all (the flat
 * sky box and the Fresnel halo), plus the globe colour as it was before any
 * theme touched it — and one flag saying whether anything has been overridden,
 * which is what makes photoreal a genuine no-op on a viewer that has never
 * left it.
 */
interface ThemeEnvironmentState {
  skyBox: ThemeMesh | null;
  glowGlobe: ThemeMesh | null;
  /** The volumetric `fogLight` pass, and the light set it currently holds.
   *  Added on first need and `visible`-toggled thereafter, exactly like the two
   *  meshes above and for the same reason (Known Issue (f)); `key` is what
   *  keeps an unrelated re-render from re-uploading identical lights. */
  fogLight: ThemeEffect | null;
  fogLightKey: string | null;
  /** The threshold-bloom pass, on the same add-once-then-toggle contract.
   *
   *  `bloomSpec` is the policy block the live pass was built from, compared by
   *  IDENTITY — the table hands out one frozen object per theme, so that is the
   *  whole update gate (the same trick `handleSync` uses for `meshStyle`).
   *  `bloomAvailable` is a tri-state: `null` = the descriptor has not been
   *  registered yet, `false` = registration failed and must not be retried
   *  (once per session, not once per theme switch). */
  bloom: ThemeEffect | null;
  bloomSpec: ThemeEnvironment["bloom"];
  bloomAvailable: boolean | null;
  /** Captured once, immediately before the first override. */
  priorGlobeColor: number | undefined;
  /** True while a non-photoreal environment is in force. */
  applied: boolean;
}

function createThemeEnvironmentState(): ThemeEnvironmentState {
  return {
    skyBox: null,
    glowGlobe: null,
    fogLight: null,
    fogLightKey: null,
    bloom: null,
    bloomSpec: null,
    bloomAvailable: null,
    priorGlobeColor: undefined,
    applied: false,
  };
}

/**
 * Add a theme-owned mesh ONCE, then toggle and update it.
 *
 * Never added and deleted per switch, for the reason docs/architecture-notes.md's Known Issue
 * (f) records for effects and which applies just as well here: a create/destroy
 * cycle per theme change is a cost (and a potential leak) paid every time the
 * user tries the menu, where `visible` is a flag flip.
 *
 * @param desc the engine mesh description, or `null` to hide what exists.
 */
function syncThemeMesh(
  view: ViewInstance,
  state: ThemeEnvironmentState,
  slot: "skyBox" | "glowGlobe",
  desc: object | null,
): void {
  const existing = state[slot];
  if (desc === null) {
    if (existing === null) return;
    applyToEngine(`the theme's ${slot} visibility`, () => {
      existing.visible = false;
    });
    return;
  }
  if (existing === null) {
    try {
      state[slot] = view.addMesh(desc as never) as unknown as ThemeMesh;
    } catch (error) {
      // A backdrop, like the clouds and the basemap: a descriptor this engine
      // build refuses must leave the theme partly applied, not the viewer dead.
      console.error(
        `NavaraViewport: the theme's ${slot} mesh could not be added; the theme renders without it.`,
        error,
      );
    }
    return;
  }
  applyToEngine(`the theme's ${slot}`, () => {
    existing.update(desc);
    existing.visible = true;
  });
}

/**
 * Push the globe's base colour, capturing the engine's own on the way in.
 *
 * Nothing at all happens while no theme has ever asked for a colour — which is
 * what keeps a photoreal session from writing a value it would then have to
 * remember.
 *
 * The colour is built by CLONING the one the globe already holds. The setter
 * calls `toHex()` on whatever it is given (verified in the 0.0.5 bundle:
 * `setColor: (c) => core.setGlobeColor(c.toHex())`), so a bare number is not
 * accepted — and cloning the engine's own instance gets a `Color` without
 * importing the class into a file whose unit tests mock the engine wholesale.
 */
function syncThemeGlobeColor(
  view: ViewInstance,
  wanted: number | null,
  state: ThemeEnvironmentState,
): void {
  if (wanted === null && state.priorGlobeColor === undefined) return;
  applyToEngine("the theme's globe colour", () => {
    const current = view.globe.color;
    // `Color | undefined` — undefined before the WASM core is up, in which case
    // there is nothing to capture and nothing safe to build from.
    if (current === undefined) return;
    if (state.priorGlobeColor === undefined) {
      state.priorGlobeColor = current.toHex();
    }
    view.globe.color = current.clone().setHex(wanted ?? state.priorGlobeColor);
  });
}

/**
 * Add the theme's bloom pass on first need, then toggle and update it.
 *
 * Add-once-then-toggle for the reason Known Issue (f) records: `handle.delete()`
 * takes a pass out of the composer WITHOUT disposing it, so a create/destroy
 * cycle per theme switch both costs and leaks. `visible` is the composer's own
 * enable flag.
 *
 * REGISTRATION happens here too, at first need rather than at init. The
 * descriptor is ours (`bloomEffect.ts`), so the engine has to be taught about
 * it before `addEffect` can find it — and doing that lazily is what keeps a
 * session that never leaves photoreal from touching the engine at all, which is
 * this module's standing invariant. It is safely after `view.init()` because
 * every caller is behind the `engineReady` gate (Known Issue (b): registering
 * before init is what throws).
 *
 * A registration or an add that fails leaves `bloomAvailable === false` and the
 * theme renders without its glow — one warning per session, exactly like the
 * clouds and the fog lights, never a broken viewer.
 */
function syncThemeBloom(
  view: ViewInstance,
  spec: ThemeEnvironment["bloom"],
  state: ThemeEnvironmentState,
): void {
  const existing = state.bloom;
  if (spec === null) {
    if (existing === null) return;
    applyToEngine("the theme's bloom", () => {
      existing.visible = false;
    });
    return;
  }

  if (existing !== null) {
    applyToEngine("the theme's bloom", () => {
      // Identity, not equality: one frozen block per theme, so a re-render
      // that changed nothing must not rebuild the pass's mip pyramid.
      if (state.bloomSpec !== spec) {
        existing.update(bloomEffectConfig(spec));
        state.bloomSpec = spec;
      }
      existing.visible = true;
    });
    return;
  }

  if (state.bloomAvailable === null) {
    state.bloomAvailable = registerBloomEffect(view);
  }
  if (!state.bloomAvailable) return;

  try {
    state.bloom = view.addEffect(
      bloomEffectConfig(spec) as never,
    ) as unknown as ThemeEffect;
    state.bloomSpec = spec;
  } catch (error) {
    // Never retried: a descriptor the engine accepted but a pass it cannot
    // build (a GPU that refuses the shader) would otherwise throw once per
    // theme switch for the rest of the session.
    state.bloomAvailable = false;
    console.warn(
      "NavaraViewport: the theme's bloom effect could not be added; the theme renders without its glow.",
      error,
    );
  }
}

/**
 * Apply one theme's environment block to the live engine.
 *
 * Every branch reads `value ?? photorealDefault`, so the SAME code path both
 * enters a theme and leaves one: there is no separate "restore" routine that
 * could fall out of step with the one that applied it.
 *
 * Deliberately NOT here: the lens flare. It already has an effect of its own
 * driven by the user's atmosphere settings, so the theme's `lensFlareOff` is
 * composed into that gate instead — one owner per engine object, which is what
 * makes "restore the user's setting" automatic rather than something this
 * function has to reproduce. (The clouds work the same way and have no theme
 * flag at all: the user's toggle is their only gate.)
 */
function applyThemeEnvironment(
  view: ViewInstance,
  scene: PhotorealScene | null,
  env: ThemeEnvironment,
  state: ThemeEnvironmentState,
): void {
  const sky = scene?.sky;
  if (sky) {
    applyToEngine("the theme's sky visibility", () => {
      sky.visible = env.skyVisible ?? true;
    });
  }

  const stars = scene?.stars;
  if (stars) {
    const { pointSize, intensity } = env.starsBoost ?? PHOTOREAL_STARS;
    applyToEngine("the theme's star field", () =>
      stars.update({ stars: { pointSize, intensity } }),
    );
  }

  // The flat two-colour sky (cartoon) and the cyan Fresnel rim (cyber). Neither
  // is part of `addDefaultPhotorealScene()`, which is why they are meshes this
  // file creates rather than handles it was handed.
  //
  // Colours must be ENGINE Color INSTANCES, not hex numbers: the skyBox and
  // glowGlobe descs call `.toArray()` on them at createMesh time, and a bare
  // number made addMesh throw (the theme then rendered without its sky).
  // Cloning the globe's own colour manufactures an instance without importing
  // the engine's class into a file whose tests mock the engine wholesale —
  // the same trick `syncThemeGlobeColor` documents for `toHex()`.
  // The globe's colour is typed optional; without an instance to clone there
  // is no way to manufacture the engine's Color class, so the two theme
  // meshes are skipped with the same "renders without it" grace as a failed
  // add. Never observed in practice — the globe always has a colour by the
  // time a theme can be chosen.
  const globeColor = view.globe.color;
  const themeColor =
    globeColor === undefined
      ? null
      : (hex: number) => globeColor.clone().setHex(hex);
  syncThemeMesh(
    view,
    state,
    "skyBox",
    env.skyBoxColors === null || themeColor === null
      ? null
      : {
          skyBox: {
            dayColor: themeColor(env.skyBoxColors.dayColor),
            nightColor: themeColor(env.skyBoxColors.nightColor),
            sunColor: themeColor(env.skyBoxColors.sunColor),
          },
        },
  );
  syncThemeMesh(
    view,
    state,
    "glowGlobe",
    env.glowGlobe === null || themeColor === null
      ? null
      : {
          glowGlobe: {
            glowColor: themeColor(env.glowGlobe.glowColor),
            opacity: env.glowGlobe.opacity,
          },
        },
  );

  applyToEngine("the theme's globe wireframe", () => {
    view.globe.wireframe = env.globeWireframe ?? false;
  });
  syncThemeGlobeColor(view, env.globeColor, state);

  const toneMapping = scene?.toneMapping;
  if (toneMapping) {
    const mode =
      env.toneMappingMode === null
        ? PHOTOREAL_TONE_MAPPING_MODE
        : TONE_MAPPING_MODES[env.toneMappingMode];
    applyToEngine("the theme's tone-mapping mode", () =>
      toneMapping.update({ toneMapping: { mode } }),
    );
  }

  const sun = scene?.sun;
  if (sun) {
    // The key light. `SunLightDesc.onUpdateConfig` MERGES a partial `sun`
    // block into its stored config and applies each field live, so this
    // write and the shadow toggle's `castShadow` write (a separate effect)
    // never clobber each other — unlike the aerial-perspective pass, whose
    // config keys are REPLACED whole (Known Issue (j)) and which a theme
    // therefore never writes at all.
    applyToEngine("the theme's sun intensity", () =>
      sun.update({
        sun: { intensity: env.sunIntensity ?? PHOTOREAL_SUN_INTENSITY },
      }),
    );
  }

  const skyLightProbe = scene?.skyLightProbe;
  if (skyLightProbe) {
    applyToEngine("the theme's sky-light probe intensity", () =>
      skyLightProbe.update({
        skyLightProbe: {
          intensity:
            env.skyLightProbeIntensity ?? PHOTOREAL_SKY_LIGHT_PROBE_INTENSITY,
        },
      }),
    );
  }

  // Last: the bloom pass reads the frame every other lever above has shaped.
  // Unlike the fog lights it depends on nothing but the policy, so it belongs
  // in this function rather than in a data-dependent effect of its own.
  syncThemeBloom(view, env.bloom, state);
}

/**
 * Drape the selected raster basemap over the globe.
 *
 * The fix for "the globe is black": `addDefaultPhotorealScene()` adds sky,
 * stars, a sun and the post chain but NO imagery (see `basemaps.ts`), so
 * without this there is simply nothing on the ellipsoid to look at.
 *
 * Same failure policy as `addGoogleTiles`: a basemap is a backdrop, and a tile
 * service that is down, blocked or renamed must leave the viewer running. So a
 * refusal is reported and answered with `null`, which is also what keeps the
 * attribution overlay from crediting a provider whose imagery is not on screen.
 */
/**
 * Add global terrain relief, the piece of Navara's own base-scene recipe this
 * app was missing (`terrain.ts`).
 *
 * Same failure policy as the other two backdrops, for the same reason: a tile
 * service that is down must leave the viewer running. Falling back here means
 * the smooth ellipsoid the app used to draw on, not a blank screen.
 */
function addTerrain(view: ViewInstance): SourceLayerHandles | null {
  let source: SourceLayerHandles["source"] | null = null;
  try {
    source = view.addSource(TERRAIN.source);
    const layer = view.addLayer({ ...TERRAIN.layer, source });
    return { layer, source };
  } catch (error) {
    console.error(
      "NavaraViewport: global terrain could not be added; the viewer " +
        "continues on the smooth ellipsoid.",
      error,
    );
    discardOrphanSource(source);
    return null;
  }
}

/**
 * Turn a catalogue source into the descriptor the ENGINE wants.
 *
 * The one thing that has to change is the DEM decoder: `basemaps.ts` is
 * engine-free by construction (it is unit-tested under Node, where importing
 * `@navaramap/three` crashes at module scope), so it names the decoder as the
 * string `"terrarium"` and this — the engine-binding site — swaps in the real
 * `TERRARIUM_ELEVATION_DECODER()`. Imagery sources pass through untouched.
 */
function resolveBasemapSource(
  source: NonNullable<BasemapOption["source"]>,
): Parameters<ViewInstance["addSource"]>[0] {
  if (source.type !== "raster-dem") return source;
  const { elevationDecoder: _marker, ...rest } = source;
  // One decoder today; a second DEM service would switch on the marker here.
  return { ...rest, elevationDecoder: TERRARIUM_ELEVATION_DECODER() };
}

/**
 * The RdYlBu ramp from Navara's own ElevationHeatmapMaterial docs, low → high.
 *
 * Hex strings rather than built `Color`s: `Color` comes from the engine module,
 * which the viewport suites MOCK, so colours are constructed lazily inside
 * {@link addBasemap} (only reached with a live engine) instead of at module
 * scope, where the mock's stub class would be baked in at import time.
 */
const ELEVATION_RAMP_HEX = [
  "#313695",
  "#4575b4",
  "#74add1",
  "#abd9e9",
  "#e0f3f8",
  "#ffffbf",
  "#fee090",
  "#fdae61",
  "#f46d43",
  "#d73027",
  "#a50026",
] as const;

/**
 * Merge the user's ramp settings over a heatmap option's `layer` block.
 *
 * Identity for every option WITHOUT one (imagery, "None") — the settings only
 * mean anything to the elevation heatmap. `logBoundary` is derived, not user
 * state: the catalogue's 1000 m handover, clamped under the edited `maxHeight`
 * so a low ceiling (a Dutch user asking for 0–40 m) never puts the log knee
 * above the whole ramp.
 */
function applyHeatmapSettings(
  option: BasemapOption,
  settings: HeatmapSettings,
): BasemapOption {
  if (option.layer === undefined) return option;
  return {
    ...option,
    layer: {
      elevationHeatmap: {
        minHeight: settings.minHeight,
        maxHeight: settings.maxHeight,
        logarithmic: settings.logarithmic,
        logBoundary: Math.min(
          option.layer.elevationHeatmap.logBoundary,
          settings.maxHeight,
        ),
      },
    },
  };
}

function addBasemap(
  view: ViewInstance,
  option: BasemapOption,
): SourceLayerHandles | null {
  if (option.source === null) return null;
  let source: SourceLayerHandles["source"] | null = null;
  try {
    source = view.addSource(resolveBasemapSource(option.source));
    // `option.layer` is the elevation heatmap's colour ramp and nothing else's:
    // a `raster` layer over a `raster-dem` source draws nothing legible until
    // it is told how to colourise the heights it decodes.
    const layer = view.addLayer({ type: "raster", ...option.layer, source });
    if (option.layer !== undefined) {
      // The engine's default ramp is near-monochrome blue — Delft and the Alps
      // read as the same colour. `globe.elevationColormap` is the one globe
      // setter probed CLEAN on 0.0.5 (Known Issue (i); `color`/`wireframe`
      // stay banned), and it is written HERE, at the basemap seam, never from
      // theme code (`sceneThemePolicy`'s test pins that separation). It stays
      // written after a swap away, which is inert: only a raster-dem layer
      // reads it. Reported, not propagated — a refused ramp leaves the
      // engine's default, not a dead viewport.
      applyToEngine("the elevation heatmap's colour ramp", () => {
        view.globe.elevationColormap = new ColorMap(
          "diverging",
          "RdYlBu",
          ELEVATION_RAMP_HEX.map((hex) => new Color().setStyle(hex)),
        );
      });
    }
    return { layer, source };
  } catch (error) {
    console.error(
      `NavaraViewport: the "${option.label}" basemap could not be added; ` +
        "the viewer continues without imagery.",
      error,
    );
    // The source may already be registered — `addLayer` is the throw we
    // actually see in practice — and nothing else holds a reference to it, so
    // returning here without this would leak it into the engine for the life
    // of the session, once per failed attempt.
    discardOrphanSource(source);
    return null;
  }
}

/**
 * Take a backdrop back out, LAYER FIRST.
 *
 * The order is load-bearing rather than stylistic, and is why all three
 * backdrops share this one function: sources are reference-counted, so
 * `Source.delete()` removes nothing and answers `false` while any layer still
 * references it — deleting the source first leaks it for the life of the
 * session. Failures are reported and swallowed because a backdrop that will
 * not go away must not take the viewer with it.
 */
function removeSourceLayer(handles: SourceLayerHandles, what: string): void {
  try {
    handles.layer.delete();
    handles.source.delete();
  } catch (error) {
    console.error(`NavaraViewport: the ${what} could not be removed.`, error);
  }
}

/**
 * Delete a source that never got a layer.
 *
 * Only reachable from the `add*` failure paths, where the source succeeded and
 * the layer did not. `Source.delete()` answers `false` while a layer still
 * references the source — there is none here by construction — and its own
 * failure must not mask the error being reported by the caller.
 */
function discardOrphanSource(
  source: SourceLayerHandles["source"] | null,
): void {
  if (source === null) return;
  try {
    source.delete();
  } catch (error) {
    console.error(
      "NavaraViewport: an orphaned source could not be deleted.",
      error,
    );
  }
}

/** Take the basemap back out, layer first — `Source.delete()` is a no-op while
 *  a layer still references the source, so the reverse order leaks it. */
function removeBasemap(handles: SourceLayerHandles): void {
  removeSourceLayer(handles, "basemap");
}

/**
 * Add Google's Photorealistic 3D Tiles to a live view (Task C17).
 *
 * The engine-facing half of `googleTiles.ts`, and the successor to
 * `GoogleTilesLayer.tsx`: Navara renders 3D Tiles natively, so the whole
 * 3d-tiles-renderer/r3f stack — auth plugin, compression, fade, the creased-
 * normals plugin, the MeshBasicMaterial swap — collapses into one source and
 * one layer.
 *
 * Called AFTER `view.init()` (via `engineReady`), which is also after
 * `DefaultPlugin.addDefaultPhotorealScene()`: the tiles sit on top of the
 * default photoreal globe, which stays visible wherever Google has no coverage.
 *
 * Failure here is NOT fatal. The tiles are a backdrop; the city model is the
 * app. A rejected key, an offline session or an engine that dislikes the
 * descriptor must leave the viewer running, so this reports and returns `null`
 * rather than propagating into the init failure path (which would blank the
 * viewport and reject `CitySceneHandle.ready`).
 *
 * @returns the layer+source handles, or `null` when nothing was added — no key,
 * or the engine refused. `null` is also what keeps the attribution overlay from
 * crediting Google for imagery nobody is looking at.
 */
function addGoogleTiles(view: ViewInstance): SourceLayerHandles | null {
  const tiles = googleTilesConfig(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
  if (tiles === null) {
    if (import.meta.env.DEV) {
      console.warn(
        "[googleTiles] VITE_GOOGLE_MAPS_API_KEY not set. Tiles disabled.",
      );
    }
    return null;
  }
  let source: SourceLayerHandles["source"] | null = null;
  try {
    source = view.addSource(tiles.source);
    const layer = view.addLayer({ ...tiles.layer, source });
    return { layer, source };
  } catch (error) {
    console.error(
      "NavaraViewport: Google Photorealistic 3D Tiles could not be added; " +
        "the viewer continues on the default photoreal globe.",
      error,
    );
    // Pre-existing leak, fixed alongside the basemap's: a source whose layer
    // threw is unreachable but still registered, and the toggle can be flipped
    // any number of times.
    discardOrphanSource(source);
    return null;
  }
}

/**
 * Take the tiles back out, layer first.
 *
 * Order is load-bearing, not stylistic: `Source.delete()` documents itself as
 * removing nothing and answering `false` while any layer still references the
 * source, so deleting the source first would leak it. Failures are reported and
 * swallowed for the same reason `addGoogleTiles` swallows its own — a backdrop
 * that will not go away must not take the viewer with it.
 */
function removeGoogleTiles(handles: SourceLayerHandles): void {
  removeSourceLayer(handles, "Google Photorealistic 3D Tiles");
}

export const NavaraViewport = forwardRef<CitySceneHandle, NavaraViewportProps>(
  function NavaraViewport(props, ref) {
    const {
      onFps,
      onTriangleCount,
      onLayerError,
      onCursorPosition,
      onAttributionChange,
    } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<ViewInstance | null>(null);
    const cityPluginRef = useRef<CityJSONPlugin | null>(null);
    /** The live FlatCityBuf plugin, or null before the engine is up (and after
     *  it goes away). Read through the ref everywhere: it is the difference
     *  between a streaming-capable session and a static-only one. */
    const flatPluginRef = useRef<FlatCityBufPlugin | null>(null);
    /** Why there is no FlatCityBuf plugin, when there is none. Reported to a
     *  caller that asks for one rather than swallowed — see
     *  {@link getStreamingPlugin}. */
    const flatPluginErrorRef = useRef<unknown>(null);
    /** The live static handles, keyed by layer id. A ref, not state: the
     *  engine owns the meshes, and re-rendering on a handle change would only
     *  invalidate the imperative callbacks below. */
    const liveRef = useRef(new Map<string, LiveLayer>());
    /** Streaming layer handles, keyed by layer id — the second half of the ONE
     *  interaction registry (`handleSync.ts`). Filled by the reconciliation
     *  effect below, which is what makes picking, highlighting, fit and the
     *  triangle readout cover streamed cells. */
    const streamsRef = useRef(new Map<string, InteractionHandle>());
    /** What each streaming handle was last told (rules / LoD / visibility). */
    const streamSyncRef = useRef(new Map<string, StreamSyncMemo>());
    /** The live source+layer pair of each geospatial layer, keyed by geo layer
     *  id. A ref for the same reason `liveRef` is one: the engine owns them,
     *  and re-rendering on a handle change would buy nothing. */
    const geoLiveRef = useRef(new Map<string, LiveGeoLayer>());
    /**
     * The last engine `pick`, waiting for the `click` that commits it.
     *
     * A REF rather than a variable local to the pointer effect below: that
     * effect's deps include `layers`, so it tears down and re-subscribes on
     * every city-layer edit — a LoD change, a rule edit, a load finishing —
     * and an effect-local stash would be thrown away mid-gesture, between the
     * pick and the click that reads it.
     */
    const geoPickStashRef = useRef<EnginePickStash | null>(null);
    const [engineReady, setEngineReady] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);
    /** Whether Google's photorealistic tiles are actually IN the scene — set
     *  when the `3d-tiles` layer was added, not merely when a key exists, so
     *  the attribution overlay never credits Google for imagery an engine that
     *  failed to start is not showing. */
    const [tilesEnabled, setTilesEnabled] = useState(false);
    /** Whether global terrain is actually IN the scene — the same "credit what
     *  is on screen, not what was asked for" rule the other backdrops follow. */
    const [terrainEnabled, setTerrainEnabled] = useState(false);
    /** Whether the user WANTS them — the sidebar / advanced-settings toggle.
     *  Distinct from `tilesEnabled` above, which is whether they are actually
     *  in the scene: with no API key, or after the engine refuses the layer,
     *  the flag stays on while the credit stays off. */
    const tilesWanted = useTilesStore((s) => s.enabled);
    /** Which basemap the user picked. */
    const basemapId = useBasemapStore((s) => s.basemapId);
    const customBasemap = useBasemapStore((s) => s.custom);
    const heatmapSettings = useBasemapStore((s) => s.heatmap);
    /** Photoreal / cartoon / cyber / wireframe. What it MEANS is
     *  `sceneThemePolicy.ts`; this component only applies it. */
    const sceneTheme = useSceneThemeStore((s) => s.theme);
    const themePolicy = sceneThemePolicy(sceneTheme);
    /**
     * The basemap actually draped, and whether Google's tiles are actually
     * asked for — DERIVED, never written back.
     *
     * A theme is a presentation overlay: the picker keeps showing the user's
     * own choice (and says, in one line, that the theme has taken it over), and
     * switching back to photoreal restores it because nothing was ever
     * mutated. The attribution overlay follows automatically, since it credits
     * the option that is on screen.
     */
    const effectiveBasemapId = themePolicy.basemapOverride ?? basemapId;
    const effectiveTilesWanted = tilesWanted && !themePolicy.googleTilesOff;
    /** Pulled out as a scalar so the lens-flare effect can depend on it without
     *  depending on the whole policy object. The clouds have no such flag: they
     *  follow the user's toggle in every theme. */
    const themeLensFlareOff = themePolicy.environment.lensFlareOff;
    /** The user's own GeoJSON / XYZ / 3D-Tiles layers. Reconciled into engine
     *  source+layer pairs by `geoLayerSync.ts`. */
    const geoLayers = useGeoLayerStore((s) => s.layers);
    const geoQueries = useQueryStore((s) => s.queries);
    const geoVisibleFeatureIds = useMemo(
      () =>
        Object.fromEntries(
          geoLayers
            .filter((layer) => layer.kind === "geojson")
            .map((layer) => {
              const applied = layerQuery(
                { queries: geoQueries },
                layer.id,
              ).applied;
              return [
                layer.id,
                applied === null
                  ? null
                  : new Set<string>(
                      filterGeoRecords(
                        geoRecords(layer.config.preparedData),
                        applied,
                      ).map((row) => geoRecordId(row)),
                    ),
              ];
            }),
        ),
      [geoLayers, geoQueries],
    );
    /** Pulled out as a scalar so the layer-sync effect can count the workspace
     *  (and re-run when a geo layer comes or goes) without depending on the
     *  array itself. */
    useEffect(() => {
      useGeoFeatureVisibilityStore.setState({ visible: geoVisibleFeatureIds });
    }, [geoVisibleFeatureIds]);
    const geoLayerCount = geoLayers.length;
    /** 2D / 2.5D / 3D. What it MEANS is `viewModePolicy.ts`; this component
     *  only applies it to the engine (controller flags + one entry flight). */
    const viewMode = useViewModeStore((s) => s.mode);
    /** False until the mode effect has run once. It is what tells a user
     *  pressing "2D" apart from a restored workspace COMING UP in 2D — the
     *  latter must not fly, because the snapshot's own camera is on its way. */
    const viewModeAppliedRef = useRef(false);
    /** The basemap whose imagery is actually IN the scene, or `null` — the
     *  same "credit what is on screen, not what was asked for" rule the Google
     *  credit follows. */
    const [activeBasemap, setActiveBasemap] = useState<BasemapOption | null>(
      null,
    );
    /** Whether the volumetric clouds effect is wanted (advanced settings). */
    const cloudsWanted = useRenderDebugStore((s) => s.cloudsEnabled);
    const postProcessingEnabled = useRenderDebugStore(
      (s) => s.postProcessingEnabled,
    );
    const aerialPerspectiveEnabled = useRenderDebugStore(
      (s) => s.aerialPerspectiveEnabled,
    );
    const sunShadowsEnabled = useRenderDebugStore((s) => s.sunShadowsEnabled);
    const shadowQuality = useRenderDebugStore((s) => s.shadowQuality);
    const exposure = useRenderDebugStore((s) => s.exposure);
    /** The exposure actually written to the engine: the theme's, or — when the
     *  theme names none — the user's Advanced Settings slider. The store is
     *  never written, so the slider keeps its own value throughout. */
    const effectiveExposure = themePolicy.environment.exposure ?? exposure;
    /** Whether to outline each streaming layer's camera-derived fetch bbox. */
    const queryBoxEnabled = useRenderDebugStore((s) => s.streamQueryBoxEnabled);
    const cloudCoverage = useAtmosphereStore((s) => s.cloudCoverage);
    const lensFlareEnabled = useAtmosphereStore((s) => s.lensFlareEnabled);
    const precipitation = useAtmosphereStore((s) => s.precipitation);
    /** The handles the default photoreal scene handed back — the sky, stars,
     *  sun, sky light probe and the whole post chain. See {@link PhotorealScene}. */
    const photorealRef = useRef<PhotorealScene | null>(null);
    /** The live clouds effect handle, so coverage can be pushed to the pass
     *  instead of rebuilding it. */
    const cloudsHandleRef = useRef<CloudsHandle | null>(null);
    /** What the theme layer remembers between switches — the two meshes it
     *  owns, the globe colour it found, and whether anything is overridden.
     *  See {@link ThemeEnvironmentState}. */
    const themeEnvRef = useRef<ThemeEnvironmentState>(
      createThemeEnvironmentState(),
    );
    /** The coverage the pass should be BORN with. A ref, so the add effect
     *  below can read the current value without depending on it. */
    const cloudCoverageRef = useRef(cloudCoverage);
    /** Bumped by the sync effect when the FIRST layer of an empty workspace
     *  was added, which is the only thing that triggers an automatic fit. */
    const [fitToken, setFitToken] = useState(0);
    /** The last `fitToken` the fit effect below acted on (or deliberately
     *  dropped), so one token can never be served twice. */
    const handledFitTokenRef = useRef(0);
    // A restored viewpoint outranks first-layer framing even when React syncs
    // the model after App has released its temporary restore suppression.
    const restoredCameraRef = useRef(false);
    /**
     * How many layers the workspace held at the end of the last sync — city
     * rows (static AND streaming) plus geo overlays.
     *
     * This, not `liveRef.size`, is what "an empty workspace" means. `liveRef`
     * holds static handles only: a workspace whose first layer is a `.fcb` or
     * a GeoJSON overlay has NO live handle, so keying the fit on that count
     * would yank the camera away from what the user is already looking at the
     * moment their first CityJSON file lands beside it (Task 6, M12.1).
     */
    const previousLayerCountRef = useRef(0);
    const layers = useLayerStore((s) => s.layers);
    /**
     * Which layer ids currently have a stream registered, as one string.
     *
     * The reconciliation effect below reads the handles out of
     * `useStreamStore.getState()`, so it needs a reason to re-run when a stream
     * is opened or closed — but subscribing to `streams` itself would re-render
     * this component on every cell commit (a commit replaces that object; see
     * streamStore.ts's doc comment on exactly this hazard). The id set changes
     * only when a layer is opened or closed, which is precisely the beat this
     * effect cares about.
     */
    const streamIds = useStreamStore((s) =>
      Object.keys(s.streams).sort().join(" "),
    );

    // CitySceneHandle.ready — created eagerly so a consumer can await it before
    // the mount effect has run. Resolve-or-reject, never a hang: see the Shared
    // Interface Contract.
    //
    // RE-ARMABLE, and read through the ref EVERYWHERE (never captured in a
    // closure): the lifecycle cleanup below rejects the current gate and
    // installs a fresh one, because a gate whose engine has been torn down can
    // never settle by itself. StrictMode makes that subtle — it runs
    // setup/cleanup/setup against ONE render, so the second pass re-enters the
    // *same* effect closure, and a captured gate would be the one the first
    // pass's cleanup already rejected. Hence `readyRef.current` at use time,
    // and a getter on the imperative handle so a consumer always sees the live
    // promise rather than a dead one.
    const readyRef = useRef<ReadyGate | null>(null);
    readyRef.current ??= createReadyGate();

    // --- Engine lifecycle (StrictMode-safe, see navaraSession.ts) ---
    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        // Unreachable in practice — the div below is rendered unconditionally,
        // so React has attached the ref by the time this effect runs — but an
        // early `return` here would leave `ready` pending FOREVER, which is
        // the same hang class as the plugin-constructor escape fixed in B11a.
        // Resolve-or-reject, never a hang (Shared Interface Contract).
        const error = new Error(
          "NavaraViewport: the canvas container never mounted, so the engine cannot start.",
        );
        setInitError(error.message);
        // No re-arm: this is a hard, permanent failure, and returning without
        // a cleanup means nothing will ever try again.
        readyRef.current!.reject(error);
        return;
      }

      mountedViewports += 1;
      if (import.meta.env.DEV && mountedViewports > 1) {
        console.warn(
          `NavaraViewport: ${mountedViewports} instances are mounted at once. ` +
            "Navara's tile worker pool is a process-wide singleton, so only " +
            "one view can be live: the extra instances stay blank until the " +
            "first one unmounts. Render exactly one NavaraViewport.",
        );
      }

      let cancelled = false;
      let session: NavaraSession<ViewInstance> | null = null;
      /** The canvas this mount put in the container, so the cleanup can take
       *  exactly that one back out. `null` when the mount was cancelled before
       *  its turn at `engineSlot` and never built anything. */
      let canvas: HTMLCanvasElement | null = null;
      // Captured, not read as `ref.current` from the cleanup below: the maps
      // outlive nothing here (a ref object is stable for the component's whole
      // life), and reading them once is what makes the cleanup provably
      // operate on the same registries this mount filled.
      const live = liveRef.current;
      const streams = streamsRef.current;
      const streamMemos = streamSyncRef.current;
      const geoLive = geoLiveRef.current;

      // ONE try/catch around the WHOLE queued body. Everything that can throw
      // lives inside it — a rejected predecessor, a plugin constructor on an
      // unsupported browser, `createView`, `init()`, an `afterInit` hook — so
      // there is no escape that leaves `ready` pending. Resolve-or-reject,
      // never a hang (Shared Interface Contract → CitySceneHandle.ready).
      const started = (async () => {
        try {
          // Our turn only comes once any previous view has been disposed. If
          // this mount was already torn down by then (StrictMode's first
          // pass), build nothing at all.
          await engineSlot;
          if (cancelled) return;

          // OUR canvas, in our container, created before the view so the
          // engine never builds (and abandons) its own — see the `canvas`
          // note on `createView` below. Sized in percentages exactly as the
          // engine sizes the one it would have made; the container is what
          // carries real dimensions, and `resize()` drives the backing store.
          // `display: block` kills the inline-element baseline gap that would
          // otherwise make the container a few pixels taller than the canvas.
          // A `const` the closures below capture, rather than the mutable
          // `canvas` binding: `createView` runs later, so TypeScript would
          // have widened that one back to `| null` at the call site.
          const ownCanvas = document.createElement("canvas");
          ownCanvas.style.width = "100%";
          ownCanvas.style.height = "100%";
          ownCanvas.style.display = "block";
          container.appendChild(ownCanvas);
          canvas = ownCanvas;

          // Constructed here so this component keeps typed refs; the session
          // only needs them in registration order (Task B8). There is no
          // `view.addPlugin` call anywhere in this component: the engine
          // rejects `addPlugin()` after `init()`, and this component never
          // holds the view before init has started, so the ordered list is the
          // ONLY registration point.
          const defaultPlugin = new DefaultPlugin();
          // Both plugins take the SAME brand colours, so a picked surface is
          // painted identically whether it came from a file or a stream.
          const cityPlugin = new CityJSONPlugin({
            colors: CITY_COLORS,
          });
          // Streaming is the one OPTIONAL capability of the three: a build (or
          // a browser) in which this constructor throws must still show static
          // layers, so the failure is recorded and re-raised only at the point
          // someone actually asks to open a `.fcb` — unlike DefaultPlugin,
          // whose failure is the whole viewer's failure.
          let flatPlugin: FlatCityBufPlugin | null = null;
          try {
            flatPlugin = new FlatCityBufPlugin({
              // The component owns the container element, so it — not the
              // plugin — measures the viewport: `ThreeView` documents `canvas`
              // as a CONSTRUCTOR option, not a readable property (Task C4).
              // Same size source the pick path reads.
              getViewportSize: () => ({
                width: container.clientWidth,
                height: container.clientHeight,
              }),
              colors: CITY_COLORS,
            });
            flatPluginErrorRef.current = null;
          } catch (error) {
            flatPluginErrorRef.current = error;
            console.error(
              "NavaraViewport: the FlatCityBuf plugin could not be constructed, " +
                "so .fcb streaming is unavailable in this session. Static layers are unaffected.",
              error,
            );
          }

          session = createNavaraSession({
            // Task B1 finding 3: `Options` has NO `useNormal`. `shadow` is
            // init-time-only, and `picking` defaults to true but is spelled
            // out because the app depends on it. `animation` keeps the render
            // loop running every frame, which is what the FPS readout below
            // measures.
            //
            // `canvas` is passed as well as `container`, and it is what stops
            // the WHOLE PAGE from scrolling. The engine's constructor branches
            // on `canvas` alone: given none, it builds its own
            // `<div id="navara-root" style="width:100vw;height:100vh">`,
            // puts a canvas in it and appends THAT to `document.body`. Init
            // then re-parents the canvas into `container`
            // (`options.container.appendChild(renderer.domElement)`) and the
            // div stays behind — empty, still a full viewport tall, and
            // statically positioned, so the document became exactly 200vh and
            // the app scrolled away under a blank screenful. It is only
            // removed by `dispose()`, i.e. never during a session.
            // Handing the engine a canvas we own skips that branch outright.
            // `container` still has to be passed: `_getCanvasSize()` measures
            // it, and it is what `resize()` reads.
            createView: () =>
              new ThreeView({
                container,
                canvas: ownCanvas,
                shadow: true,
                picking: true,
                animation: true,
              }),
            plugins: [
              {
                key: "default",
                instance: defaultPlugin,
                // Must run after `view.init()` — hence an afterInit hook
                // rather than a call next to the constructor. The RETURN VALUE
                // is kept: those handles are the only way to drive the sky,
                // the sun and the post chain afterwards (see PhotorealScene).
                afterInit: (liveView) => {
                  const scene = defaultPlugin.addDefaultPhotorealScene() as
                    | PhotorealScene
                    | undefined;
                  // `cancelled`, like every other write out of this queued
                  // body. This hook runs inside `session.ready`, which can
                  // resolve AFTER the cleanup has torn the mount down (and,
                  // under StrictMode, after a second mount has installed its
                  // own handles) — publishing then would leave the settings
                  // effects pushing `visible` through a disposed scene, or
                  // through the previous engine's handles over a live view.
                  if (cancelled) return;
                  photorealRef.current = scene ?? null;
                  // The session hands the hook its `NavaraViewLike` slice; it
                  // IS the `ThreeView` built by `createView` above.
                  applyForwardLighting(liveView as ThreeView);
                },
              },
              { key: "cityjson", instance: cityPlugin },
              ...(flatPlugin === null
                ? []
                : [{ key: "flatcitybuf", instance: flatPlugin }]),
            ],
          });

          const result = await session.ready;
          if (cancelled) return;

          // Allow manual rotation immediately. Navara needs a nonzero spin
          // duration for drag updates; 1 ms avoids noticeable release inertia.
          result.view.camera.options = {
            enableSpin: viewModePolicy(useViewModeStore.getState().mode)
              .enableSpin,
            // A zero duration also disables manual spin in Navara.
            spinDuration: 1,
            enableTilt: viewModePolicy(useViewModeStore.getState().mode)
              .enableTilt,
          };
          viewRef.current = result.view;
          cityPluginRef.current = cityPlugin;
          flatPluginRef.current = flatPlugin;
          // The `.fcb` open paths live in `useLayerFileLoader` and `App.tsx`,
          // nowhere near this component; `streamPlugin.ts` is the one place
          // they resolve the live plugin from (Task C12).
          setStreamPlugin(flatPlugin);
          // The photorealistic backdrop is NOT added here: it follows
          // `tilesStore.enabled` from its own effect below, which `engineReady`
          // gates behind this point (and therefore behind `view.init()` and
          // `DefaultPlugin.addDefaultPhotorealScene()`, which the tiles sit on
          // top of).
          setInitError(null);
          setEngineReady(true);
          // `readyRef.current`, never a captured gate: a cancelled predecessor
          // (StrictMode's first pass) has already re-armed it, and resolving
          // the retired one would leave this mount's consumers waiting.
          readyRef.current!.resolve();
        } catch (error) {
          // Torn down mid-init, or disposed before it went live: not a failure
          // anyone needs to see, the cleanup below still disposes, and the
          // cleanup has already rejected the gate this mount owned.
          if (cancelled || error instanceof NavaraSessionDisposedError) return;
          setInitError(error instanceof Error ? error.message : String(error));
          readyRef.current!.reject(error);
        }
      })();

      engineSlot = started;

      return () => {
        cancelled = true;
        mountedViewports -= 1;
        setEngineReady(false);
        // The tiles layer died with the view, so the credit for it has to go
        // too — the geoid lines stay, because they are unconditional.
        setTilesEnabled(false);
        viewRef.current = null;
        cityPluginRef.current = null;
        // The photoreal handles died with the view. Dropping them here is what
        // stops the settings effects below from pushing `visible` through a
        // descriptor whose scene has been disposed on the next store change.
        photorealRef.current = null;
        // The theme's own meshes (the flat sky box, the Fresnel halo) died with
        // the view too, and so did the globe colour it captured. Forgetting all
        // of it means the next mount re-adds them from the active theme rather
        // than toggling `visible` on a mesh whose scene is gone — and re-reads
        // the globe's real colour instead of restoring a stale one.
        themeEnvRef.current = createThemeEnvironmentState();
        // Streaming state dies with the engine, and it has to be TOLD to: the
        // plugin's `dispose()` deletes every handle, but `streamStore` holds
        // the only other reference to them, so leaving its entries behind
        // would leave the layer panel, the inspector and the status bar
        // reading a handle whose worker has been terminated. Closing them here
        // releases those workers immediately and unregisters in one pass; the
        // later `session.dispose()` is idempotent over the same handles.
        const flatPlugin = flatPluginRef.current;
        flatPluginRef.current = null;
        setStreamPlugin(null);
        closeAllStreamingLayers(flatPlugin);
        streams.clear();
        streamMemos.clear();
        // SETTLE, then RE-ARM. Both halves are load-bearing:
        //   * settle — every `return` inside `started` above is guarded by
        //     `cancelled`, so once this cleanup has run nothing can ever
        //     resolve this gate. A consumer that grabbed `handle.ready` and is
        //     still awaiting it (App.tsx closes the last layer mid-init, and
        //     Task C20 replaces its 100 ms setTimeout with exactly that await)
        //     would wait forever. Resolve-or-reject, never a hang.
        //   * re-arm — a settled promise cannot be reused, and this component
        //     may well mount again: StrictMode does it immediately, and so
        //     does re-opening a file after `handleClose`. `createReadyGate`
        //     already attaches a `.catch`, so the rejection below is never
        //     reported as unhandled even when nobody was listening.
        readyRef.current!.reject(
          new Error(
            "NavaraViewport was unmounted before the 3D engine finished starting.",
          ),
        );
        readyRef.current = createReadyGate();
        // The handles die with the view; dropping them here means the next
        // mount re-adds every layer from the store instead of trusting stale
        // entries whose meshes have been disposed.
        live.clear();
        // With them, the workspace size the fit is keyed on: refs survive a
        // remount of the same instance, and a rebuilt view comes up on the
        // default globe camera. Those re-added layers are the first content of
        // the new scene and must earn their one fit (Task 6).
        previousLayerCountRef.current = 0;
        restoredCameraRef.current = false;
        // Same reasoning for the geospatial pairs, but they are DELETED rather
        // than merely forgotten: they are ordinary engine layers and sources,
        // and this runs before `session.dispose()` (which only happens once
        // `started` settles), so the view is still alive to take them back.
        // The store keeps its records, so the next mount rebuilds every pair.
        removeAllGeoLayerHandles(geoLive);
        // The solar site died with them. `App.tsx` unmounts this component in
        // the same commit that empties the layer store (`handleClose`), so the
        // site effect below never gets to clear it — and a `latLon` with no
        // scene behind it is a sun readout for a model that is gone.
        useSolarStore.getState().setLatLon(null);
        useSolarStore.getState().setSunPosition(null);
        // `started` settles only after `session.ready` has, so by the time
        // this runs the session disposes synchronously — which is what lets
        // the next mount initialise a fresh worker pool. If `dispose()` itself
        // throws, the next mount's `await engineSlot` re-raises it into that
        // mount's catch: reported in its error panel, never a silent hang.
        engineSlot = started.then(() => {
          session?.dispose();
          // AFTER `dispose()`, which is synchronous (`navaraSession.ts`) and
          // still reaches for the canvas on its way out — it detaches the
          // `contextmenu` listener the engine bound in its constructor. The
          // engine only removes a canvas it created itself, and this one is
          // ours, so the next mount would otherwise stack a second dead canvas
          // in the container.
          canvas?.remove();
          canvas = null;
        });
      };
      // `[]`: the gate now lives entirely behind `readyRef`, so there is
      // nothing left for this effect to depend on. Re-running it would tear
      // the engine down and rebuild it for no reason.
    }, []);

    // --- Global terrain relief ---
    //
    // Declared FIRST of the three backdrop effects, and that ordering is the
    // whole reason it sits here rather than beside them: Navara renders layers
    // in the order they were ADDED, and the raster basemap is draped over the
    // terrain, so the terrain has to exist first. Effects run in declaration
    // order on mount, which makes this the add order too. Re-picking a basemap
    // later removes and re-adds only that layer, so it stays after the terrain.
    //
    // Unconditional, unlike the other two: terrain is not a choice the app
    // offers, it is the shape of the ground (see `terrain.ts`). A failure is
    // still non-fatal — the viewer falls back to the smooth ellipsoid it used
    // to have rather than not starting.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      const handles = addTerrain(view);
      if (handles === null) return;
      setTerrainEnabled(true);
      return () => {
        setTerrainEnabled(false);
        if (viewRef.current === view) removeSourceLayer(handles, "terrain");
      };
    }, [engineReady]);

    // --- Google Photorealistic 3D Tiles, following the sidebar toggle ---
    //
    // Declared AFTER the lifecycle effect above on purpose: React runs cleanups
    // in declaration order, so on unmount the engine is disposed first and the
    // `viewRef.current === view` guard below then correctly declines to call
    // `delete()` on handles whose view no longer exists. While the engine is
    // alive that guard passes and the toggle really does remove the layer.
    useEffect(() => {
      const view = viewRef.current;
      // `effectiveTilesWanted`, not the store's flag: a scene theme can
      // suppress the tiles without writing the toggle, so leaving the theme
      // brings them straight back.
      if (!engineReady || view === null || !effectiveTilesWanted) return;
      const handles = addGoogleTiles(view);
      // `null` = no key, or the engine refused: nothing was added, so there is
      // nothing to credit and nothing to take away.
      if (handles === null) return;
      setTilesEnabled(true);
      return () => {
        setTilesEnabled(false);
        if (viewRef.current === view) removeGoogleTiles(handles);
      };
    }, [engineReady, effectiveTilesWanted]);

    // --- The raster basemap, following the picker ---
    //
    // Declared after the lifecycle effect for the same reason the tiles effect
    // is: React runs cleanups in declaration order, so on unmount the engine is
    // already disposed and the `viewRef.current === view` guard declines to
    // call `delete()` through a dead view. Keyed on `basemapId`, so changing
    // the option removes the old pair and adds the new one in one commit —
    // and on the heatmap's ramp settings too, because a raster layer's
    // `elevationHeatmap` block is baked into its description and the honest
    // way to change a description is the same remove-and-re-add the picker
    // itself uses (the browser-verified path; `Layer.update` on a live
    // raster-dem drape is untested on 0.0.5). The settings ride every option
    // through `applyHeatmapSettings`, which is the identity for imagery, so
    // editing them while Esri is draped re-adds nothing meaningfully
    // different and costs one swap of an already-cached tile set.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      // The theme's override wins over the picker while it is in force, and
      // the picker wins again the moment it is not.
      const option = applyHeatmapSettings(
        (effectiveBasemapId === "custom"
          ? customBasemapOption(customBasemap)
          : null) ?? basemapById(effectiveBasemapId),
        heatmapSettings,
      );
      const handles = addBasemap(view, option);
      // "None", or the engine refused: nothing is draped, so nobody is credited.
      if (handles === null) return;
      setActiveBasemap(option);
      return () => {
        setActiveBasemap(null);
        if (viewRef.current === view) removeBasemap(handles);
      };
    }, [engineReady, effectiveBasemapId, heatmapSettings, customBasemap]);

    // --- The user's geospatial layers (GeoJSON / XYZ raster / 3D Tiles) ---
    //
    // Declared AFTER the terrain and basemap effects, which is also the add
    // order on mount: Navara renders layers in the order they were added, and
    // imported data belongs ON TOP of the imagery rather than under it.
    //
    // NO cleanup here, deliberately, unlike the two backdrops above: this
    // effect re-runs on every store edit, so a cleanup would delete and re-add
    // every pair for a rename. Teardown happens once, in the lifecycle
    // cleanup (`removeAllGeoLayerHandles`), where the engine is actually going
    // away. The reconciliation itself — and its add-failure policy — lives in
    // `geoLayerSync.ts`, pure and unit-tested against a fake view.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      syncGeoLayers(view, geoLayers, geoLiveRef.current);
      // A pair REBUILT by the pass above (a new document, a new URL) comes back
      // with no highlight and no colour factory of its own, so a selection that
      // outlived the rebuild would silently stop being drawn. Read from
      // `getState()` rather than subscribed: the selection is not a reason to
      // reconcile the layers, and putting it in this effect's deps would
      // re-run `syncGeoLayers` on every click.
      syncGeoHighlight(
        useSelectionStore.getState().geoSelection,
        geoLiveRef.current,
        makeEngineColor,
      );
    }, [engineReady, geoLayers]);

    // The engine's default forward-lighting shader samples cloud shadows but
    // discards their transmittance. Bridge that branch without re-lighting albedo.
    useEffect(() => {
      if (!engineReady || !cloudsWanted || !postProcessingEnabled) return;
      const ap = photorealRef.current?.aerialPerspective as unknown as
        | {
            ref?: {
              raw?: {
                rawEffect?: {
                  getFragmentShader: () => string;
                  setFragmentShader: (shader: string) => void;
                };
              };
            };
          }
        | undefined;
      const effect = ap?.ref?.raw?.rawEffect;
      if (!effect) return;
      const original = effect.getFragmentShader();
      try {
        effect.setFragmentShader(forwardCloudShadowShader(original));
      } catch (error) {
        console.error("Cloud shadows could not be restored", error);
        return;
      }
      return () => {
        effect.setFragmentShader(original);
      };
    }, [engineReady, cloudsWanted, postProcessingEnabled]);

    // --- Volumetric clouds ---
    //
    // `addDefaultPhotorealScene()` registers the sky, stars, sun light,
    // aerial perspective, lens flare, tone mapping and antialiasing — it does
    // NOT add clouds, even though `DefaultPlugin.init()` registers the
    // `"clouds"` effect descriptor. So the effect has to be added by hand; the
    // advanced-settings toggle (default OFF, to match the reference look) and
    // the coverage slider drive it. Turning it back OFF needs one extra step
    // the engine does not take for us — see `disposeCloudsPass`.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      // The user's toggle is the ONLY gate. No theme suppresses the clouds:
      // one did for each of the three looks, which meant changing theme threw
      // away weather nobody had asked to lose. They composite through the
      // aerial-perspective pass, so a theme's exposure and albedo already
      // restyle them along with everything else.
      if (!postProcessingEnabled || !cloudsWanted) return;
      let handle: CloudsHandle | null = null;
      try {
        handle = view.addEffect({
          clouds: { coverage: cloudCoverageRef.current },
        }) as unknown as CloudsHandle;
      } catch (error) {
        // Clouds are weather, not the app: a browser (or a software
        // rasteriser) that cannot afford the ray-marching pass must still get
        // a working viewer.
        console.error(
          "NavaraViewport: the clouds effect could not be added; the sky renders without it.",
          error,
        );
        return;
      }
      cloudsHandleRef.current = handle;
      return () => {
        cloudsHandleRef.current = null;
        if (viewRef.current !== view) return;
        // DISPOSE, then delete. The order and the extra call are both
        // load-bearing — see `disposeCloudsPass`: deleting the handle on its
        // own leaves the aerial-perspective pass compositing the clouds'
        // last frame, so the toggle appears to do nothing.
        if (handle !== null) disposeCloudsPass(handle);
        try {
          handle?.delete();
        } catch (error) {
          console.error(
            "NavaraViewport: the clouds effect could not be removed.",
            error,
          );
        }
      };
      // `cloudCoverage` is deliberately NOT a dependency: dragging the slider
      // would tear the pass down and rebuild it (and re-load its 3D textures)
      // per pointer move. The separate effect below pushes it instead.
    }, [engineReady, postProcessingEnabled, cloudsWanted]);

    // Cloud shadows are a separate engine flag from the sun's geometry maps.
    useEffect(() => {
      const handle = cloudsHandleRef.current;
      if (!handle) return;
      applyToEngine("cloud shadows", () =>
        handle.update({ clouds: { shadows: sunShadowsEnabled } }),
      );
    }, [engineReady, cloudsWanted, postProcessingEnabled, sunShadowsEnabled]);

    // Coverage -> the live pass, without rebuilding it.
    useEffect(() => {
      cloudCoverageRef.current = cloudCoverage;
      const handle = cloudsHandleRef.current;
      if (!handle) return;
      try {
        handle.update({ clouds: { coverage: cloudCoverage } });
      } catch (error) {
        console.error(
          "NavaraViewport: the cloud coverage could not be updated.",
          error,
        );
      }
    }, [cloudCoverage]);

    // --- Tone-mapping exposure ---
    //
    // Navara's getting-started sets `view.toneMappingExposure = 10` and every
    // published sample renders at that value; three's default is 1, and this
    // app never set it at all. The atmosphere hands the tone mapper
    // physically-scaled radiance, so at exposure 1 the whole city sits in the
    // bottom of the curve — dim, low-contrast and blue-grey.
    //
    // 10 is not a taste setting, it is the exposure the engine's forward-lit
    // calibration is defined at (`applyForwardLighting`): the sun and the sky
    // probe carry physically-scaled radiance, and no ambient fill is stacked
    // on top of them.
    // Driven from the store so the slider in Advanced Settings is the same knob
    // rather than a second one.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      applyToEngine("the tone-mapping exposure", () => {
        // The theme's exposure wins while it is in force, and the slider takes
        // over again the instant it is not — one write site, so the two can
        // never both be pushing.
        view.toneMappingExposure = effectiveExposure;
      });
    }, [engineReady, effectiveExposure]);

    // NO ambient fill light. The app used to add one
    // (`view.addLight({ ambient })`, default intensity 0.6) on top of the
    // photoreal scene's sun and sky probe. The sky probe IS the ambient term
    // — sampled from the atmosphere, so it follows the time of day — and a
    // flat fill on top of it is energy stacked on an image already calibrated
    // for exposure 10, one of the three things that once pushed every roof to
    // white. A theme that wants its ground darker turns the sun and the probe
    // down (`sceneThemePolicy`), never adds a light.

    // --- The post chain: aerial perspective, lens flare, antialiasing ---
    //
    // These three are created by `addDefaultPhotorealScene()`, so unlike the
    // clouds they are toggled through `handle.visible` rather than added and
    // deleted — `BaseHandle.visible` maps onto the `postprocessing` pass's own
    // enable flag (`Pass.visible`), which is what takes them out of the chain.
    //
    // Tone mapping is deliberately NOT in this list: it is the thing that maps
    // HDR radiance to display range, so hiding it blows the frame to white
    // instead of showing what the other passes contribute.
    useEffect(() => {
      const scene = photorealRef.current;
      if (!engineReady || scene === null) return;
      const setVisible = (
        what: string,
        handle: VisibilityHandle | undefined,
        visible: boolean,
      ) => {
        if (!handle) return;
        applyToEngine(what, () => {
          handle.visible = visible;
        });
      };
      setVisible(
        "the aerial perspective toggle",
        scene.aerialPerspective,
        postProcessingEnabled && aerialPerspectiveEnabled,
      );
      setVisible(
        "the lens flare toggle",
        scene.lensFlare,
        // The theme's veto is COMPOSED with the user's switch, never written
        // to it — same rule as the clouds, and what makes leaving the theme
        // restore the atmosphere panel's own setting for free.
        postProcessingEnabled && lensFlareEnabled && !themeLensFlareOff,
      );
      setVisible(
        "the antialiasing toggle",
        scene.antialiasing,
        postProcessingEnabled,
      );
    }, [
      engineReady,
      postProcessingEnabled,
      aerialPerspectiveEnabled,
      lensFlareEnabled,
      themeLensFlareOff,
    ]);

    // --- The scene theme's environment ---
    //
    // One effect for the sky, the stars, the two theme-owned meshes, the globe,
    // the tone curve, the sun's intensity and the sky-light probe —
    // everything `sceneThemePolicy.ts` puts in the `environment` block. The
    // exposure, the basemap, the Google tiles, the clouds and the lens flare
    // are deliberately NOT here: each already has one owner, and the theme is
    // composed into that owner instead of contending with it.
    //
    // While the viewer has never left photoreal this does NOTHING AT ALL — not
    // "writes the defaults", nothing — which is what makes the theme system a
    // provable no-op for a user who never opens the menu. Once a theme has been
    // applied, going back to photoreal runs the same code with every value
    // resolved to the engine's own default, so restore cannot drift from apply.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      const state = themeEnvRef.current;
      const photoreal = sceneTheme === "photoreal";
      if (photoreal && !state.applied) return;
      // A theme-to-theme switch goes THROUGH the photoreal restore: write
      // every lever back to its default, then apply the target. Browser-found:
      // jumping straight from one non-photoreal environment to another left
      // the 0.0.5 engine holding a mix of both (wireframe -> cartoon kept the
      // dark frame), while X -> photoreal and photoreal -> Y are the two edges
      // verified against the real engine — so every transition is composed of
      // exactly those, and no lever's latch can survive a switch.
      if (!photoreal && state.applied) {
        applyThemeEnvironment(
          view,
          photorealRef.current,
          sceneThemePolicy("photoreal").environment,
          state,
        );
      }
      applyThemeEnvironment(
        view,
        photorealRef.current,
        themePolicy.environment,
        state,
      );
      state.applied = !photoreal;
    }, [engineReady, sceneTheme, themePolicy]);

    // --- Sun shadows ---
    //
    // `SunLightDesc` owns the cascaded shadow maps, so the switch is a config
    // update on its handle (`{ sun: { castShadow } }`) rather than a `visible`
    // — hiding the light would take the scene's only key light with it. The
    // quality row (map size, bias, margin — see `shadowQuality.ts`) rides
    // along, re-written whole on a level change; the theme's `intensity` is
    // a separate write, which is safe because the descriptor MERGES partial
    // `sun` blocks. The engine re-allocates the maps on a live `shadowMapSize`
    // write (browser-probed: the render-time lights' `shadow.map` follows).
    useEffect(() => {
      const scene = photorealRef.current;
      if (!engineReady || scene?.sun === undefined) return;
      const sun = scene.sun;
      applyToEngine("the sun shadow toggle", () =>
        sun.update({
          sun: {
            castShadow: sunShadowsEnabled,
            ...shadowTuningFor(shadowQuality),
          },
        }),
      );
    }, [engineReady, sunShadowsEnabled, shadowQuality]);

    // --- Container resize -> engine resize ---
    //
    // The engine's own auto-resize listens on `window` ONLY (verified in the
    // 0.0.5 bundle: `window.addEventListener("resize", this._handleResize)`
    // plus a device-pixel-ratio media query). Collapsing a side panel changes
    // the CONTAINER without changing the window, so the canvas kept its old
    // width and left a blank strip — and every pick after such a change was
    // offset too, because the ray is built from `view.screenSize`, which the
    // engine only updates inside `resize()`. A ResizeObserver on the container
    // closes both: the canvas follows the layout, and `screenSize` with it.
    useEffect(() => {
      const container = containerRef.current;
      const view = viewRef.current;
      if (!engineReady || view === null || container === null) return;
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        // A collapsed shell can report 0; resizing to it would divide by zero
        // in the camera aspect and blow the render targets away for nothing.
        if (width === 0 || height === 0) return;
        // `pixelRatio` explicitly: `resize()` falls back to `1` for the WASM
        // core when the argument is omitted, which would halve the effective
        // resolution on a HiDPI display on the first panel toggle.
        view.resize(width, height, view.pixelRatio);
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, [engineReady]);

    // --- Wheel over the viewport must zoom, never scroll the page ---
    //
    // The engine's own wheel listener (on its canvas) forwards the delta to the
    // Rust core and does NOT `preventDefault()`, so the browser also scrolled
    // whatever was scrollable underneath — the page scrolled while the camera
    // zoomed. Bound on the CONTAINER, non-passive, in the bubble phase: the
    // engine's listener has already run and consumed the delta by then, so
    // cancelling the default action costs the zoom nothing.
    useEffect(() => {
      const container = containerRef.current;
      if (container === null) return;
      const onWheel = (e: WheelEvent) => e.preventDefault();
      // Touch is REDUNDANT-BUT-HARMLESS, unlike the wheel: the engine
      // preventDefaults `touchstart`, `touchend` and `touchmove` itself, so
      // this only covers the window before its listeners are bound (the engine
      // binds them during `init()`, and this effect runs on mount) and any
      // touch that lands on the container but outside the canvas.
      const onTouchMove = (e: TouchEvent) => e.preventDefault();
      container.addEventListener("wheel", onWheel, { passive: false });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      return () => {
        container.removeEventListener("wheel", onWheel);
        container.removeEventListener("touchmove", onTouchMove);
      };
      // `[]`, not `[engineReady]`: the page must not scroll while the engine is
      // still booting either.
    }, []);

    // --- FPS readout from the render loop ---
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view || !onFps) return;
      let frames = 0;
      let last = performance.now();
      const onPostRender = () => {
        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          onFps(Math.round((frames * 1000) / (now - last)));
          frames = 0;
          last = now;
        }
      };
      view.on("postRender", onPostRender);
      return () => view.off("postRender", onPostRender);
    }, [engineReady, onFps]);

    /**
     * The engine's fractional Web-Mercator zoom, or `undefined`.
     *
     * Typed `number | undefined` by the engine itself: it is derived from the
     * ellipsoid height, the field of view and the viewport, none of which
     * exist before the first rendered frame. Read through a try/catch for the
     * same reason `getCameraState` is — nothing about the pre-first-frame
     * camera is safe to touch.
     */
    const readZoom = useCallback((): number | undefined => {
      try {
        return viewRef.current?.camera.zoom;
      } catch {
        return undefined;
      }
    }, []);

    /**
     * Announce a camera the engine will NOT announce for us.
     *
     * `setCamera` emits no events (Task C7), so every instant move has to
     * publish its own pose or the compass and the scale bar go on showing the
     * one it replaced. The heading/pitch/lat are the COMMANDED values — exact,
     * and available now — while the zoom can only be read back, and the engine
     * recomputes it on its next frame; {@link requestPoseSeed} therefore asks
     * for one more publication once that frame has run.
     */
    const publishCommandedPose = useCallback(
      (state: GeographicCameraState) => {
        publishCameraPose({
          heading: state.heading,
          pitch: state.pitch,
          lat: state.lat,
          zoom: readZoom(),
        });
      },
      [readZoom],
    );

    /**
     * Set by an instant move, cleared by the next `postRender`, which
     * republishes the pose the engine actually settled on.
     *
     * A ref rather than state: the pose publisher is deliberately outside
     * React's render path (see `cameraPose.ts`), and this is its flag.
     */
    const poseSeedRef = useRef(true);
    const requestPoseSeed = useCallback(() => {
      poseSeedRef.current = true;
    }, []);

    // --- camera helpers ---
    // Bounds come from the live handles, so a fit frames the model where it is
    // actually PLACED (the geoid offset is baked into `getBoundsGeodetic`).
    // With nothing registered the union is empty and a fit is a no-op rather
    // than a jump to a NaN camera. Deps stay `[]` on purpose: `liveRef` is a
    // ref, so `fitAll`'s identity is stable and the fit-once effect below
    // cannot be re-triggered by an unrelated store update.
    // Streaming layers are in the union too — an FCB-only workspace has NOTHING
    // in `liveRef`, so reading only that map would make "Fit all" a no-op for
    // the one layer on screen. A streaming handle answers from its FCB header
    // extent as soon as it is open (Task C14) — it does NOT wait for a first
    // commit, which would be unreachable — and `null` only once deleted, which
    // `unionGeodeticBounds` already skips.
    const boundsOf = useCallback((ids?: readonly string[]) => {
      const handles: InteractionHandle[] = [];
      for (const [id, entry] of liveRef.current) {
        if (ids && !ids.includes(id)) continue;
        handles.push(entry.handle);
      }
      for (const [id, handle] of streamsRef.current) {
        if (ids && !ids.includes(id)) continue;
        handles.push(handle);
      }
      const bounds: GeodeticBounds[] = [];
      for (const handle of handles) {
        const b = handle.getBoundsGeodetic();
        if (b) bounds.push(b);
      }
      return unionGeodeticBounds(bounds);
    }, []);

    /**
     * Run a camera mutation with the streaming settle controller deaf to the
     * camera burst it produces.
     *
     * `flyTo` emits a full `movestart`/`move`/`moveend` burst (Task B1's
     * `PROGRAMMATIC_MOVE_EMITS`), and a `moveend` is exactly what commits a
     * streaming layer — so without this, restoring a share link, fitting a
     * layer or aligning the view would immediately re-fetch tiles for a camera
     * the user never moved.
     *
     * `suppressSettleThenCommit`, not the bare `suppressSettle`: suppression on
     * its own leaves a commit OWED. Every camera event of the flight is
     * swallowed, so a fit that lands squarely on a city fetches NOTHING — the
     * viewport sits framed and empty until the user happens to nudge the
     * camera (reported from the M7.5 browser smoke). The plugin queues one
     * commit for the moment the suppression window closes, which is the
     * destination the user is about to look at. That applies to all four
     * callers, not just the fit: a share-link restore and an alignment land on
     * a viewport the user reads too.
     *
     * Deliberately the REF, not `getStreamingPlugin()`: a static-only workspace
     * has no FlatCityBuf plugin and must never block a `fitAll` on streaming
     * readiness. Fire-and-forget, so the `CitySceneHandle` methods stay `void`
     * — but REPORTED, not swallowed: the move runs inside the plugin's own
     * promise, so a throwing `flyTo`/`setCamera` becomes the rejection of a
     * promise nobody awaits. Without the `.catch` that is an unhandled
     * rejection with no stack pointing here (Task C13 fold-in); the no-plugin
     * branch above, by contrast, throws synchronously into its caller.
     */
    // `move` may return the engine's `flyTo` promise, and every flight here
    // does: since Navara 0.1.0 that promise settles at the END of the flight
    // (`true`), or when a newer flight or a `setCamera` supersedes it
    // (`false`, never a rejection), so `suppressSettleThenCommit` holds the
    // gate for the whole animation and fires the owed commit `FLYTO_QUIET_MS`
    // after the camera has landed — the destination the user is looking at,
    // not a point along the way. 0.0.5's `flyTo` returned nothing, so the
    // quiet window used to start at TAKE-OFF and could expire mid-flight on a
    // long one. Returning the promise from every site, rather than `void`ing
    // it at some, is what keeps a search flight and a fit on one timing.
    const withSettleSuppressed = useCallback((move: () => unknown): void => {
      const plugin = flatPluginRef.current;
      if (!plugin) {
        move();
        return;
      }
      plugin.suppressSettleThenCommit(move).catch((error: unknown) => {
        console.error(
          "NavaraViewport: a camera move failed inside the streaming settle-suppression window.",
          error,
        );
      });
    }, []);

    /**
     * `cameraForBounds`, seen the way the active MODE demands: the fit frames
     * the bounds, but the mode owns the angle. Without this, an auto-fit (or
     * "Zoom to layer") in 2D flies to the -60° framing pitch while the mode's
     * controller flags and disabled tilt buttons stay 2D — an oblique view
     * with no control left that could tilt back out of it. Read imperatively
     * from the store so `fitAll`'s identity stays stable across mode changes
     * (the fit-once effect below depends on that).
     */
    const framedForMode = useCallback(
      (bounds: Parameters<typeof cameraForBounds>[0]) => {
        const framed = cameraForBounds(bounds);
        const policy = viewModePolicy(useViewModeStore.getState().mode);
        return entryCameraFor(policy, framed) ?? framed;
      },
      [],
    );

    const fitAll = useCallback(() => {
      const view = viewRef.current;
      const bounds = boundsOf();
      if (!view || !bounds) return;
      withSettleSuppressed(() => view.flyTo(framedForMode(bounds)));
    }, [boundsOf, framedForMode, withSettleSuppressed]);

    const fitLayer = useCallback(
      (layerId: string) => {
        const view = viewRef.current;
        const bounds = boundsOf([layerId]);
        if (!view || !bounds) return;
        withSettleSuppressed(() => view.flyTo(framedForMode(bounds)));
      },
      [boundsOf, framedForMode, withSettleSuppressed],
    );

    const fitObjects = useCallback(
      (layerId: string, objectIds: readonly string[]) => {
        if (objectIds.length === 0) return;
        const view = viewRef.current;
        const layer = layers.find((entry) => entry.id === layerId);
        if (!view || !layer) return;
        // A stream only retains cells near the camera. A missing selection must
        // stay unavailable; falling back to its header would be a whole-layer fit.
        const model = layer.isStreaming
          ? useStreamStore
              .getState()
              .streams[layerId]?.handle.getResidentModel()
          : layer.model;
        if (!model) return;
        const bbox: BBox3 | null = selectedObjectBounds(model, objectIds);
        const epsg = epsgForLayer(layer.model.metadata.referenceSystem);
        if (!bbox || epsg === null) return;
        const rawBounds = geodeticBoundsFromBBox(bbox, epsg);
        const heightOffset =
          liveRef.current.get(layerId)?.handle.heightOffset?.() ??
          streamsRef.current.get(layerId)?.heightOffset?.() ??
          0;
        const bounds: GeodeticBounds = {
          ...rawBounds,
          minHeight: rawBounds.minHeight + heightOffset,
          maxHeight: rawBounds.maxHeight + heightOffset,
        };
        withSettleSuppressed(() => view.flyTo(framedForMode(bounds)));
      },
      [framedForMode, layers, withSettleSuppressed],
    );

    const fitBounds = useCallback(
      (bounds: GeodeticBounds) => {
        const view = viewRef.current;
        if (!view) return;
        const framed = framedForMode(bounds);
        // Bounds arrive from outside the engine's own registries, so a bad box
        // must die here, not as a NaN camera the engine cannot recover from.
        if (
          !Number.isFinite(framed.lng) ||
          !Number.isFinite(framed.lat) ||
          !Number.isFinite(framed.height)
        ) {
          return;
        }
        withSettleSuppressed(() => view.flyTo(framed));
      },
      [framedForMode, withSettleSuppressed],
    );

    const alignView = useCallback(
      (direction: ViewDirection) => {
        const view = viewRef.current;
        const bounds = boundsOf();
        if (!view || !bounds) return;
        // Instant, not animated: `setCamera` emits no camera events of its own
        // (Task C7), so an alignment cannot be mistaken for a user gesture.
        // Still suppressed: the engine's `idle` fires on any change, and the
        // suppression window is what keeps it from flushing a debounce.
        const next = alignCameraForBounds(bounds, direction);
        withSettleSuppressed(() => {
          view.setCamera(next);
          // The other side of "emits no camera events": the compass listens to
          // those events, so a move that emits none has to announce itself.
          // The COMMANDED pose, not a read-back — `positionGeographic` only
          // catches up on the engine's next frame, which is also when the
          // requested seed republishes the zoom the scale bar reads.
          publishCommandedPose(next);
          requestPoseSeed();
        });
      },
      [boundsOf, publishCommandedPose, requestPoseSeed, withSettleSuppressed],
    );

    /**
     * Fly to a place — the address search's one effect on the scene.
     *
     * ANIMATED (`view.flyTo`), where the compass cluster's moves are instant:
     * a search jumps across the map, and `flyTo` emits the full
     * `movestart..moveend` chain, so the streaming layers commit for the
     * destination and the pose readout follows the flight without this having
     * to publish anything itself. Still inside the settle bracket — the
     * suppression's queued commit is what fetches the place the user is about
     * to look at, in one go rather than once per animation frame.
     *
     * The ORIENTATION comes from the view mode, never from the caller: in 2D
     * the plan pitch, in 2.5D the pinned oblique, otherwise the same -60 a fit
     * frames a model at. Heading is reset to north, because a search is a
     * "take me there", not "keep my bearing".
     */
    const flyTo = useCallback(
      (target: FlyToTarget, durationMs?: number) => {
        const view = viewRef.current;
        if (!view) return;
        if (
          !Number.isFinite(target.lng) ||
          !Number.isFinite(target.lat) ||
          !Number.isFinite(target.heightM)
        ) {
          return;
        }
        const policy = viewModePolicy(useViewModeStore.getState().mode);
        const next: GeographicCameraState = {
          lng: target.lng,
          lat: target.lat,
          height: target.heightM,
          heading: 0,
          pitch: policy.entryPitchDeg ?? SEARCH_PITCH_DEG,
          roll: 0,
        };
        withSettleSuppressed(() =>
          view.flyTo(next, { duration: durationMs ?? SEARCH_FLIGHT_MS }),
        );
      },
      [withSettleSuppressed],
    );

    // --- layer store -> engine handles ---
    // The reconciliation itself lives in `handleSync.ts` (pure, unit-tested);
    // this effect only supplies the registry binding and reports the results.
    // Streaming layers are skipped by `syncLayers` — @cityjson/navara-flatcitybuf
    // creates and owns their meshes from M7.5 on.
    useEffect(() => {
      const plugin = cityPluginRef.current;
      if (!engineReady || !plugin) return;
      const before = liveRef.current.size;
      // Read BEFORE the sync updates it below: this is the workspace as it was
      // when this effect last ran.
      const workspaceWasEmpty = previousLayerCountRef.current === 0;
      syncLayers(
        {
          get: (id) => plugin.getHandle(id),
          add: (layer) =>
            plugin.addCityModel(layer.model, {
              id: layer.id,
              crs: layer.model.metadata.referenceSystem,
              lod: layer.selectedLod,
              // Built filtered, so a restored layer never renders one frame of
              // the geometry it was saved with hidden.
              hiddenTypes: layer.hiddenTypes,
              appearance: layer.selectedAppearance,
              // Texture images are the DATASET's: a relative `image` path
              // resolves against the URL the layer came from, never against
              // the app. A local file has no URL, so its relative images
              // stay unresolved (the mesh warns once and draws colours).
              textureBaseUrl:
                layer.modelRef.type === "url" ? layer.modelRef.url : null,
            }),
        },
        layers,
        liveRef.current,
        (layerId, error) =>
          onLayerError?.(
            layerId,
            error instanceof Error ? error.message : String(error),
          ),
        // The active theme's mesh style, on the same beat as visibility and
        // LoD: a layer added while a theme is on must come up themed rather
        // than photoreal for a frame. One frozen object per theme, so this is
        // an identity check inside `syncLayers`, not a re-style per render.
        themePolicy.meshStyle,
      );
      // Rule colors, after the handles exist so a newly added layer is styled
      // on the same pass it appears (Task B14). Memoised inside — a rule edit
      // repaints only the layer whose rules changed.
      syncStyles(layers, liveRef.current);
      onTriangleCount(
        totalTriangles(layers, liveRef.current, streamsRef.current),
      );
      // The workspace count as of THIS pass, for the next one to compare
      // against. Streaming layers are rows of `layerStore` like any other
      // (`openStreamingLayer` mints one), so `layers.length` already counts
      // them — `streamsRef` would double-count.
      if (
        previousLayerCountRef.current > 0 &&
        layers.length + geoLayerCount === 0
      ) {
        // Removing every layer starts a fresh scene, even when App retains
        // the mounted viewport. Its next first layer should frame normally.
        restoredCameraRef.current = false;
      }
      previousLayerCountRef.current = layers.length + geoLayerCount;
      // Only the FIRST layer of an empty workspace earns a camera move. A
      // visibility toggle, a LoD change or a rule edit adds no handle; a second
      // file adds one, but the user has already framed a view and an automatic
      // flight would steal it — "Zoom to layer" is how they go and look at the
      // new one (Task 6, M12.1). Both halves matter: `> before` is what makes
      // this an ADD, and `workspaceWasEmpty` is what makes it the first.
      if (liveRef.current.size > before && workspaceWasEmpty) {
        setFitToken((t) => t + 1);
      }
      // `themePolicy.meshStyle` is a dependency, not a ref read: a theme change
      // has to bring this effect back so the live handles are re-styled.
      // `geoLayerCount` likewise: the count above has to stay current, or a
      // city layer landing in a geo-only workspace would read it as empty.
    }, [
      engineReady,
      layers,
      geoLayerCount,
      onTriangleCount,
      onLayerError,
      themePolicy.meshStyle,
    ]);

    // Fit once whenever the first layer of an empty workspace is added.
    // Separate from the sync effect so the fit runs after the handles exist
    // and `boundsOf` can see them.
    useEffect(() => {
      if (fitToken === 0) return;
      // ONCE per token, and consumed even when the fit is skipped below. Two
      // reasons: `boundsOf` changes when the layer bounds change, which
      // re-runs this effect on a token it has already served; and a fit
      // suppressed by a restore must be DROPPED, not left pending to fire
      // after that restore's camera has landed.
      if (handledFitTokenRef.current === fitToken) return;
      handledFitTokenRef.current = fitToken;
      // A restore adds layers to get where it is going and then sets the
      // camera it saved. Fitting to those layers would overwrite exactly that
      // camera — see `autoFitSuppression.ts` (Task C26).
      if (isAutoFitSuppressed() || restoredCameraRef.current) return;
      const view = viewRef.current;
      const bounds = boundsOf();
      if (!view || !bounds) return;
      // Initial content should appear in place, without a flight from the globe.
      const next = framedForMode(bounds);
      withSettleSuppressed(() => {
        view.setCamera(next);
        publishCommandedPose(next);
        requestPoseSeed();
      });
    }, [
      fitToken,
      boundsOf,
      framedForMode,
      withSettleSuppressed,
      publishCommandedPose,
      requestPoseSeed,
    ]);

    // --- stream store -> the interaction registry (Task C13) ---
    //
    // The streaming counterpart of the layer effect above, and the reason a
    // streamed cell can be picked, highlighted, fitted and counted at all:
    // `syncLayers` never puts a streaming layer in `liveRef` (the FlatCityBuf
    // plugin owns those meshes), so `streamsRef` is the ONLY way one reaches
    // the shared registry in `handleSync.ts`.
    useEffect(() => {
      if (!engineReady) return;
      const streams = streamsRef.current;
      const memos = streamSyncRef.current;
      const store = useStreamStore.getState();
      const unsubscribes: Array<() => void> = [];
      const present = new Set<string>();
      /**
       * A stream registered on this pass into a workspace that holds NOTHING
       * but that stream's own row — the streaming half of "only the first
       * layer of an empty workspace earns a camera move".
       */
      let fitFirstStream = false;
      /**
       * The workspace as ROWS, which is the one authority both fit producers
       * answer to (Task 22, M12.2). The static side has always counted rows
       * (`previousLayerCountRef`); this side used to count the two live
       * REGISTRIES instead, and the two disagreed in both directions:
       *
       *   * a static row whose add is still in flight — or one the engine
       *     refused — never reaches `liveRef`, so a registry test called a
       *     workspace with a visible row in it empty and flew away from it;
       *   * a geo-only workspace was invisible to it entirely.
       *
       * Read imperatively rather than from the effect's `layers`/`geoLayers`
       * closures because what matters is the workspace AT REGISTRATION: this
       * effect is re-entered by `streamIds` when an open lands, and the stores
       * are the freshest account of what the user is looking at by then.
       *
       * The stream's OWN row already exists when its handle registers
       * (`openStreamingLayer` mints the row first and registers the handle
       * only when the header lands), which is why the predicate is "one row,
       * and it is mine" rather than "no rows" — a plain emptiness test would
       * drop the very fit a first `.fcb` needs most. Any OTHER city row —
       * registered or not — means the workspace was not empty, and so does any
       * geo row.
       */
      const cityRows = useLayerStore.getState().layers;
      const geoRows = useGeoLayerStore.getState().layers;
      const isOnlyRow = (layerId: string): boolean =>
        cityRows.length === 1 &&
        cityRows[0]!.id === layerId &&
        geoRows.length === 0;

      for (const layer of layers) {
        if (!layer.isStreaming) continue;
        // The plugin opened the stream (`openStreamingLayer`), so a layer whose
        // handle is not registered yet is simply one whose open is still in
        // flight: `streamIds` brings this effect back when it lands.
        // No cast: this is where the compiler checks that the plugin's
        // `FcbStreamLayerHandle` really does satisfy the app's structural
        // `StreamInteractionHandle` — the same discipline `gatherHandles` uses
        // for the static side.
        const handle: StreamInteractionHandle | undefined = store.get(
          layer.id,
        )?.handle;
        if (!handle) continue;
        present.add(layer.id);
        if (!streams.has(layer.id) && isOnlyRow(layer.id)) {
          fitFirstStream = true;
        }
        streams.set(layer.id, handle);
        // Rules, LoD and visibility — the streaming replacement for
        // `syncLayers` + `syncStyles`, memoised per layer (`handleSync.ts`).
        syncStreamState(layer, handle, memos, themePolicy.meshStyle);
        // Cells arrive asynchronously, LONG after any store change, so the
        // triangle readout and the highlight have to be refreshed on every
        // commit — otherwise an FCB-only workspace reports its first commit's
        // count forever and cells that land while something is selected render
        // unhighlighted. Subscribed on EVERY run, not only for handles that are
        // new to the map: the cleanup below unsubscribes unconditionally, so a
        // "skip the ones already registered" shortcut would go deaf after the
        // first unrelated layer change.
        unsubscribes.push(
          handle.onCommit(() => {
            onTriangleCount(totalTriangles(layers, liveRef.current, streams));
            const selection = useSelectionStore.getState();
            // Only the committing handle, and deliberately WITHOUT the memo:
            // its highlight key has not changed — the cells under it have — so
            // a memoised push would be skipped exactly when it is needed.
            syncHighlight([handle], selection.selections, selection.hovered);
          }),
        );
      }

      // Whatever the store or the registry still holds for a layer that has
      // left `layerStore`: stop its worker, drop its cell meshes, forget it.
      // Normally `LayerPanel`/`App` have already called `closeStreamingLayer`
      // before removing the layer — this is the safety net that also keeps
      // `streamsRef` from letting `fitAll`, a pick or the triangle count read
      // a deleted handle.
      for (const id of new Set([
        ...streams.keys(),
        ...Object.keys(store.streams),
      ])) {
        if (present.has(id)) continue;
        closeStreamingLayer(flatPluginRef.current, id);
        streams.delete(id);
        memos.delete(id);
      }

      onTriangleCount(totalTriangles(layers, liveRef.current, streams));
      // The FIRST stream of an empty workspace earns the same one-off fit the
      // first static layer does — and needs it MORE: a streaming layer only
      // fetches cells once the camera is close enough for the cover to fit the
      // budget, so a `.fcb` opened into an empty viewer would otherwise sit on
      // a whole-globe camera reporting "Zoom in to load features" forever, with
      // nothing on screen to aim at. `getBoundsGeodetic` answers from the
      // header extent (plugin, Task C14), so this frames the file before a
      // single cell has arrived.
      //
      // A stream joining a workspace that already has something in it — a city
      // row, registered or not, or a geospatial overlay — does NOT fit: the
      // rule is about layers, not formats, and the camera the user arranged
      // around what is already there outranks the new file (Task 6, M12.1;
      // Task 22, M12.2). "Zoom to layer" is how they go and look at it.
      if (fitFirstStream) setFitToken((t) => t + 1);
      return () => {
        for (const off of unsubscribes) off();
      };
    }, [
      engineReady,
      layers,
      streamIds,
      onTriangleCount,
      themePolicy.meshStyle,
    ]);

    // --- streaming fetch bbox -> a ground outline + a readout (diagnostic) ---
    //
    // A `.fcb` layer fetches whatever falls inside a rectangle derived from the
    // four viewport corner rays, and that rectangle is invisible: you cannot
    // tell an over-fetch from an under-fetch by looking at the scene. This
    // effect draws it.
    //
    // The region is NOT recomputed here. `onQueryRegion` publishes the very
    // footprint the plugin's `probe`/`fetch` messages carried (its
    // `viewportFootprint` result), so the outline is the query by construction
    // rather than by agreement — a second, app-side derivation from the camera
    // would be free to drift from the one that actually fetched.
    //
    // Gated on the toggle at the TOP, not per draw: with the diagnostic off
    // this subscribes to nothing, adds nothing and writes to no store, so it
    // costs a dependency check per layer change and nothing else. That is also
    // what makes the cleanup the single removal path — flipping the toggle off,
    // closing the layer, and tearing the engine down all run the same code.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null || !queryBoxEnabled) return;
      const store = useStreamStore.getState();
      const regionStore = useQueryRegionStore.getState();
      const meshes = new Map<string, QueryBoxMesh>();
      const unsubscribes: Array<() => void> = [];

      const drop = (layerId: string): void => {
        const mesh = meshes.get(layerId);
        if (!mesh) return;
        meshes.delete(layerId);
        applyToEngine("the streaming query box removal", () => mesh.delete());
      };

      /** One layer's outline, replaced in place. The descriptor has an
       *  `update` path, but a rebuild is the honest operation here: the ring
       *  changes wholesale on every commit, and this happens once per camera
       *  settle, not per frame. */
      const draw = (layerId: string, region: QueryRegion | null): void => {
        drop(layerId);
        if (region === null) {
          regionStore.clearRegion(layerId);
          return;
        }
        const mesh = addQueryBox(view, region);
        // `null` = the engine refused. Nothing is on screen, so nothing may
        // claim to be: the readout follows what was drawn, exactly as the
        // attribution overlay follows what was added.
        if (mesh === null) {
          regionStore.clearRegion(layerId);
          return;
        }
        meshes.set(layerId, mesh);
        regionStore.setRegion(region);
      };

      for (const layer of layers) {
        if (!layer.isStreaming) continue;
        const handle: StreamInteractionHandle | undefined = store.get(
          layer.id,
        )?.handle;
        if (!handle) continue;
        // The region already known, before any new commit: switching the
        // diagnostic on mid-session must show the CURRENT box rather than
        // stay blank until the user next moves the camera.
        draw(layer.id, handle.lastQueryRegion());
        unsubscribes.push(
          handle.onQueryRegion((region) => draw(layer.id, region)),
        );
      }

      return () => {
        for (const off of unsubscribes) off();
        // `viewRef.current === view` for the same reason the tiles and basemap
        // effects check it: on unmount the engine is disposed first
        // (declaration order), and deleting through a dead view would throw.
        if (viewRef.current === view) {
          for (const mesh of meshes.values()) {
            applyToEngine("the streaming query box removal", () =>
              mesh.delete(),
            );
          }
        }
        meshes.clear();
        regionStore.clear();
      };
      // `layers` + `streamIds`: a stream whose open lands after its layer
      // appeared has to be picked up, and a closed layer's outline has to go.
    }, [engineReady, queryBoxEnabled, layers, streamIds]);

    // --- solar: the atmosphere's clock, and the sun it reports back ---
    //
    // Task C16. Four seams, in the order the data flows:
    //
    //   the loaded layers -> `solarStore.latLon`      (which site the sun is read at)
    //   `solarStore.datetime` -> `atmosphere.date`    (a user edit, a restored link)
    //   the render loop -> `atmosphere.date` + a throttled `setDatetime`
    //   `sunChanged` -> `solarStore.setSunPosition`   (in the site's ENU frame)
    //
    // The animation deliberately does NOT run on React state. At 60 fps a
    // `useState` clock would re-render this component — and re-run the engine
    // bindings hanging off it — every frame; the loop writes the atmosphere
    // imperatively and publishes to the store on a ~10 Hz beat instead, which
    // is the only rate any readout can be read at anyway.

    /** The date the atmosphere is currently showing. The animation's
     *  accumulator: while the clock runs it is AHEAD of
     *  `solarStore.datetime`, which only catches up on the sync beat. */
    const datetimeRef = useRef<Date>(useSolarStore.getState().datetime);
    /** The exact `Date` this component last put INTO the store, so the
     *  subscription below can tell its own echo from a real edit. */
    const publishedDatetimeRef = useRef<Date | null>(null);
    /** Publishes the engine's current sun direction into the store — null
     *  until there is a site to read it at. */
    const publishSunRef = useRef<(() => void) | null>(null);

    // The site the sun readout speaks for: the centre of everything loaded.
    // Derived from the live handles' geodetic bounds rather than a model's
    // CRS + bbox (the retired `CitySceneR3F` called `solarStore`'s
    // `initFromModel` here; that action and its proj4 reprojection are gone),
    // because bounds are the one source a STREAMING layer has too — its FCB
    // header extent, Task C14 — and they need no reprojection.
    const latLon = useSolarStore((s) => s.latLon);
    useEffect(() => {
      if (!engineReady) return;
      const bounds = boundsOf();
      const next =
        bounds === null
          ? null
          : {
              lat: (bounds.south + bounds.north) / 2,
              lon: (bounds.west + bounds.east) / 2,
            };
      const current = useSolarStore.getState().latLon;
      // Value comparison, not identity: this effect re-runs on every layer
      // change, and publishing a fresh object per run would rebuild the ENU
      // frame — and re-subscribe the sun writer — on a visibility toggle.
      if (current === null && next === null) return;
      if (
        current !== null &&
        next !== null &&
        current.lat === next.lat &&
        current.lon === next.lon
      ) {
        return;
      }
      useSolarStore.getState().setLatLon(next);
    }, [engineReady, layers, streamIds, boundsOf]);

    /** The site's ENU frame. Rebuilt only when the site itself moves. */
    const siteFrame = useMemo(
      () => (latLon === null ? null : siteEnuFrame(latLon)),
      [latLon],
    );

    // --- The scene theme's volumetric neon (`fogLight`) ---
    //
    // The DIFFUSION half of the cyber look: point lights whose glow is
    // integrated along the view ray, so the neon bleeds into the air instead of
    // stopping at the geometry. It lives apart from `applyThemeEnvironment`
    // because it is the one theme lever that depends on the DATA — the lights
    // are scattered over the bounds of what is loaded, so it has to be declared
    // after `boundsOf` and re-run when the layers change.
    //
    // Add-once-then-toggle, exactly like the theme's two meshes: `visible` is
    // the composer's enable flag, while a delete/re-add per theme switch would
    // pay for the pass (and leak it — Known Issue (f) is about effects
    // specifically).
    //
    // With nothing loaded there is nothing to light: the effect is never
    // created in the first place, and an existing one is hidden.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      const state = themeEnvRef.current;
      const spec = themePolicy.environment.fogLights;
      const bounds = spec === null ? null : boundsOf();
      const existing = state.fogLight;

      if (spec === null || bounds === null) {
        if (existing === null) return;
        applyToEngine("the theme's fog lights", () => {
          existing.visible = false;
        });
        return;
      }

      const sites = themeFogLightSites(spec, bounds);
      const key = `${spec.count}:${spec.radius}:${spec.fogDensity}:${bounds.west},${bounds.south},${bounds.east},${bounds.north},${bounds.minHeight}`;
      let lights: unknown[];
      try {
        lights = sites.map((site) => ({
          // DEGREES: since Navara 0.1.0 every geodetic helper takes and
          // returns degrees (`flyTo` and `camera.positionGeographic` always
          // did); the radian conversion 0.0.5 needed here is gone.
          position: geodeticToVector3({
            lng: site.lng,
            lat: site.lat,
            height: site.height,
          }),
          color: site.color,
          intensity: site.intensity,
          radius: site.radius,
        }));
      } catch (error) {
        console.error(
          "NavaraViewport: the theme's fog lights could not be placed; the scene renders without them.",
          error,
        );
        return;
      }

      // `useSurfaceLighting: false`, deliberately. The pass's surface term
      // reads the MRT normal attachment, and our city meshes render in
      // `scenes.opaque` without writing it (the scene-themes design's engine
      // audit) — so at exactly the pixels this look is about, that term would
      // be lit by whatever the globe last wrote there. The volumetric term
      // needs no normals at all, and it is the one we came for.
      const config = {
        fogLight: {
          lights,
          fogDensity: spec.fogDensity,
          useSurfaceLighting: false,
        },
      };

      if (existing === null) {
        try {
          state.fogLight = view.addEffect(
            config as never,
          ) as unknown as ThemeEffect;
          state.fogLightKey = key;
        } catch (error) {
          // Neon in the air is decoration, like the clouds: a backend that
          // cannot afford the pass must still leave a working viewer.
          console.error(
            "NavaraViewport: the theme's fog-light effect could not be added; the scene renders without it.",
            error,
          );
        }
        return;
      }

      applyToEngine("the theme's fog lights", () => {
        // Only when the light set actually moved. This effect re-runs on every
        // layer-store edit, and re-uploading 14 identical lights rebuilds the
        // pass's light textures for a rename.
        if (state.fogLightKey !== key) {
          existing.update(config);
          state.fogLightKey = key;
        }
        existing.visible = true;
      });
    }, [engineReady, themePolicy, boundsOf, layers, streamIds]);

    // --- Precipitation ---
    //
    // Rain and snow are MESHES in Navara, not effects: each is a volume of
    // particles around a point (`RainMeshDesc` / `SnowMeshDesc`), so unlike
    // the clouds they need somewhere to fall. That somewhere is the site — the
    // same centre the sun is read at — lifted to the top of what is loaded so
    // the volume covers the roofs rather than starting inside them.
    //
    // Consequently there is nothing to add until a layer has been placed:
    // with no site, precipitation is simply off, which is also why this hangs
    // off `latLon` rather than being added once at init.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      if (precipitation === "none" || latLon === null) return;
      const bounds = boundsOf();
      // A hair above the tallest thing loaded, so the particles fall PAST the
      // model. Falling back to the site's own height would start them at the
      // ellipsoid, i.e. tens of metres underground here.
      const height = (bounds?.maxHeight ?? 0) + PRECIPITATION_HEIGHT_M;
      let mesh: { delete: () => void } | null = null;
      try {
        // Degrees in, as everywhere in the 0.1.x API.
        const position = geodeticToVector3({
          lng: latLon.lon,
          lat: latLon.lat,
          height,
        });
        mesh = view.addMesh(
          precipitation === "rain"
            ? { position, rain: {} }
            : { position, snow: {} },
        ) as unknown as { delete: () => void };
      } catch (error) {
        // Weather is decoration: a backend that cannot afford the particle
        // pass must still leave a working viewer, exactly as the clouds do.
        console.error(
          `NavaraViewport: the ${precipitation} mesh could not be added; the scene stays dry.`,
          error,
        );
        return;
      }
      return () => {
        if (viewRef.current !== view) return;
        applyToEngine(`the ${precipitation} mesh removal`, () =>
          mesh?.delete(),
        );
      };
    }, [engineReady, precipitation, latLon, boundsOf]);

    // `sunChanged` -> the store, in the site's local ENU frame.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;
      if (siteFrame === null) {
        // Nothing loaded: the last model's sun must not linger in the readout.
        if (useSolarStore.getState().sunPosition !== null) {
          useSolarStore.getState().setSunPosition(null);
        }
        return;
      }
      const atmosphere = view.atmosphere;
      const publish = () => {
        useSolarStore
          .getState()
          .setSunPosition(
            sunPositionFromEcef(siteFrame, atmosphere.getSunDirection()),
          );
      };
      publishSunRef.current = publish;
      // Once, immediately: the engine emits `sunChanged` only when the date
      // moves, so a site that appears afterwards — the usual case, a file
      // dropped into a running engine — would otherwise leave every solar
      // readout empty until the user touched the clock.
      publish();
      const onSunChanged = () => {
        // While the clock runs, the loop below publishes on its own beat:
        // `sunChanged` fires once per frame, and a store write per frame is a
        // re-render of the toolbar, the solar tab and the analysis tab per
        // frame.
        if (useSolarStore.getState().timeAnimating) return;
        publish();
      };
      atmosphere.on("sunChanged", onSunChanged);
      return () => {
        atmosphere.off("sunChanged", onSunChanged);
        publishSunRef.current = null;
      };
    }, [engineReady, siteFrame]);

    // `solarStore.datetime` -> `atmosphere.date`, for every change this
    // component did not make itself.
    //
    // A store SUBSCRIPTION rather than `useSolarStore((s) => s.datetime)`:
    // the loop publishes ten times a second, and a selector would re-render
    // the whole viewport at that rate for a value it only ever hands to the
    // engine.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;
      const push = (datetime: Date) => {
        // Our own publication coming back around. The atmosphere is already
        // showing this date — or a LATER one, since the loop runs ahead of the
        // store between beats — so writing it back would rewind the sun by up
        // to one beat every time the clock ticks.
        if (datetime === publishedDatetimeRef.current) return;
        datetimeRef.current = datetime;
        view.atmosphere.date = datetime;
      };
      // The engine starts on its own default date (the real clock), so the
      // store's datetime has to be pushed once as soon as there is a view —
      // including the one a share link restored before the engine came up.
      push(useSolarStore.getState().datetime);
      return useSolarStore.subscribe((state, previous) => {
        if (state.datetime !== previous.datetime) push(state.datetime);
      });
    }, [engineReady]);

    // The animation itself: one `preUpdate` subscription for the lifetime of
    // the engine, driving the atmosphere directly.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;
      /** The previous frame's timestamp, or null before there has been one. */
      let previous: number | null = null;
      let lastSync = 0;
      /** Whether the clock was running on the previous frame. */
      let running = false;

      const publishDatetime = (datetime: Date) => {
        publishedDatetimeRef.current = datetime;
        useSolarStore.getState().setDatetime(datetime);
        // The sun belongs to the same beat: `sunChanged` is ignored while the
        // clock runs, so this is what moves the altitude/azimuth readout.
        publishSunRef.current?.();
      };

      // `now` is the engine's own `DOMHighResTimeStamp` (`setAnimationLoop`),
      // i.e. the same clock as `performance.now()` — and, being an argument,
      // the seam a test drives the animation through.
      const onPreUpdate = (now: number) => {
        const last = previous;
        previous = now;
        const solar = useSolarStore.getState();
        if (!solar.timeAnimating) {
          if (running) {
            running = false;
            // A pause lands between beats, so the store can be up to 100 ms of
            // wall clock — six minutes of sun at 3600x — behind the date the
            // atmosphere is showing. Publish the animation's last value so the
            // clock the user reads matches the sky they are looking at.
            publishDatetime(datetimeRef.current);
          }
          return;
        }
        if (!running) {
          running = true;
          lastSync = now;
        }
        // First frame after subscribing: no previous timestamp, so no delta.
        if (last === null) return;
        const step = advanceTime(
          datetimeRef.current,
          (now - last) / 1000,
          solar.timeSpeed,
          now - lastSync,
        );
        datetimeRef.current = step.next;
        view.atmosphere.date = step.next;
        if (step.shouldSyncStore) {
          lastSync = now;
          publishDatetime(step.next);
        }
      };

      view.on("preUpdate", onPreUpdate);
      return () => view.off("preUpdate", onPreUpdate);
    }, [engineReady]);

    // --- selection / hover -> handle.setHighlight ---
    // Subscribed as state (not read from `getState()`) because a selection made
    // anywhere else in the app — the inspector, a share link restore, box
    // select — has to repaint too, not just one made by a click in here.
    const selections = useSelectionStore((s) => s.selections);
    const hovered = useSelectionStore((s) => s.hovered);
    /** The geo half of the same subscription. Mutually exclusive with
     *  `selections` in the store, so at most one of the two repaints. */
    const geoSelection = useSelectionStore((s) => s.geoSelection);
    /** What each live handle was last told. Keyed by handle identity, so a
     *  deleted layer's entry disappears with it and a re-added layer's fresh
     *  handle is always pushed to. */
    const highlightMemoRef = useRef<HighlightMemo>(new WeakMap());
    useEffect(() => {
      if (!engineReady) return;
      syncHighlight(
        // ALL handles, hidden layers included: highlight outlives a visibility
        // toggle, and each handle filters the array by its own layerId.
        allInteractionHandles(layers, liveRef.current, streamsRef.current),
        selections,
        hovered,
        // Hovering a building in one layer must not repaint the others:
        // `setHighlight` recolors the whole layer, and this effect runs on
        // every hover step.
        highlightMemoRef.current,
      );
      // The geospatial half. Its own memo lives on each live entry
      // (`highlightedBatchId`), so an unchanged layer costs one comparison and
      // no engine call — and the SAME factory identity is handed over as the
      // geo sync effect uses, because `geoLayerSync` keeps it on the entry to
      // re-apply through when the engine recreates a feature set.
      syncGeoHighlight(geoSelection, geoLiveRef.current, makeEngineColor);
      syncGeoFeatureVisibility(
        geoVisibleFeatureIds,
        geoLiveRef.current,
        makeEngineColor,
      );
      // `streamIds`: a handle that joins the registry AFTER its layer appeared
      // (the open resolves a tick later) must be told the current selection,
      // not only whatever arrives next. The memo is keyed by handle identity,
      // so this costs one push per newly opened stream and nothing else.
    }, [
      engineReady,
      layers,
      streamIds,
      selections,
      hovered,
      geoSelection,
      geoVisibleFeatureIds,
    ]);

    // --- engine pointer events -> pick intents + the cursor readout ---
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;

      // ONE registry for interaction. In Part B it only ever holds static
      // handles; Task C13 fills `streamsRef` and this same closure then picks
      // and highlights streamed cells with no further change here. Rebuilt per
      // event rather than captured: `liveRef` mutates in place, and a captured
      // array would go stale the moment a layer is added.
      const handles = () =>
        interactionHandles(layers, liveRef.current, streamsRef.current);

      /**
       * Screen point -> ECEF ray.
       *
       * `getPickRay` is a free function taking a `{width, height, pixelRatio}`
       * window-like and the raw three camera (Task B1 finding 5). It measures
       * from the CANVAS' top-left, which is why every caller below goes through
       * `canvasPointOf` rather than the event's `clientX`/`clientY`.
       */
      const rayAt = (point: ScreenPoint): EcefRay | null => {
        const size = view.screenSize;
        return getPickRay(
          { width: size.x, height: size.y, pixelRatio: view.pixelRatio },
          view.camera.raw,
          new Vector2(point.x, point.y),
        );
      };

      const pickAt = (point: ScreenPoint) => {
        const ray = rayAt(point);
        return ray ? resolveNearestHit(handles(), ray) : null;
      };

      // ~15 Hz, the old app's inline `performance.now()` gate. Hover is NOT
      // throttled — it is what makes the highlight follow the pointer — but the
      // readout costs a depth read plus a proj4 transform, and the status bar
      // cannot show more than this anyway.
      const throttleCursor = createThrottle(66);
      const clickGate = createClickGate();

      const reportCursor = (point: ScreenPoint) => {
        if (!onCursorPosition) return;
        throttleCursor(() => {
          const ecef = view.pickDepthPosition(point.x, point.y);
          if (!ecef) {
            // Nothing rendered under the cursor at all (the sky). Not a
            // ground-plane fallback: the engine's depth read already answers
            // with the globe surface wherever the terrain is drawn.
            onCursorPosition(null);
            return;
          }
          // Status coordinates are always WGS84, including terrain with no
          // city layer. Do not reuse the source-CRS cursor conversion here.
          const lle = vector3ToGeodetic(ecef);
          onCursorPosition([lle.lng, lle.lat, lle.height]);
        });
      };

      /**
       * The last pointermove the ENGINE reported, by object identity.
       *
       * `convertToMapEvent` `Object.assign`s `{ map }` onto the very DOM
       * `PointerEvent` it received and returns `null` when the screen ray
       * misses the ellipsoid — so the object the engine emits IS the object our
       * own DOM listener sees afterwards (the engine binds to the canvas, we
       * bind to its parent, so bubbling puts the engine first). Comparing them
       * is therefore an exact "did the engine handle this move?" test — which
       * is also why the container MUST listen to `pointermove`, not
       * `mousemove`: the compatibility mouse event the browser synthesises
       * after a pointer event is a DIFFERENT object, and comparing against it
       * would read every move as "sky".
       */
      let lastEngineMove: unknown = null;

      /** Nothing is under the cursor: drop the hover and the readout. */
      const clearCursorState = () => {
        const store = useSelectionStore.getState();
        if (store.hovered !== null) store.hover(null);
        onCursorPosition?.(null);
      };

      /**
       * The engine's own pick pass — the ONLY way a geospatial feature can be
       * hit, because those layers are drawn by the engine and the app has no
       * geometry of its own to raycast.
       *
       * Stashed rather than acted on: `pick` carries no gesture and the engine
       * emits it for everything it draws (terrain and basemap tiles included),
       * so what it means is decided on the `click` that follows, against the
       * live geo registry. `null` from the engine means "nothing was hit",
       * which is a stash worth keeping as `null` — the click then falls
       * through to the ordinary clear.
       */
      const onEnginePick = (info: PickedFeature | null | undefined) => {
        geoPickStashRef.current =
          info === null ||
          info === undefined ||
          typeof info.batchId !== "number"
            ? null
            : {
                engineLayerId: info.layerId,
                batchId: info.batchId,
                properties: info.properties,
              };
      };

      const onPointerDown = (e: PointerEvent) => {
        // A new gesture: whatever the last one picked is no longer the answer.
        geoPickStashRef.current = null;
        clickGate.down(canvasPointOf(e));
      };

      const onPointerMove = (e: PointerEvent) => {
        if (useDrawStore.getState().active) return;
        lastEngineMove = e;
        const point = canvasPointOf(e);
        clickGate.move(point);
        const store = useSelectionStore.getState();
        // Gate on the tool BEFORE resolving: a measure-mode move must not cost
        // a raycast across every layer.
        if (!acceptsPointer(store.toolMode, "move")) {
          reportCursor(point);
          return;
        }
        const hit = narrowToMode(pickAt(point), store.mode);
        // Every resolved pick is a fresh object, so pushing it unconditionally
        // would change `hovered` on every mousemove and repaint every layer's
        // vertex colors at pointer rate.
        if (!sameSelection(store.hovered, hit)) {
          applyPickIntent(
            pickIntentFor({ type: "move", shiftKey: false }, hit),
            store,
          );
        }
        reportCursor(point);
      };

      const onClick = (e: PointerEvent) => {
        if (useDrawStore.getState().active) return;
        const store = useSelectionStore.getState();
        if (!acceptsPointer(store.toolMode, "click")) return;
        // Since 0.1.1 the engine's `click` is a GESTURE (a primary-pointer
        // press and release within `CLICK_PIXEL_TOLERANCE`), no longer the raw
        // DOM click that used to fire at the end of every camera orbit. The
        // gate mirrors that tolerance and is kept as defence in depth: a click
        // whose press this component never saw (a `pointercancel` in between,
        // a gesture begun over the sky) must not commit a selection.
        if (!clickGate.isClean()) return;
        const hit = narrowToMode(pickAt(canvasPointOf(e)), store.mode);
        // CONSUMED, whatever happens next: one engine pick belongs to one
        // gesture, and leaving it behind would let the click after it re-select
        // a feature the pointer has long moved off.
        const stash = geoPickStashRef.current;
        geoPickStashRef.current = null;
        // A city hit WINS: it comes from our own raycast against real geometry
        // at the exact click point, while the engine's pick is a colour read
        // that also fires for the ground under it. The store's own invariant
        // then clears any geo selection, so nothing here has to.
        //
        // No shift-toggle for a geo feature: geo selection is single, so a
        // shift+click falls through to the ordinary intent (a clear) rather
        // than pretending to extend something that cannot be extended.
        if (hit === null && e.shiftKey !== true) {
          const geo = geoSelectionFromStash(stash, (engineLayerId) =>
            geoLayerIdForEngineLayerId(geoLiveRef.current, engineLayerId),
          );
          if (geo !== null) {
            store.selectGeoFeature(geo);
            return;
          }
        }
        applyPickIntent(
          pickIntentFor({ type: "click", shiftKey: e.shiftKey === true }, hit),
          store,
        );
      };

      /**
       * SKY DETECTOR, and the reason the DOM listeners below exist at all.
       *
       * The engine emits NO pointer event — not `pointermove`, not even
       * `pointerleave` — when the screen ray misses the ellipsoid, because
       * `convertToMapEvent` returns null and the emit is skipped (still true on
       * 0.1.1). Relying on engine events alone therefore freezes the hover
       * highlight and the status bar at their last on-globe values the moment
       * the cursor moves onto the sky, and leaves them frozen if the pointer
       * exits the canvas across a sky pixel.
       *
       * The DOM always fires, so the container listens too: a move the engine
       * did NOT claim is a move over the sky. POINTER events, for the identity
       * test documented on `lastEngineMove` — and because the engine itself
       * moved to pointer events in 0.1.1 (touch included), so listening to
       * the mouse compatibility events here would miss every touch gesture.
       */
      const onDomPointerMove = (e: PointerEvent) => {
        // Feed the drag gate from here as well: a gesture that starts or moves
        // over the sky is invisible to the engine, and a stale gate would let
        // the click that ends it commit a selection.
        clickGate.move(canvasPointOf(e));
        if (lastEngineMove === e) return;
        clearCursorState();
      };
      const onDomPointerDown = (e: PointerEvent) => {
        geoPickStashRef.current = null;
        clickGate.down(canvasPointOf(e));
      };
      // Leaving the canvas: unconditional, and the one case the engine's own
      // `pointerleave` cannot be trusted for.
      const onDomPointerLeave = () => clearCursorState();
      // The browser took the gesture over (a scroll, a system gesture, an app
      // switch): the engine drops its pending click, and so must the gate —
      // otherwise the next `click` the engine emits could ride on a press this
      // component saw before the cancellation.
      const onDomPointerCancel = () => {
        geoPickStashRef.current = null;
        clickGate.cancel();
      };

      // The two pick paths are COMPLEMENTARY, and each covers what the other
      // cannot.
      //
      // City meshes stay on the own-raycast path (PICK_PATH = "own-raycast",
      // Task B1): `PickableMeshWrapper` allocates ONE batch id per mesh, so the
      // engine's pick could only ever name a layer, never the surface inside
      // it. Geospatial layers are the mirror image — the engine draws them, the
      // app has no geometry to raycast, and the engine's per-feature batch id
      // is exactly the granularity they need. So `featureClick` (0.1.0's name
      // for the old `pick`; the hover variants are deliberately NOT subscribed
      // — each costs a GPU pick per frame and re-bakes the draped atlases) is
      // subscribed, but only ever STASHED: the click below decides, and a city
      // hit wins outright.
      //
      // ORDER, which the stash depends on: the engine's `PickHelper` binds its
      // `pointerup` listener before the view's own, and its click pick is
      // synchronous, so `featureClick` always arrives BEFORE the `click` of
      // the same gesture. Both are gated by the same `CLICK_PIXEL_TOLERANCE`
      // (5 px; 30 for touch), which `CLICK_DRAG_TOLERANCE_PX` mirrors — the
      // 0.0.5 asymmetry, where the engine's pick had zero tolerance and a 1 px
      // jitter cleared a geo selection while still selecting a city object, is
      // gone.
      view.on("featureClick", onEnginePick);
      view.on("pointerdown", onPointerDown);
      view.on("pointermove", onPointerMove);
      view.on("click", onClick);

      const host = containerRef.current;
      host?.addEventListener("pointermove", onDomPointerMove);
      host?.addEventListener("pointerdown", onDomPointerDown);
      host?.addEventListener("pointerleave", onDomPointerLeave);
      host?.addEventListener("pointercancel", onDomPointerCancel);

      return () => {
        // `featureClick` included: this effect re-runs on every city-layer
        // edit, and a handler left behind would accumulate one per edit.
        view.off("featureClick", onEnginePick);
        view.off("pointerdown", onPointerDown);
        view.off("pointermove", onPointerMove);
        view.off("click", onClick);
        host?.removeEventListener("pointermove", onDomPointerMove);
        host?.removeEventListener("pointerdown", onDomPointerDown);
        host?.removeEventListener("pointerleave", onDomPointerLeave);
        host?.removeEventListener("pointercancel", onDomPointerCancel);
      };
    }, [engineReady, layers, onCursorPosition]);

    const getCameraState = useCallback((): GeographicCameraState | null => {
      const view = viewRef.current;
      if (!view) return null;
      try {
        const { lng, lat, height } = view.camera.positionGeographic;
        const { heading, pitch, roll } = view.camera.orientation;
        if (
          heading === undefined ||
          pitch === undefined ||
          roll === undefined
        ) {
          return null;
        }
        return { lng, lat, height, heading, pitch, roll };
      } catch {
        // BROWSER-VERIFIED, not defensive padding: `positionGeographic`
        // throws a bare "Invariant failed" until the engine has wired the
        // camera to its Rust core, which happens on the first rendered frame —
        // AFTER `view.init()` resolves. A snapshot taken in that window (C20's
        // autosave, a share-link capture) must report "no camera yet", not
        // take the caller down.
        return null;
      }
    }, []);

    const setCameraState = useCallback(
      (state: GeographicCameraState) => {
        const view = viewRef.current;
        if (!view) return;
        restoredCameraRef.current = true;
        // A restore is the sharpest case of a move that is not a gesture:
        // without the bracket, reopening a share link would re-fetch tiles for
        // a camera the user never touched.
        withSettleSuppressed(() => {
          view.setCamera(state);
          // `setCamera` emits no camera events, so the compass would otherwise
          // keep showing the heading the restored link replaced.
          publishCommandedPose(state);
          requestPoseSeed();
        });
      },
      [publishCommandedPose, requestPoseSeed, withSettleSuppressed],
    );

    // --- the camera's live pose -> the compass overlay ---
    //
    // EVENT-DRIVEN, not a per-frame poll: the engine emits `movestart`/`move`/
    // `moveend` on `view.camera` for every gesture and for `flyTo`'s animated
    // flight, and the moves that emit NOTHING (`setCamera`, Task C7) publish
    // themselves at their call sites above. The `move` stream is throttled to
    // {@link POSE_PUBLISH_MS} — the same ~10 Hz beat the solar animation
    // publishes on, and faster than a dial can be read — with `moveend`
    // publishing unthrottled so the compass settles on the exact final heading
    // rather than on whatever the last beat caught.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      const camera = view.camera;
      const publish = () => {
        const state = getCameraState();
        publishCameraPose(state === null ? null : posed(state));
      };
      const posed = (state: GeographicCameraState) => ({
        heading: state.heading,
        pitch: state.pitch,
        // The scale bar's two inputs, published on the same beat rather than
        // through a second engine subscription of their own.
        lat: state.lat,
        zoom: readZoom(),
      });
      const throttled = createThrottle(POSE_PUBLISH_MS);
      const onMove = () => throttled(publish);

      // The FIRST pose, and every pose after a move that emitted no events.
      // `positionGeographic` throws until the engine has wired the camera to
      // its Rust core on the first rendered frame (see `getCameraState`),
      // which is after `view.init()` resolves — so reading it here would
      // answer null and leave the compass idle until the user moved the
      // camera. `postRender` is the cheapest hook guaranteed to run after that
      // moment. It publishes only while a seed is OWED (`poseSeedRef`), which
      // is what makes an instant move's read-back — a zoom button changes the
      // height, and the engine recomputes `camera.zoom` a frame later — reach
      // the scale bar without polling every frame.
      const onPostRender = () => {
        if (!poseSeedRef.current) return;
        const state = getCameraState();
        if (state === null) return;
        poseSeedRef.current = false;
        publishCameraPose(posed(state));
      };

      view.on("postRender", onPostRender);
      camera.on("movestart", publish);
      camera.on("move", onMove);
      camera.on("moveend", publish);
      return () => {
        view.off("postRender", onPostRender);
        camera.off("movestart", publish);
        camera.off("move", onMove);
        camera.off("moveend", publish);
        // The camera died with the engine; a dial still reading its last
        // heading would be a readout for a scene that is gone.
        publishCameraPose(null);
      };
    }, [engineReady, getCameraState, readZoom]);

    /**
     * The view mode, applied to the engine.
     *
     * Two halves, and only the second is conditional:
     *
     *   1. the CONTROLLER FLAGS, every time — including on mount, because a
     *      restored 2D workspace whose camera can still be orbited is not in
     *      2D at all;
     *   2. the ENTRY FLIGHT, only on a real change. A snapshot restore sets
     *      the mode and then applies the camera it saved; flying on mount
     *      would fight that restore and throw the saved viewpoint away. The
     *      ref is what tells "the user pressed 2D" apart from "we came up in
     *      2D".
     */
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || view === null) return;
      const policy = viewModePolicy(viewMode);
      view.camera.options = {
        enableSpin: policy.enableSpin,
        // A zero duration also disables manual spin in Navara.
        spinDuration: 1,
        enableTilt: policy.enableTilt,
      };

      const wasMounted = viewModeAppliedRef.current;
      viewModeAppliedRef.current = true;
      if (!wasMounted) return;

      const current = getCameraState();
      if (current === null) return;
      const entry = entryCameraFor(policy, current);
      if (entry === null) return;
      withSettleSuppressed(() =>
        view.flyTo(entry, { duration: VIEW_MODE_ENTRY_MS }),
      );
    }, [engineReady, viewMode, getCameraState, withSettleSuppressed]);

    /**
     * Apply an instant, pivot-preserving camera change from the compass or the
     * map-control cluster.
     *
     * `setCamera`, not `flyTo`: these are nudges, and an animated flight would
     * both lag the click and emit a camera burst per press. Bracketed by
     * {@link withSettleSuppressed} like every other programmatic move — a zoom
     * or a tilt is not a gesture, and without the bracket each click would
     * re-trigger a FlatCityBuf fetch as though the user had panned. The pose is
     * published from inside the bracket for the same reason `alignView` does it:
     * `setCamera` emits no camera events to publish it for us.
     */
    const nudgeCamera = useCallback(
      (derive: (state: GeographicCameraState) => GeographicCameraState) => {
        const view = viewRef.current;
        const current = getCameraState();
        // No camera yet: the buttons are disabled in that state anyway, so this
        // is the belt to that braces.
        if (view === null || current === null) return;
        const next = derive(current);
        withSettleSuppressed(() => {
          view.setCamera(next);
          publishCommandedPose(next);
          requestPoseSeed();
        });
      },
      [
        getCameraState,
        publishCommandedPose,
        requestPoseSeed,
        withSettleSuppressed,
      ],
    );

    const zoomIn = useCallback(
      () => nudgeCamera((s) => zoomedCamera(s, ZOOM_IN_FACTOR)),
      [nudgeCamera],
    );
    const zoomOut = useCallback(
      () => nudgeCamera((s) => zoomedCamera(s, ZOOM_OUT_FACTOR)),
      [nudgeCamera],
    );
    const resetNorth = useCallback(
      () => nudgeCamera(northedCamera),
      [nudgeCamera],
    );

    /**
     * Hand the FlatCityBuf plugin out, once there is one.
     *
     * Awaiting `ready` is what turns the old `fcbPluginRef.current!` race — a
     * share hash processed on the first render, when the ref is still null —
     * into a queue. It REJECTS if the engine failed (Shared Interface Contract
     * -> `ready`) or if the plugin itself could not be built, so a caller gets
     * an error it can toast rather than a promise that never settles.
     */
    const getStreamingPlugin =
      useCallback(async (): Promise<FlatCityBufPlugin> => {
        await readyRef.current!.promise;
        const plugin = flatPluginRef.current;
        if (plugin) return plugin;
        const cause = flatPluginErrorRef.current;
        throw new Error(
          "FlatCityBuf streaming is unavailable in this session, so a .fcb layer cannot be opened" +
            (cause instanceof Error ? `: ${cause.message}` : "."),
          cause === null ? undefined : { cause },
        );
      }, []);

    const captureImage = useCallback((credits: readonly string[]) => {
      const view = viewRef.current;
      const canvas = containerRef.current?.querySelector("canvas");
      if (!view || !canvas)
        return Promise.reject(new Error("The scene is not ready to capture."));
      return captureFrame({
        subscribe: (callback) => {
          view.on("postRender", callback);
          return () => view.off("postRender", callback);
        },
        requestRender: () => view.forceUpdate(),
        copy: () => copySceneImage(canvas, credits),
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        projectDrawingPoint: (point: readonly [number, number, number]) => {
          const view = viewRef.current;
          if (!view) return null;
          const vector = geodeticToVector3({
            lng: point[0],
            lat: point[1],
            height: point[2],
          }).project(view.camera.raw);
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return null;
          return {
            x: ((vector.x + 1) * rect.width) / 2,
            y: ((1 - vector.y) * rect.height) / 2,
          };
        },
        pickDrawingPoint: (x: number, y: number) => {
          // Installed TerrainPicker samples canvas-local CSS pixels directly,
          // despite the public method comment describing client coordinates.
          const point = viewRef.current?.pickDepthPosition(x, y);
          if (!point) return null;
          const geo = vector3ToGeodetic(point);
          return [geo.lng, geo.lat, geo.height] as const;
        },
        captureImage,
        fitAll,
        fitLayer,
        fitObjects,
        fitBounds,
        zoomIn,
        zoomOut,
        resetNorth,
        alignView,
        getCameraState,
        setCameraState,
        flyTo,
        getStreamingPlugin,
        // A GETTER, not a captured promise, because the lifecycle cleanup
        // RE-ARMS the gate. A snapshot taken when this handle was built would
        // be correct only as long as React keeps re-invoking `create()` in
        // lockstep with that cleanup — which it does today (the lifecycle
        // effect's deps are `[]`, so it can only cycle together with this
        // layout effect, and both are double-invoked under StrictMode). That
        // is an ordering guarantee this component should not be spending, so
        // read the ref instead: `handle.ready` is then, by construction, the
        // promise of the engine that is coming up NOW. (`readyRef` is a ref,
        // hence no dependency.)
        get ready() {
          return readyRef.current!.promise;
        },
      }),
      [
        captureImage,
        fitAll,
        fitLayer,
        fitObjects,
        fitBounds,
        zoomIn,
        zoomOut,
        resetNorth,
        alignView,
        getCameraState,
        setCameraState,
        flyTo,
        getStreamingPlugin,
      ],
    );

    return (
      <div className="navara-viewport">
        {/* The engine appends its canvas here. Kept childless so React never
            has to reconcile around a DOM node it does not own. */}
        <div className="navara-viewport__canvas" ref={containerRef} />
        {initError !== null && (
          <div className="navara-viewport__error" role="alert">
            The 3D engine failed to start: {initError}
          </div>
        )}
        {/* The numbers behind the blue ground outline the effect above draws.
            Renders nothing unless the diagnostic is on AND a streaming layer
            has actually queried. */}
        <StreamQueryBoxOverlay />
        {/* Bottom-left, above the attribution strip. Subscribes to the same
            camera-pose publisher the compass does, so a moving camera
            re-renders a hundred pixels rather than this viewport. */}
        <ScaleBar />
        {/* Licence obligation, not decoration: the geoid credits are shown
            whatever is loaded (every georeferenced layer samples it), the
            Google credit only while its tiles are in the scene, and the
            basemap credit only for the option actually draped on the globe. */}
        <AttributionOverlay
          googleTiles={tilesEnabled}
          basemapAttribution={activeBasemap?.attribution}
          terrainAttribution={terrainEnabled ? TERRAIN_ATTRIBUTION : undefined}
          onLinesChange={onAttributionChange}
        />
      </div>
    );
  },
);
