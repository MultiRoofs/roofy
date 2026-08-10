/**
 * NavaraViewport solar wiring (Task C16).
 *
 * Companion to `navaraViewport.test.tsx` (the static half) and
 * `navaraViewportStreaming.test.tsx`. Same rules: the engine and both plugin
 * subpaths are MOCKED and never imported for real — `@navaramap/three` crashes
 * at module scope under Node (Task B1: NODE_IMPORT_SAFE = false) and jsdom has
 * no WebGL. The real sun is checked in the browser smoke.
 *
 * What is asserted here is the WIRING, all of it through the mocked bus:
 *
 *  - the loaded layers' bounds become `solarStore.latLon` — the site the sun is
 *    read at, and the one the toolbar's `SolarPresetMenu` shows;
 *  - `solarStore.datetime` reaches `atmosphere.date`, and a share-link restore
 *    or a slider edit does too;
 *  - `preUpdate` drives the atmosphere EVERY frame while the clock runs, but
 *    the store — and therefore React — only on the ~10 Hz beat;
 *  - `sunChanged` reaches `solarStore.setSunPosition` in the site's local ENU
 *    frame, and is ignored while the clock runs (the beat publishes instead);
 *  - a pause leaves the clock the user reads equal to the sky they see, without
 *    rewinding the atmosphere.
 *
 * The animation is driven by the timestamp the engine passes to `preUpdate`,
 * so every case below is deterministic without fake timers.
 */
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const init = vi.fn(async () => {});
const dispose = vi.fn();

/** The view's event bus, reduced to `on`/`off`. */
const listeners = new Map<string, Set<(...args: never[]) => void>>();
const on = vi.fn((name: string, fn: (...args: never[]) => void) => {
  const set = listeners.get(name) ?? new Set();
  set.add(fn);
  listeners.set(name, set);
});
const off = vi.fn((name: string, fn: (...args: never[]) => void) => {
  listeners.get(name)?.delete(fn);
});

/** The atmosphere's own bus — `sunChanged` lives here, not on the view. */
const atmosphereListeners = new Map<string, Set<(...args: never[]) => void>>();

/** Every date the viewport wrote to `atmosphere.date`, in order. */
let dateWrites: Date[] = [];
/** What `getSunDirection()` answers, in ECEF. */
let sunDirection = { x: 1, y: 0, z: 0 };

const atmosphere = {
  _date: new Date("2000-01-01T00:00:00.000Z"),
  get date() {
    return this._date;
  },
  set date(v: Date) {
    this._date = v;
    dateWrites.push(v);
  },
  getSunDirection: vi.fn(() => sunDirection),
  on: vi.fn((name: string, fn: (...args: never[]) => void) => {
    const set = atmosphereListeners.get(name) ?? new Set();
    set.add(fn);
    atmosphereListeners.set(name, set);
  }),
  off: vi.fn((name: string, fn: (...args: never[]) => void) => {
    atmosphereListeners.get(name)?.delete(fn);
  }),
};

/** Fire an engine event inside `act`, the only input surface this wiring has. */
function fire(name: string, ...args: unknown[]): void {
  act(() => {
    for (const fn of [...(listeners.get(name) ?? [])]) {
      (fn as (...a: unknown[]) => void)(...args);
    }
  });
}
function fireSunChanged(): void {
  act(() => {
    for (const fn of [...(atmosphereListeners.get("sunChanged") ?? [])]) {
      (fn as (...a: unknown[]) => void)(sunDirection);
    }
  });
}

/** One animation frame, at the engine's own `DOMHighResTimeStamp`. */
function frame(t: number): void {
  fire("preUpdate", t);
}
/** `count` frames on a 16 ms cadence, starting at `from`. */
function frames(count: number, from = 0, stepMs = 16): number {
  let t = from;
  for (let i = 0; i < count; i++) {
    frame(t);
    t += stepMs;
  }
  return t - stepMs;
}

vi.mock("@navaramap/three", () => ({
  // The engine's terrarium DEM decoder — the elevation-heatmap basemap's
  // source names it as a MARKER in `basemaps.ts` (engine-free) and the
  // viewport resolves it here, at the engine seam.
  TERRARIUM_ELEVATION_DECODER: vi.fn(() => ({ decoder: "terrarium" })),
  // The base classes the theme's bloom descriptor is built out of
  // (`bloomEffect.ts`, reached through `NavaraViewport`'s import). Every named
  // import of a mocked module has to exist or the mock refuses to link, so
  // these are here even though nothing in this suite ever enters a themed look
  // — the bloom behaviour itself is covered in `navaraViewportTheme.test.tsx`.
  EffectDesc: class {},
  Effect: class {},
  default: vi.fn(function () {
    return {
      addPlugin: vi.fn(),
      init,
      dispose,
      on,
      off,
      atmosphere,
      camera: {
        raw: {},
        positionGeographic: { lng: 4.35, lat: 52, height: 500 },
        orientation: { heading: 0, pitch: -60, roll: 0 },
        // The compass overlay subscribes to `movestart`/`move`/`moveend`,
        // which live on the CAMERA rather than the view (Task B1 finding 6).
        on: vi.fn(),
        off: vi.fn(),
      },
      setCamera: vi.fn(),
      flyTo: vi.fn(),
      screenSize: { x: 800, y: 600 },
      pixelRatio: 1,
      pickDepthPosition: vi.fn(() => null as unknown),
    };
  }),
  getPickRay: vi.fn(() => null as unknown),
  vector3ToGeodetic: vi.fn(() => ({ lng: 0, lat: 0, height: 0 })),
  radianToDegree: vi.fn((r: number) => (r * 180) / Math.PI),
}));

vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(function () {
    return { addDefaultPhotorealScene: vi.fn() };
  }),
}));

const cityPluginInstance = { getHandle: vi.fn(), addCityModel: vi.fn() };
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
import { useSolarStore } from "../../../src/features/solar/solarStore";
import type { CityModel } from "../../../src/domain/citymodel/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The bounds every handle reports; its centre is the site under test. */
const BOUNDS = {
  west: 4.35,
  south: 52,
  east: 4.36,
  north: 52.01,
  minHeight: 0,
  maxHeight: 20,
};
const SITE = { lat: 52.005, lon: 4.355 };

function makeLayer(id: string): Layer {
  return {
    id,
    name: id,
    model: {
      objects: {},
      vertices: [],
      transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
      metadata: {
        referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415",
      },
      bbox: [0, 0, 0, 1, 1, 1],
    } as unknown as CityModel,
    modelRef: { type: "url", url: `https://example.test/${id}` },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: "2.2",
    availableLods: ["2.2"],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    isStreaming: false,
  } as Layer;
}

function makeHandle(id: string) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    // The real `CityModelHandle` gained this with the scene themes; the
    // viewport pushes the active theme's style on the same beat as LoD.
    setThemeStyle: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(() => null as unknown),
    batchIdMap: vi.fn(() => []),
    triangleCount: vi.fn(() => 10),
    heightOffset: vi.fn(() => 0),
    getBoundsGeodetic: vi.fn(() => BOUNDS),
    delete: vi.fn(),
  };
}

/** The ECEF direction of "straight up" at the site — the sun at the zenith. */
function zenithEcef(site: { lat: number; lon: number }) {
  const phi = (site.lat * Math.PI) / 180;
  const lam = (site.lon * Math.PI) / 180;
  return {
    x: Math.cos(phi) * Math.cos(lam),
    y: Math.cos(phi) * Math.sin(lam),
    z: Math.sin(phi),
  };
}

/** Renders the viewport with one layer loaded and the engine up. */
async function mountWithLayer() {
  useLayerStore.setState({ layers: [makeLayer("a")], activeLayerId: "a" });
  const result = render(<NavaraViewport onTriangleCount={() => {}} />);
  await waitFor(() =>
    expect(cityPluginInstance.addCityModel).toHaveBeenCalledTimes(1),
  );
  await waitFor(() => expect(useSolarStore.getState().latLon).not.toBeNull());
  dateWrites = [];
  return result;
}

describe("NavaraViewport solar wiring", () => {
  beforeEach(() => {
    listeners.clear();
    atmosphereListeners.clear();
    dateWrites = [];
    sunDirection = zenithEcef(SITE);
    init.mockClear();
    dispose.mockClear();
    on.mockClear();
    off.mockClear();
    atmosphere.on.mockClear();
    atmosphere.off.mockClear();
    atmosphere._date = new Date("2000-01-01T00:00:00.000Z");
    cityPluginInstance.getHandle.mockReset();
    cityPluginInstance.addCityModel.mockReset();
    cityPluginInstance.addCityModel.mockImplementation(
      (_model: unknown, opts: { id: string }) => makeHandle(opts.id),
    );
    useLayerStore.setState({ layers: [], activeLayerId: null });
    useSolarStore.setState({
      datetime: new Date("2026-06-21T12:00:00.000Z"),
      latLon: null,
      sunPosition: null,
      timeAnimating: false,
      timeSpeed: 60,
    });
  });

  afterEach(() => {
    cleanup();
    useLayerStore.setState({ layers: [], activeLayerId: null });
    useSolarStore.setState({ timeAnimating: false, latLon: null });
  });

  // -------------------------------------------------------------------------
  // The site
  // -------------------------------------------------------------------------

  it("publishes the loaded layers' centre as the solar site", async () => {
    await mountWithLayer();
    // Bounds, not the model's CRS + bbox: a streaming layer has only bounds.
    const latLon = useSolarStore.getState().latLon!;
    expect(latLon.lat).toBeCloseTo(SITE.lat, 9);
    expect(latLon.lon).toBeCloseTo(SITE.lon, 9);
  });

  it("drops the site — and the sun with it — when the last layer goes", async () => {
    await mountWithLayer();
    expect(useSolarStore.getState().sunPosition).not.toBeNull();
    await act(async () => {
      useLayerStore.setState({ layers: [], activeLayerId: null });
    });
    await waitFor(() => expect(useSolarStore.getState().latLon).toBeNull());
    expect(useSolarStore.getState().sunPosition).toBeNull();
  });

  // -------------------------------------------------------------------------
  // datetime -> atmosphere.date
  // -------------------------------------------------------------------------

  it("pushes the store's datetime into the atmosphere as soon as the engine is up", async () => {
    const restored = new Date("2026-12-24T09:30:00.000Z");
    useSolarStore.setState({ datetime: restored });
    render(<NavaraViewport onTriangleCount={() => {}} />);
    // The engine boots on the real clock; a restored share link must win.
    await waitFor(() => expect(atmosphere.date).toBe(restored));
  });

  it("pushes a later edit (the slider, a restore) into the atmosphere", async () => {
    await mountWithLayer();
    const edited = new Date("2026-06-21T18:45:00.000Z");
    act(() => useSolarStore.getState().setDatetime(edited));
    expect(dateWrites.at(-1)).toBe(edited);
  });

  // -------------------------------------------------------------------------
  // sunChanged -> setSunPosition
  // -------------------------------------------------------------------------

  it("publishes the engine's ECEF sun in the site's local ENU frame", async () => {
    await mountWithLayer();
    // Sun at the site's zenith: 90 deg up, whatever the ECEF numbers are.
    const sun = useSolarStore.getState().sunPosition;
    expect(sun).not.toBeNull();
    expect(sun!.altitudeDeg).toBeCloseTo(90, 6);
    expect(sun!.direction[2]).toBeCloseTo(1, 6);
  });

  it("republishes on sunChanged while the clock is stopped", async () => {
    await mountWithLayer();
    // Due south, on the horizon: the ECEF equatorial direction at the site's
    // longitude (`sunWriter.test.ts` pins the geometry).
    const lam = (SITE.lon * Math.PI) / 180;
    sunDirection = { x: Math.cos(lam), y: Math.sin(lam), z: 0 };
    fireSunChanged();
    const sun = useSolarStore.getState().sunPosition!;
    expect(sun.azimuthDeg).toBeCloseTo(180, 6);
    expect(sun.altitudeDeg).toBeCloseTo(90 - SITE.lat, 6);
  });

  it("has no sun to publish before a site exists", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(atmosphere.getSunDirection).toBeDefined());
    fireSunChanged();
    expect(useSolarStore.getState().sunPosition).toBeNull();
  });

  // -------------------------------------------------------------------------
  // The animation
  // -------------------------------------------------------------------------

  it("drives the atmosphere every frame and the store only on the beat", async () => {
    await mountWithLayer();
    const setDatetime = vi.spyOn(useSolarStore.getState(), "setDatetime");
    act(() => useSolarStore.getState().setTimeAnimating(true));

    // 32 frames at 16 ms = ~half a second of wall clock.
    frames(32);

    // Every frame after the first (which only establishes the timestamp) moved
    // the atmosphere: this is what makes the shadows sweep smoothly.
    expect(dateWrites).toHaveLength(31);
    // …but the store — and every React readout with it — saw ~10 Hz.
    expect(setDatetime.mock.calls.length).toBeLessThanOrEqual(5);
    expect(setDatetime.mock.calls.length).toBeGreaterThanOrEqual(4);
    // 496 ms of wall clock at 60x is ~29.8 s of model time.
    const advanced =
      dateWrites.at(-1)!.getTime() -
      new Date("2026-06-21T12:00:00.000Z").getTime();
    expect(advanced / 1000).toBeCloseTo(29.76, 1);
  });

  it("never re-renders a solar readout per frame", async () => {
    const renders = vi.fn();
    function SolarProbe() {
      const datetime = useSolarStore((s) => s.datetime);
      const sun = useSolarStore((s) => s.sunPosition);
      renders(datetime, sun);
      return null;
    }
    useLayerStore.setState({ layers: [makeLayer("a")], activeLayerId: "a" });
    render(
      <>
        <NavaraViewport onTriangleCount={() => {}} />
        <SolarProbe />
      </>,
    );
    await waitFor(() => expect(useSolarStore.getState().latLon).not.toBeNull());
    act(() => useSolarStore.getState().setTimeAnimating(true));
    renders.mockClear();

    frames(32);

    // The engine's clock ran 31 times; React saw the ~10 Hz beat. Without the
    // imperative path this would be one render per frame across the toolbar,
    // the solar tab and the analysis tab.
    expect(renders.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("ignores sunChanged while the clock runs — the beat publishes instead", async () => {
    await mountWithLayer();
    const setSunPosition = vi.spyOn(useSolarStore.getState(), "setSunPosition");
    act(() => useSolarStore.getState().setTimeAnimating(true));

    // The engine emits `sunChanged` once per frame while the date moves.
    for (let i = 0; i < 32; i++) {
      frame(i * 16);
      fireSunChanged();
    }
    expect(setSunPosition.mock.calls.length).toBeLessThanOrEqual(5);
    // …and the readout is still the live one, not a stale first frame.
    expect(useSolarStore.getState().sunPosition!.altitudeDeg).toBeCloseTo(
      90,
      6,
    );
  });

  it("caps a tab-refocus gap instead of teleporting the sun", async () => {
    await mountWithLayer();
    act(() => useSolarStore.getState().setTimeAnimating(true));
    frame(0);
    frame(5000); // five seconds away from the tab
    // 100 ms of frame delta at 60x = 6 s of model time, not five minutes.
    expect(
      dateWrites.at(-1)!.getTime() -
        new Date("2026-06-21T12:00:00.000Z").getTime(),
    ).toBe(6000);
  });

  it("leaves the clock the user reads equal to the sky, on pause", async () => {
    await mountWithLayer();
    act(() => useSolarStore.getState().setTimeAnimating(true));
    const t = frames(32);
    const shown = dateWrites.at(-1)!;
    // Between beats the store is behind the atmosphere...
    expect(useSolarStore.getState().datetime).not.toBe(shown);

    act(() => useSolarStore.getState().setTimeAnimating(false));
    const writesBeforeFlush = dateWrites.length;
    frame(t + 16);

    // ...and the pause publishes the animation's last value, WITHOUT rewinding
    // the atmosphere to the store's older one.
    expect(useSolarStore.getState().datetime).toBe(shown);
    expect(dateWrites).toHaveLength(writesBeforeFlush);
  });

  it("stops advancing when the clock is stopped", async () => {
    await mountWithLayer();
    frames(10);
    expect(dateWrites).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it("unsubscribes preUpdate and sunChanged when the engine goes away", async () => {
    const { unmount } = await mountWithLayer();
    expect(on.mock.calls.some((c) => c[0] === "preUpdate")).toBe(true);
    expect(atmosphere.on.mock.calls.some((c) => c[0] === "sunChanged")).toBe(
      true,
    );
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalled());
    expect(off.mock.calls.some((c) => c[0] === "preUpdate")).toBe(true);
    expect(atmosphere.off.mock.calls.some((c) => c[0] === "sunChanged")).toBe(
      true,
    );
    expect(listeners.get("preUpdate")?.size ?? 0).toBe(0);
    expect(atmosphereListeners.get("sunChanged")?.size ?? 0).toBe(0);
  });

  it("clears the site when the viewport goes away with its layers", async () => {
    // `App.tsx` unmounts the viewport in the SAME commit that empties the
    // layer store (`handleClose`), so the site effect never runs for that
    // change — the teardown has to do it, or the solar readouts keep
    // describing a model that is gone.
    const { unmount } = await mountWithLayer();
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalled());
    expect(useSolarStore.getState().latLon).toBeNull();
    expect(useSolarStore.getState().sunPosition).toBeNull();
  });

  it("subscribes exactly once across a StrictMode double mount", async () => {
    useLayerStore.setState({ layers: [makeLayer("a")], activeLayerId: "a" });
    render(
      <StrictMode>
        <NavaraViewport onTriangleCount={() => {}} />
      </StrictMode>,
    );
    await waitFor(() => expect(useSolarStore.getState().latLon).not.toBeNull());
    expect(listeners.get("preUpdate")?.size ?? 0).toBe(1);
    expect(atmosphereListeners.get("sunChanged")?.size ?? 0).toBe(1);
  });
});
