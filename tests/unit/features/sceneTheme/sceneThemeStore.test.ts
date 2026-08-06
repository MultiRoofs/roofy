/**
 * The scene-theme store: four looks, one action, and a default that has to be
 * the viewer's existing rendering exactly.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SCENE_THEME,
  SCENE_THEMES,
  useSceneThemeStore,
} from "../../../../src/features/sceneTheme/sceneThemeStore";

beforeEach(() => {
  useSceneThemeStore.setState({ theme: DEFAULT_SCENE_THEME });
});

describe("sceneThemeStore", () => {
  it("starts in photoreal — the rendering the viewer has always had", () => {
    expect(DEFAULT_SCENE_THEME).toBe("photoreal");
    expect(useSceneThemeStore.getState().theme).toBe("photoreal");
  });

  it("offers exactly the four themes, photoreal first", () => {
    expect(SCENE_THEMES).toEqual([
      "photoreal",
      "cartoon",
      "cyber",
      "wireframe",
    ]);
  });

  it("switches theme", () => {
    useSceneThemeStore.getState().setSceneTheme("cyber");
    expect(useSceneThemeStore.getState().theme).toBe("cyber");
    useSceneThemeStore.getState().setSceneTheme("wireframe");
    expect(useSceneThemeStore.getState().theme).toBe("wireframe");
  });

  it("keeps the same state object when the theme is set to what it already is", () => {
    const before = useSceneThemeStore.getState();
    useSceneThemeStore.getState().setSceneTheme("photoreal");
    // Every theme-driven effect in the viewport re-runs on a CHANGE — a mesh
    // re-style, a basemap swap, an environment push. A redundant set (a restore
    // writing back the default, a second click on the active radio) must not
    // read as one.
    expect(useSceneThemeStore.getState()).toBe(before);
  });
});
