/**
 * Zustand store for atmosphere visual settings.
 *
 * Holds cloud coverage and related atmosphere rendering parameters.
 * Separate from solarStore (which handles datetime/latLon/sun position)
 * because atmosphere visual settings evolve independently.
 *
 * LightingMask is now active: city meshes use light-source lighting (SunLight/SkyLight)
 * while Google tiles get post-process lighting from AerialPerspective.
 */

import { create } from "zustand";

export interface AtmosphereState {
  readonly cloudCoverage: number;
  readonly lensFlareEnabled: boolean;
}

export interface AtmosphereActions {
  setCoverage: (v: number) => void;
  setLensFlareEnabled: (v: boolean) => void;
}

export type AtmosphereStore = AtmosphereState & AtmosphereActions;

export const useAtmosphereStore = create<AtmosphereStore>((set) => ({
  cloudCoverage: 0.3,
  lensFlareEnabled: true,

  setCoverage: (v) => set({ cloudCoverage: Math.max(0, Math.min(1, v)) }),
  setLensFlareEnabled: (v) => set({ lensFlareEnabled: v }),
}));
