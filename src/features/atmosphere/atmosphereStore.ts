/**
 * Zustand store for atmosphere visual settings.
 *
 * Holds cloud coverage and the lens-flare switch. Separate from `solarStore`
 * (datetime / latLon / sun position) because atmosphere visual settings evolve
 * independently, and separate from `renderDebugStore` only by history — the two
 * are reset together by the Advanced Settings panel's one footer action, which
 * is why `DEFAULT_ATMOSPHERE_STATE` and `reset` exist here in the same shape as
 * their render-debug counterparts.
 *
 * Both fields have a live engine counterpart in `NavaraViewport`: coverage is
 * pushed into the clouds pass, lens flare into the photoreal scene's
 * `lensFlare` handle.
 */

import { create } from "zustand";

export interface AtmosphereState {
  readonly cloudCoverage: number;
  readonly lensFlareEnabled: boolean;
}

export interface AtmosphereActions {
  setCoverage: (v: number) => void;
  setLensFlareEnabled: (v: boolean) => void;
  reset: () => void;
}

export type AtmosphereStore = AtmosphereState & AtmosphereActions;

export const DEFAULT_ATMOSPHERE_STATE: AtmosphereState = {
  cloudCoverage: 0.3,
  lensFlareEnabled: true,
};

export const useAtmosphereStore = create<AtmosphereStore>((set) => ({
  ...DEFAULT_ATMOSPHERE_STATE,

  setCoverage: (v) => set({ cloudCoverage: Math.max(0, Math.min(1, v)) }),
  setLensFlareEnabled: (v) => set({ lensFlareEnabled: v }),
  reset: () => set(DEFAULT_ATMOSPHERE_STATE),
}));
