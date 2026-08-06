/**
 * Render settings the Advanced Settings panel drives.
 *
 * EVERY field here has a live engine counterpart in `NavaraViewport` — a
 * handle out of `DefaultPlugin.addDefaultPhotorealScene()`, a `view.addEffect`
 * pass, or `view.toneMappingExposure`. That is a
 * hard rule, not a convention: this store used to carry `cityShadowsEnabled`,
 * `cityDoubleSided` and `cityMaterialMode` as well, and all three were read by
 * nothing at all, so half the panel was switches that changed a boolean and
 * nothing else. They were DELETED rather than wired, because their counterpart
 * is the city mesh's three.js material — owned by `@cityjson/navara-cityjson`,
 * not by the app — and inventing an app-side back door into another package's
 * materials to serve a debug toggle is worse than not having the toggle.
 *
 * `ambientIntensity` is gone for a different reason: it had a live counterpart
 * (`view.addLight({ ambient })`), but it belonged to the SCENE-LIGHTS
 * calibration this scene no longer uses. The aerial-perspective pass lights the
 * whole frame from the physical atmosphere now, so an ambient fill is pure
 * additional energy on an already exposure-10 image. See {@link DEFAULT_EXPOSURE}.
 */

import { create } from "zustand";

/**
 * The exposure Navara's own getting-started sets (`view.toneMappingExposure =
 * 10`; see docs/superpowers/research/2026-08-01-navara-api-report.md §Bootstrap).
 *
 * This is the PHYSICAL-ATMOSPHERE calibration, and it is the whole scene's
 * calibration: the atmosphere feeds the tone mapper radiance-scale values, and
 * the aerial-perspective pass runs in `irradiance` mode so it — not
 * `SunLightDesc` + `skyLightProbe` — is what lights the city meshes, the globe
 * and the tiles. Every surface in the scene is therefore unlit albedo in the
 * g-buffer; nothing may add scene-light energy on top, or it clips to white at
 * this exposure. See
 * docs/superpowers/research/2026-08-04-overbright-scene-diagnosis.md, which
 * supersedes the earlier "the scene is far darker" note: exposure 10 was
 * right, the lighting model underneath it was wrong.
 */
export const DEFAULT_EXPOSURE = 10;

/** Slider bounds. 0.5 is "nearly black", 30 is "blown out" — both useful when
 *  diagnosing a scene, neither a sensible resting place. */
export const EXPOSURE_RANGE = { min: 0.5, max: 30, step: 0.5 } as const;

export interface RenderDebugState {
  /** Master switch over the post-processing chain (aerial perspective, lens
   *  flare, clouds, antialiasing). Tone mapping deliberately stays on: it is
   *  what maps HDR radiance into a displayable range, so switching it off
   *  would blow the frame to white rather than show anything diagnostic. */
  readonly postProcessingEnabled: boolean;
  readonly cloudsEnabled: boolean;
  readonly aerialPerspectiveEnabled: boolean;
  readonly sunShadowsEnabled: boolean;
  /** `view.toneMappingExposure`. */
  readonly exposure: number;
  /**
   * Draw the ground-plane rectangle each FlatCityBuf layer's last commit
   * actually queried (`FcbStreamLayerHandle.onQueryRegion`), plus a readout of
   * its source-CRS numbers.
   *
   * Its engine counterpart is a `smoothLines` mesh per streaming layer, added
   * and removed by `NavaraViewport`'s query-box effect — so it satisfies this
   * store's hard rule rather than being a boolean nothing reads. OFF by
   * default: it answers "why is the streamer fetching *that*?", which is a
   * question you go looking for, not scene furniture.
   */
  readonly streamQueryBoxEnabled: boolean;
}

export interface RenderDebugActions {
  setPostProcessingEnabled: (value: boolean) => void;
  setCloudsEnabled: (value: boolean) => void;
  setAerialPerspectiveEnabled: (value: boolean) => void;
  setSunShadowsEnabled: (value: boolean) => void;
  setExposure: (value: number) => void;
  setStreamQueryBoxEnabled: (value: boolean) => void;
  reset: () => void;
}

export type RenderDebugStore = RenderDebugState & RenderDebugActions;

export const DEFAULT_RENDER_DEBUG_STATE: RenderDebugState = {
  postProcessingEnabled: true,
  // OFF by default: the reference look this scene is calibrated against
  // (Navara's own /sky/sun-time sample) has no clouds pass, and at the default
  // coverage the ray-marched cloud masses cover most of the sky and dominate
  // the frame. It is one checkbox away for anyone who wants weather.
  cloudsEnabled: false,
  aerialPerspectiveEnabled: true,
  sunShadowsEnabled: true,
  exposure: DEFAULT_EXPOSURE,
  streamQueryBoxEnabled: false,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export const useRenderDebugStore = create<RenderDebugStore>((set) => ({
  ...DEFAULT_RENDER_DEBUG_STATE,

  setPostProcessingEnabled: (postProcessingEnabled) =>
    set({ postProcessingEnabled }),
  setCloudsEnabled: (cloudsEnabled) => set({ cloudsEnabled }),
  setAerialPerspectiveEnabled: (aerialPerspectiveEnabled) =>
    set({ aerialPerspectiveEnabled }),
  setSunShadowsEnabled: (sunShadowsEnabled) => set({ sunShadowsEnabled }),
  // Clamped in the STORE, not at the slider: the dev-console handle
  // (`window.__multiroofRenderDebug`) writes here too, and an exposure of NaN
  // makes the engine render a black frame with no error anywhere.
  setExposure: (exposure) =>
    set({ exposure: clamp(exposure, EXPOSURE_RANGE.min, EXPOSURE_RANGE.max) }),
  setStreamQueryBoxEnabled: (streamQueryBoxEnabled) =>
    set({ streamQueryBoxEnabled }),
  reset: () => set(DEFAULT_RENDER_DEBUG_STATE),
}));

declare global {
  interface Window {
    __multiroofRenderDebug?: typeof useRenderDebugStore;
  }
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__multiroofRenderDebug = useRenderDebugStore;
}
