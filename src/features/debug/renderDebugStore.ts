/**
 * Render settings the Advanced Settings panel drives.
 *
 * EVERY field here has a live engine counterpart in `NavaraViewport` — a
 * handle out of `DefaultPlugin.addDefaultPhotorealScene()`, a `view.addEffect`
 * pass, a `view.addLight` handle, or `view.toneMappingExposure`. That is a
 * hard rule, not a convention: this store used to carry `cityShadowsEnabled`,
 * `cityDoubleSided` and `cityMaterialMode` as well, and all three were read by
 * nothing at all, so half the panel was switches that changed a boolean and
 * nothing else. They were DELETED rather than wired, because their counterpart
 * is the city mesh's three.js material — owned by `@cityjson/navara-cityjson`,
 * not by the app — and inventing an app-side back door into another package's
 * materials to serve a debug toggle is worse than not having the toggle.
 */

import { create } from "zustand";

/**
 * The exposure Navara's own getting-started sets (`view.toneMappingExposure =
 * 10`; see docs/superpowers/research/2026-08-01-navara-api-report.md §Bootstrap).
 *
 * three's default is 1, and the app never set it — which is why the scene read
 * as a dim, muddy version of Navara's samples: the atmosphere feeds the tone
 * mapper physically-scaled radiance, and at exposure 1 nearly all of it lands
 * in the bottom of the curve.
 */
export const DEFAULT_EXPOSURE = 10;

/** Slider bounds. 0.5 is "nearly black", 30 is "blown out" — both useful when
 *  diagnosing a scene, neither a sensible resting place. */
export const EXPOSURE_RANGE = { min: 0.5, max: 30, step: 0.5 } as const;

/**
 * Intensity of the explicit ambient light the app adds on top of the photoreal
 * scene's `skyLightProbe`.
 *
 * `addDefaultPhotorealScene()` supplies a sky light probe, i.e. DIRECTIONAL
 * sky irradiance — a surface facing away from both sun and sky (a north wall,
 * anything under an overhang) still falls to near-black. Navara's own
 * basic-visualization sample adds `view.addLight({ ambient: {} })` for exactly
 * that reason. This is the flat fill term; 0 removes the light entirely.
 */
export const DEFAULT_AMBIENT_INTENSITY = 0.6;

export const AMBIENT_RANGE = { min: 0, max: 3, step: 0.05 } as const;

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
  /** Intensity of the app-added ambient light; 0 removes it. */
  readonly ambientIntensity: number;
}

export interface RenderDebugActions {
  setPostProcessingEnabled: (value: boolean) => void;
  setCloudsEnabled: (value: boolean) => void;
  setAerialPerspectiveEnabled: (value: boolean) => void;
  setSunShadowsEnabled: (value: boolean) => void;
  setExposure: (value: number) => void;
  setAmbientIntensity: (value: number) => void;
  reset: () => void;
}

export type RenderDebugStore = RenderDebugState & RenderDebugActions;

export const DEFAULT_RENDER_DEBUG_STATE: RenderDebugState = {
  postProcessingEnabled: true,
  cloudsEnabled: true,
  aerialPerspectiveEnabled: true,
  sunShadowsEnabled: true,
  exposure: DEFAULT_EXPOSURE,
  ambientIntensity: DEFAULT_AMBIENT_INTENSITY,
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
  setAmbientIntensity: (ambientIntensity) =>
    set({
      ambientIntensity: clamp(
        ambientIntensity,
        AMBIENT_RANGE.min,
        AMBIENT_RANGE.max,
      ),
    }),
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
