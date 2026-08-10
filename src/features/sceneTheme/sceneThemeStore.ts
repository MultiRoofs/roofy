/**
 * Which LOOK the scene is rendered in: photoreal (the viewer's own rendering),
 * cartoon, cyber or wireframe.
 *
 * A store rather than a prop, for the same reason `viewModeStore` is one: the
 * theme is set from the toolbar, read by the viewport (city meshes, backdrops
 * and the whole atmosphere/post chain) and it has to survive a save. What a
 * theme MEANS is not here but in `scene/sceneThemePolicy.ts` — engine-free, so
 * the viewport and the UI share one table instead of each re-deciding what
 * "cyber" implies.
 *
 * A theme is a PRESENTATION OVERLAY and never writes another store: the
 * basemap picker, the Google-tiles toggle, the exposure slider and the solar
 * clock keep the user's own values throughout, and switching back to photoreal
 * restores everything precisely because nothing was mutated.
 */
import { create } from "zustand";

export type SceneTheme = "photoreal" | "cartoon" | "cyber" | "wireframe";

/** Every theme, photoreal first — the order the toolbar's radio list renders
 *  them in, so the UI never re-lists them. */
export const SCENE_THEMES: readonly SceneTheme[] = [
  "photoreal",
  "cartoon",
  "cyber",
  "wireframe",
];

/** Exactly today's rendering: with this selected the theme system pushes
 *  nothing anywhere (see `sceneThemePolicy.ts`). */
export const DEFAULT_SCENE_THEME: SceneTheme = "photoreal";

export interface SceneThemeState {
  readonly theme: SceneTheme;
}

export interface SceneThemeActions {
  setSceneTheme: (theme: SceneTheme) => void;
}

export type SceneThemeStore = SceneThemeState & SceneThemeActions;

export const useSceneThemeStore = create<SceneThemeStore>((set) => ({
  theme: DEFAULT_SCENE_THEME,

  // No-op when the theme is already the one asked for: a theme change re-styles
  // every city mesh (rebuilding its edge geometry), swaps the basemap layer and
  // re-pushes the whole environment block, so a redundant set — a restore
  // writing back the default, a second click on the active radio — must not
  // read as a change.
  setSceneTheme: (theme) =>
    set((state) => (state.theme === theme ? state : { theme })),
}));
