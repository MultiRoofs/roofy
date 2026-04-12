import { create } from "zustand";

export type CityMaterialMode = "standard" | "basic";

export interface RenderDebugState {
  readonly sunShadowsEnabled: boolean;
  readonly cityShadowsEnabled: boolean;
  readonly cityDoubleSided: boolean;
  readonly cityMaterialMode: CityMaterialMode;
}

export interface RenderDebugActions {
  setSunShadowsEnabled: (value: boolean) => void;
  setCityShadowsEnabled: (value: boolean) => void;
  setCityDoubleSided: (value: boolean) => void;
  setCityMaterialMode: (value: CityMaterialMode) => void;
  reset: () => void;
}

export type RenderDebugStore = RenderDebugState & RenderDebugActions;

export const DEFAULT_RENDER_DEBUG_STATE: RenderDebugState = {
  sunShadowsEnabled: true,
  cityShadowsEnabled: true,
  cityDoubleSided: false,
  cityMaterialMode: "standard",
};

export const useRenderDebugStore = create<RenderDebugStore>((set) => ({
  ...DEFAULT_RENDER_DEBUG_STATE,

  setSunShadowsEnabled: (sunShadowsEnabled) => set({ sunShadowsEnabled }),
  setCityShadowsEnabled: (cityShadowsEnabled) => set({ cityShadowsEnabled }),
  setCityDoubleSided: (cityDoubleSided) => set({ cityDoubleSided }),
  setCityMaterialMode: (cityMaterialMode) => set({ cityMaterialMode }),
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
