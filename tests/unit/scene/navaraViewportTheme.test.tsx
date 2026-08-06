/**
 * NavaraViewport <- scene themes.
 *
 * The engine is MOCKED here, as in every other viewport suite: `@navaramap/
 * three` crashes at module scope under Node and jsdom has no WebGL. What these
 * tests can therefore pin is exactly what matters for a presentation overlay —
 * WHICH engine calls a theme makes, that photoreal makes none, and that leaving
 * a theme puts back the user's own choices, which were never written in the
 * first place. How any of it LOOKS is the commander's browser pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const addPlugin = vi.fn();
const init = vi.fn(async () => {});
const dispose = vi.fn();
const deleteSource = vi.fn(() => true);
const deleteLayer = vi.fn();
const addSource = vi.fn((_source: unknown) => ({
  id: "src-1",
  type: "raster-tile",
  delete: deleteSource,
}));
const addLayer = vi.fn((_layer: unknown) => ({
  id: "layer-1",
  delete: deleteLayer,
}));
const addEffect = vi.fn((_config: unknown) => ({
  id: "effect-1",
  update: vi.fn(),
  delete: vi.fn(),
  ref: { raw: { dispose: vi.fn() } },
}));
/** `view.addMesh` — the seam the theme's sky box and Fresnel halo come through
 *  (neither is part of `addDefaultPhotorealScene()`). */
const meshUpdate = vi.fn();
const meshDelete = vi.fn();
const addMesh = vi.fn((_desc: unknown) => ({
  id: "mesh-1",
  visible: true,
  update: meshUpdate,
  delete: meshDelete,
}));

/**
 * A `Color` as the engine hands one back.
 *
 * Not incidental: `Globe`'s colour SETTER calls `toHex()` on what it is given,
 * so the viewport builds a new colour by cloning the instance the globe already
 * holds rather than importing the class. This stub is what checks that it does.
 */
function makeColor(hex: number) {
  return {
    hex,
    toHex(): number {
      return this.hex;
    },
    setHex(next: number) {
      this.hex = next;
      return this;
    },
    clone() {
      return makeColor(this.hex);
    },
  };
}
const ORIGINAL_GLOBE_COLOR = 0x123456;

const listeners = new Map<string, Set<(...args: never[]) => void>>();
const on = vi.fn((name: string, fn: (...args: never[]) => void) => {
  const set = listeners.get(name) ?? new Set();
  set.add(fn);
  listeners.set(name, set);
});
const off = vi.fn((name: string, fn: (...args: never[]) => void) => {
  listeners.get(name)?.delete(fn);
});

const atmosphere = {
  date: new Date("2026-06-21T12:00:00.000Z"),
  getSunDirection: vi.fn(() => ({ x: 1, y: 0, z: 0 })),
  on: vi.fn(),
  off: vi.fn(),
};

const photorealHandles = {
  sky: { visible: true },
  stars: { visible: true, update: vi.fn() },
  skyLightProbe: { visible: true, update: vi.fn() },
  sun: { visible: true, update: vi.fn() },
  aerialPerspective: { visible: true, update: vi.fn() },
  lensFlare: { visible: true },
  toneMapping: { visible: true, update: vi.fn() },
  antialiasing: { visible: true },
};

const viewInstances: Array<Record<string, unknown>> = [];

vi.mock("@navaramap/three", () => ({
  default: vi.fn(function () {
    const view = {
      addPlugin,
      init,
      dispose,
      on,
      off,
      camera: {
        raw: {},
        get positionGeographic() {
          return { lng: 4.35, lat: 52, height: 500 };
        },
        orientation: { heading: 0, pitch: -60, roll: 0 },
        on: vi.fn(),
        off: vi.fn(),
      },
      setCamera: vi.fn(),
      flyTo: vi.fn(),
      addSource,
      addLayer,
      addEffect,
      addMesh,
      addLight: vi.fn(() => ({ update: vi.fn(), delete: vi.fn() })),
      resize: vi.fn(),
      toneMappingExposure: 1,
      globe: { wireframe: false, color: makeColor(ORIGINAL_GLOBE_COLOR) },
      atmosphere,
      screenSize: { x: 800, y: 600 },
      pixelRatio: 2,
      pickDepthPosition: vi.fn(() => null as unknown),
    };
    viewInstances.push(view as unknown as Record<string, unknown>);
    return view;
  }),
  getPickRay: vi.fn(() => ({
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
  })),
  vector3ToGeodetic: vi.fn((v: { x: number; y: number; z: number }) => ({
    lng: v.x,
    lat: v.y,
    height: v.z,
  })),
  radianToDegree: vi.fn((r: number) => (r * 180) / Math.PI),
  degreeToRadian: vi.fn((d: number) => (d * Math.PI) / 180),
  geodeticToVector3: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
}));

const defaultPluginInstance = {
  addDefaultPhotorealScene: vi.fn(() => photorealHandles),
};
vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(function () {
    return defaultPluginInstance;
  }),
}));

const cityPluginInstance = {
  getHandle: vi.fn(),
  addCityModel: vi.fn(),
};
vi.mock("@cityjson/navara-cityjson/plugin", () => ({
  CityJSONPlugin: vi.fn(function () {
    return cityPluginInstance;
  }),
}));

vi.mock("@cityjson/navara-flatcitybuf/plugin", () => ({
  FlatCityBufPlugin: vi.fn(function () {
    return {
      openStream: vi.fn(),
      remove: vi.fn(),
      dispose: vi.fn(),
      suppressSettleThenCommit: vi.fn(async (fn: () => unknown) => fn()),
    };
  }),
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import {
  useLayerStore,
  type Layer,
} from "../../../src/features/layers/layerStore";
import { useBasemapStore } from "../../../src/features/basemap/basemapStore";
import { useTilesStore } from "../../../src/features/tiles/tilesStore";
import { useAtmosphereStore } from "../../../src/features/atmosphere/atmosphereStore";
import {
  DEFAULT_RENDER_DEBUG_STATE,
  useRenderDebugStore,
} from "../../../src/features/debug/renderDebugStore";
import {
  DEFAULT_SCENE_THEME,
  useSceneThemeStore,
  type SceneTheme,
} from "../../../src/features/sceneTheme/sceneThemeStore";
import { sceneThemePolicy } from "../../../src/scene/sceneThemePolicy";
import type { CityModel } from "../../../src/domain/citymodel/types";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const CRS_URI = "https://www.opengis.net/def/crs/EPSG/0/7415";

function makeLayer(id: string): Layer {
  return {
    id,
    name: id,
    model: {
      objects: {},
      vertices: [],
      transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
      metadata: { referenceSystem: CRS_URI },
      bbox: [0, 0, 0, 1, 1, 1],
    } as unknown as CityModel,
    modelRef: { type: "url", url: `https://example.test/${id}` },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: "2.2",
    availableLods: ["2.2"],
    lodMode: "auto",
    hiddenTypes: [],
    isStreaming: false,
  } as unknown as Layer;
}

function makeHandle(id: string) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    setThemeStyle: vi.fn(),
    setHiddenTypes: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(() => null as unknown),
    triangleCount: vi.fn(() => 10),
    heightOffset: vi.fn(() => 0),
    getBoundsGeodetic: vi.fn(() => null),
    delete: vi.fn(),
  };
}

/** The engine calls of one kind, by descriptor key — `addMesh({ skyBox: … })`
 *  and `addMesh({ glowGlobe: … })` come through the same mock. */
function meshCallsFor(key: string): unknown[] {
  return addMesh.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((desc) => desc != null && key in desc);
}

/** The aerial-perspective updates that carry an `albedoScale` — the pass also
 *  receives the app's one lighting calibration on startup, which is not this. */
function albedoScaleUpdates(): number[] {
  return photorealHandles.aerialPerspective.update.mock.calls
    .map(
      (c) =>
        (c[0] as { aerialPerspective?: { albedoScale?: number } })
          ?.aerialPerspective?.albedoScale,
    )
    .filter((v): v is number => typeof v === "number");
}

function countLayersOfType(type: string): number {
  return addLayer.mock.calls.filter(
    (c) => (c[0] as { type?: string } | undefined)?.type === type,
  ).length;
}

async function mount(): Promise<void> {
  render(<NavaraViewport onTriangleCount={() => {}} />);
  await waitFor(() => expect(init).toHaveBeenCalled());
  // The photoreal handles land in the same microtask as `init` resolves; every
  // theme effect runs after that.
  await act(async () => {});
}

async function setTheme(theme: SceneTheme): Promise<void> {
  await act(async () => {
    useSceneThemeStore.getState().setSceneTheme(theme);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  init.mockImplementation(async () => {});
  addSource.mockImplementation((_s: unknown) => ({
    id: "src-1",
    type: "raster-tile",
    delete: deleteSource,
  }));
  addLayer.mockImplementation((_l: unknown) => ({
    id: "layer-1",
    delete: deleteLayer,
  }));
  addMesh.mockImplementation((_d: unknown) => ({
    id: "mesh-1",
    visible: true,
    update: meshUpdate,
    delete: meshDelete,
  }));
  defaultPluginInstance.addDefaultPhotorealScene.mockReturnValue(
    photorealHandles,
  );
  cityPluginInstance.getHandle.mockReset();
  cityPluginInstance.addCityModel.mockImplementation(
    (_model: unknown, opts: { id: string }) => makeHandle(opts.id),
  );
  for (const handle of Object.values(photorealHandles)) handle.visible = true;
  listeners.clear();
  viewInstances.length = 0;
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useSceneThemeStore.setState({ theme: DEFAULT_SCENE_THEME });
  useBasemapStore.setState({ basemapId: "osm" });
  useTilesStore.setState({ enabled: false });
  useRenderDebugStore.setState({
    ...DEFAULT_RENDER_DEBUG_STATE,
    cloudsEnabled: false,
    postProcessingEnabled: true,
  });
  useAtmosphereStore.setState({ lensFlareEnabled: true, cloudCoverage: 0.3 });
});

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useSceneThemeStore.setState({ theme: DEFAULT_SCENE_THEME });
  useBasemapStore.setState({ basemapId: "osm" });
  useTilesStore.setState({ enabled: false });
});

describe("scene theme -> the city meshes", () => {
  it("pushes the active theme's style to a static layer handle, on change only", async () => {
    const handle = makeHandle("L1");
    cityPluginInstance.addCityModel.mockReturnValue(handle);
    await mount();
    await act(async () => {
      useLayerStore.setState({
        layers: [makeLayer("L1")],
        activeLayerId: "L1",
      });
    });
    // Photoreal is still pushed — it is the style that UNDOES a theme, and at
    // the plugin it equals the mesh's own default, so the push costs nothing.
    expect(handle.setThemeStyle).toHaveBeenCalledWith(
      sceneThemePolicy("photoreal").meshStyle,
    );

    handle.setThemeStyle.mockClear();
    await setTheme("cyber");
    expect(handle.setThemeStyle).toHaveBeenCalledTimes(1);
    expect(handle.setThemeStyle).toHaveBeenCalledWith(
      sceneThemePolicy("cyber").meshStyle,
    );

    handle.setThemeStyle.mockClear();
    await setTheme("photoreal");
    expect(handle.setThemeStyle).toHaveBeenCalledWith(
      sceneThemePolicy("photoreal").meshStyle,
    );
  });

  it("styles a layer ADDED while a theme is already on", async () => {
    const handle = makeHandle("L2");
    cityPluginInstance.addCityModel.mockReturnValue(handle);
    await mount();
    await setTheme("wireframe");
    await act(async () => {
      useLayerStore.setState({
        layers: [makeLayer("L2")],
        activeLayerId: "L2",
      });
    });
    // A file dropped into a themed scene must not render one photoreal frame.
    expect(handle.setThemeStyle).toHaveBeenCalledWith(
      sceneThemePolicy("wireframe").meshStyle,
    );
  });
});

describe("scene theme -> the backdrops", () => {
  it("overrides the basemap without writing the picker, and gives it back", async () => {
    await mount();
    expect(countLayersOfType("raster")).toBe(1);

    await setTheme("cartoon");
    // The picker still says what the user chose.
    expect(useBasemapStore.getState().basemapId).toBe("osm");
    // But a SECOND raster layer was added — the theme's pastel sheet.
    expect(countLayersOfType("raster")).toBe(2);
    const themed = addSource.mock.calls[
      addSource.mock.calls.length - 1
    ]![0] as { url?: string };
    expect(themed.url).toMatch(/basemaps\.cartocdn\.com|carto/i);

    await setTheme("photoreal");
    const back = addSource.mock.calls[addSource.mock.calls.length - 1]![0] as {
      url?: string;
    };
    expect(back.url).toMatch(/openstreetmap/i);
  });

  it("adds NO raster layer at all for a theme that wants no basemap", async () => {
    await mount();
    const before = countLayersOfType("raster");
    await setTheme("cyber");
    // "none" has no source at all, so nothing is draped — and, because the
    // credit follows what is on screen, nobody is credited either.
    expect(countLayersOfType("raster")).toBe(before);
    expect(deleteLayer).toHaveBeenCalled();

    await setTheme("photoreal");
    expect(countLayersOfType("raster")).toBe(before + 1);
  });

  it("suppresses Google's tiles without writing the toggle", async () => {
    // A key is required for the tiles effect to add anything at all; the test
    // env has none (and the real `.env` value is dotenvx ciphertext, which
    // `googleTilesConfig` refuses on purpose).
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    useTilesStore.setState({ enabled: true });
    await mount();
    expect(countLayersOfType("3d-tiles")).toBe(1);

    await setTheme("cyber");
    // Off the globe, but the user's flag is exactly where they left it.
    expect(useTilesStore.getState().enabled).toBe(true);
    expect(deleteLayer).toHaveBeenCalled();
    expect(countLayersOfType("3d-tiles")).toBe(1);

    await setTheme("photoreal");
    // Back on, from that untouched flag — nothing had to be remembered.
    expect(countLayersOfType("3d-tiles")).toBe(2);
    vi.unstubAllEnvs();
  });
});

describe("scene theme -> the environment", () => {
  it("touches NOTHING while the viewer has never left photoreal", async () => {
    await mount();
    // The one aerial-perspective update that does happen is the app's lighting
    // calibration (`irradiance`), which is not the theme's business.
    expect(albedoScaleUpdates()).toEqual([]);
    expect(photorealHandles.toneMapping.update).not.toHaveBeenCalled();
    expect(photorealHandles.stars.update).not.toHaveBeenCalled();
    expect(photorealHandles.skyLightProbe.update).not.toHaveBeenCalled();
    expect(addMesh).not.toHaveBeenCalled();
    expect(photorealHandles.sky.visible).toBe(true);
    const view = viewInstances[0]!;
    expect((view.globe as { wireframe: boolean }).wireframe).toBe(false);
    expect((view.globe as { color: { toHex(): number } }).color.toHex()).toBe(
      ORIGINAL_GLOBE_COLOR,
    );
  });

  it("applies cyber's environment, and restores every piece of it", async () => {
    await mount();
    const view = viewInstances[0]!;
    const env = sceneThemePolicy("cyber").environment;

    await setTheme("cyber");
    expect(photorealHandles.sky.visible).toBe(false);
    expect(photorealHandles.stars.update).toHaveBeenCalledWith({
      stars: env.starsBoost,
    });
    expect(meshCallsFor("glowGlobe")).toHaveLength(1);
    expect(albedoScaleUpdates().at(-1)).toBe(env.apAlbedoScale);
    expect(photorealHandles.skyLightProbe.update).toHaveBeenLastCalledWith({
      skyLightProbe: { intensity: env.skyLightProbeIntensity },
    });
    // The globe's colour is deliberately NEVER written (upstream bug (i)).
    expect((view.globe as { color: { toHex(): number } }).color.toHex()).toBe(
      ORIGINAL_GLOBE_COLOR,
    );
    expect(view.toneMappingExposure).toBe(env.exposure);

    await setTheme("photoreal");
    expect(photorealHandles.sky.visible).toBe(true);
    // The halo is HIDDEN, never deleted: `EffectDesc.onDestroy` removes without
    // disposing (Known Issue (f)), and an add/delete per switch is a cost paid
    // every time the user tries the menu.
    expect(meshCallsFor("glowGlobe")).toHaveLength(1);
    expect(meshDelete).not.toHaveBeenCalled();
    expect(albedoScaleUpdates().at(-1)).toBe(1);
    expect(photorealHandles.skyLightProbe.update).toHaveBeenLastCalledWith({
      skyLightProbe: { intensity: 1 },
    });
    // The globe's own colour, captured before the first override rather than
    // guessed at afterwards.
    expect((view.globe as { color: { toHex(): number } }).color.toHex()).toBe(
      ORIGINAL_GLOBE_COLOR,
    );
  });

  it("leaves the globe's wireframe flag alone in every theme", async () => {
    // Upstream bug (i): the globe's live setters poison the frame. The
    // wireframe THEME therefore never writes the globe's wireframe FLAG.
    await mount();
    const view = viewInstances[0]!;
    await setTheme("wireframe");
    expect((view.globe as { wireframe: boolean }).wireframe).toBe(false);
    await setTheme("photoreal");
    expect((view.globe as { wireframe: boolean }).wireframe).toBe(false);
  });

  it("adds cartoon's flat sky box once and reuses it", async () => {
    await mount();
    await setTheme("cartoon");
    expect(meshCallsFor("skyBox")).toHaveLength(1);
    await setTheme("photoreal");
    await setTheme("cartoon");
    // Second entry updates and re-shows the same mesh.
    expect(meshCallsFor("skyBox")).toHaveLength(1);
    expect(meshUpdate).toHaveBeenCalled();
  });

  it("swaps the tone curve and puts AgX back", async () => {
    await mount();
    await setTheme("wireframe");
    const modes = photorealHandles.toneMapping.update.mock.calls.map(
      (c) => (c[0] as { toneMapping: { mode: number } }).toneMapping.mode,
    );
    // `ToneMappingMode.LINEAR` is 0 and `AGX` is 7 in postprocessing 6.39.
    expect(modes.at(-1)).toBe(0);
    await setTheme("photoreal");
    const after = photorealHandles.toneMapping.update.mock.calls.map(
      (c) => (c[0] as { toneMapping: { mode: number } }).toneMapping.mode,
    );
    expect(after.at(-1)).toBe(7);
  });
});

describe("scene theme -> the user's own settings", () => {
  it("overrides the exposure slider without writing it", async () => {
    await mount();
    const view = viewInstances[0]!;
    await act(async () => {
      useRenderDebugStore.setState({ exposure: 8 });
    });
    expect(view.toneMappingExposure).toBe(8);

    await setTheme("wireframe");
    expect(view.toneMappingExposure).toBe(
      sceneThemePolicy("wireframe").environment.exposure,
    );
    // The slider never moved, so leaving the theme lands back on it.
    expect(useRenderDebugStore.getState().exposure).toBe(8);
    await setTheme("photoreal");
    expect(view.toneMappingExposure).toBe(8);
  });

  it("suppresses the lens flare and restores the atmosphere panel's setting", async () => {
    await mount();
    expect(photorealHandles.lensFlare.visible).toBe(true);
    await setTheme("cartoon");
    expect(photorealHandles.lensFlare.visible).toBe(false);
    await setTheme("photoreal");
    expect(useAtmosphereStore.getState().lensFlareEnabled).toBe(true);
    expect(photorealHandles.lensFlare.visible).toBe(true);
  });

  it("suppresses the clouds a themed scene must not have, and gives them back", async () => {
    await act(async () => {
      useRenderDebugStore.setState({ cloudsEnabled: true });
    });
    await mount();
    const cloudAdds = () =>
      addEffect.mock.calls.filter(
        (c) => (c[0] as Record<string, unknown>)?.clouds !== undefined,
      ).length;
    expect(cloudAdds()).toBe(1);

    await setTheme("cyber");
    // Still ON in the user's settings; simply not rendered under this theme.
    expect(useRenderDebugStore.getState().cloudsEnabled).toBe(true);

    await setTheme("photoreal");
    expect(cloudAdds()).toBe(2);
  });

  it("never touches the solar clock", async () => {
    await mount();
    const before = atmosphere.date;
    for (const theme of [
      "cartoon",
      "cyber",
      "wireframe",
      "photoreal",
    ] as const) {
      await setTheme(theme);
    }
    // `atmosphere.date` is solar TIME: writing it round-trips into
    // `solarStore.sunPosition` and corrupts the analysis. A theme darkens a
    // scene with exposure, albedo and probe intensity, never with the clock.
    expect(atmosphere.date).toBe(before);
  });
});

describe("scene theme -> theme-to-theme transitions", () => {
  // The browser found this: photoreal->X was verified for every X, but
  // wireframe->cartoon kept wireframe's dark environment. A transition
  // between two non-photoreal themes must land on the SAME engine state a
  // fresh entry into the target theme lands on.
  it("wireframe -> cartoon applies cartoon's whole environment", async () => {
    await mount();
    const view = viewInstances[0]!;
    const cartoon = sceneThemePolicy("cartoon").environment;

    await setTheme("wireframe");
    await setTheme("cartoon");

    expect(albedoScaleUpdates().at(-1)).toBe(cartoon.apAlbedoScale);
    expect(photorealHandles.skyLightProbe.update).toHaveBeenLastCalledWith({
      skyLightProbe: { intensity: cartoon.skyLightProbeIntensity },
    });
    expect(view.toneMappingExposure).toBe(cartoon.exposure);
    expect((view.globe as { wireframe: boolean }).wireframe).toBe(false);
    // Wireframe painted the globe near-black; cartoon has no globe colour of
    // its own, so the prior (photoreal) colour must come back.
    expect((view.globe as { color: { toHex(): number } }).color.toHex()).toBe(
      ORIGINAL_GLOBE_COLOR,
    );
    // Cartoon's flat sky must exist and be visible.
    expect(meshCallsFor("skyBox")).toHaveLength(1);
  });

  it("cartoon -> cyber applies cyber's stars, halo and globe colour", async () => {
    await mount();
    const view = viewInstances[0]!;
    const cyber = sceneThemePolicy("cyber").environment;

    await setTheme("cartoon");
    await setTheme("cyber");

    expect(photorealHandles.stars.update).toHaveBeenLastCalledWith({
      stars: cyber.starsBoost,
    });
    expect(meshCallsFor("glowGlobe")).toHaveLength(1);
    // Untouched — upstream bug (i).
    expect((view.globe as { color: { toHex(): number } }).color.toHex()).toBe(
      ORIGINAL_GLOBE_COLOR,
    );
    expect(view.toneMappingExposure).toBe(cyber.exposure);
    expect(albedoScaleUpdates().at(-1)).toBe(cyber.apAlbedoScale);
  });
});

describe("scene theme -> real-engine contracts (Known Issues (i)/(j))", () => {
  // These two pin browser-found engine bugs the fakes cannot surface on their
  // own. Each would pass with the buggy code UNLESS asserted exactly here.

  it("hands the skyBox and glowGlobe descs engine Color INSTANCES, never hex", async () => {
    // The real descs call `.toArray()` on every colour at createMesh time; a
    // bare 0xRRGGBB number made `addMesh` throw and the half-registered desc
    // froze frame presentation (Known Issue (i), second half).
    await mount();
    await setTheme("cartoon");
    await setTheme("cyber");

    const colorLike = (v: unknown) =>
      typeof (v as { toArray?: unknown })?.toArray === "function" ||
      typeof (v as { toHex?: unknown })?.toHex === "function";

    const skyBox = meshCallsFor("skyBox")[0] as {
      skyBox: { dayColor: unknown; nightColor: unknown; sunColor: unknown };
    };
    expect(colorLike(skyBox.skyBox.dayColor)).toBe(true);
    expect(colorLike(skyBox.skyBox.nightColor)).toBe(true);
    expect(colorLike(skyBox.skyBox.sunColor)).toBe(true);

    const glow = meshCallsFor("glowGlobe")[0] as {
      glowGlobe: { glowColor: unknown };
    };
    expect(colorLike(glow.glowGlobe.glowColor)).toBe(true);
  });

  it("never updates the aerial perspective with albedoScale alone", async () => {
    // `onUpdateConfig` REPLACES whole config keys (Known Issue (j)): an
    // albedoScale-only update strips `irradiance`/`useNormalBuffer` from the
    // stored config, and the next internal pass rebuild reconstructs without
    // the irradiance term — every albedo pixel black at any exposure.
    await mount();
    await setTheme("wireframe");
    await setTheme("cartoon");
    await setTheme("photoreal");

    const themed = photorealHandles.aerialPerspective.update.mock.calls
      .map(
        (c) =>
          (c[0] as { aerialPerspective?: Record<string, unknown> })
            ?.aerialPerspective,
      )
      .filter((ap) => ap !== undefined && "albedoScale" in ap);
    expect(themed.length).toBeGreaterThan(0);
    for (const ap of themed) {
      expect(ap).toMatchObject({ irradiance: true, useNormalBuffer: true });
    }
  });
});
