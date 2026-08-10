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

/**
 * Falling weather over the site.
 *
 * One field rather than two booleans because Navara models rain and snow as
 * two separate MESHES and the example toggles `visible` between them: they are
 * alternatives, not independent switches, and it should not be possible to ask
 * for both at once.
 */
export type Precipitation = "none" | "rain" | "snow";

export interface AtmosphereState {
  readonly cloudCoverage: number;
  readonly lensFlareEnabled: boolean;
  readonly precipitation: Precipitation;
}

export interface AtmosphereActions {
  setCoverage: (v: number) => void;
  setLensFlareEnabled: (v: boolean) => void;
  setPrecipitation: (v: Precipitation) => void;
  reset: () => void;
}

export type AtmosphereStore = AtmosphereState & AtmosphereActions;

export const DEFAULT_ATMOSPHERE_STATE: AtmosphereState = {
  cloudCoverage: 0.3,
  lensFlareEnabled: true,
  // Dry by default: precipitation is a presentation choice, and it obscures
  // the roofs this tool exists to look at.
  precipitation: "none",
};

export const useAtmosphereStore = create<AtmosphereStore>((set) => ({
  ...DEFAULT_ATMOSPHERE_STATE,

  setCoverage: (v) => set({ cloudCoverage: Math.max(0, Math.min(1, v)) }),
  setLensFlareEnabled: (v) => set({ lensFlareEnabled: v }),
  setPrecipitation: (v) => set({ precipitation: v }),
  reset: () => set(DEFAULT_ATMOSPHERE_STATE),
}));
