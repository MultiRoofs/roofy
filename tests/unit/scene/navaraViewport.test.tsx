/**
 * NavaraViewport lifecycle tests.
 *
 * The engine is MOCKED here and never imported for real: `@navaramap/three`
 * crashes at module scope under Node (Task B1: NODE_IMPORT_SAFE = false), and
 * jsdom has no WebGL anyway. The real engine is exercised by the browser smoke
 * (docs/superpowers/research/assets/b11a-navara-viewport-globe.png), not here.
 */
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const addPlugin = vi.fn();
const init = vi.fn(async () => {});
const dispose = vi.fn();
const setCamera = vi.fn();
const flyTo = vi.fn();
const on = vi.fn();
const off = vi.fn();
const viewInstances: unknown[] = [];
const viewOptions: unknown[] = [];
/** Reproduces the engine's real pre-first-frame behaviour (see the test). */
let cameraThrows = false;

// NOTE: the factories below are `function` expressions, not arrows — the
// component calls `new ThreeView(...)` / `new DefaultPlugin()`, and an arrow
// is not constructible.
vi.mock("@navaramap/three", () => ({
  default: vi.fn(function (options: unknown) {
    viewOptions.push(options);
    const view = {
      addPlugin,
      init,
      dispose,
      on,
      off,
      camera: {
        get positionGeographic() {
          if (cameraThrows) throw new Error("Invariant failed");
          return { lng: 4.35, lat: 52, height: 500 };
        },
        orientation: { heading: 0, pitch: -60, roll: 0 },
      },
      setCamera,
      flyTo,
    };
    viewInstances.push(view);
    return view;
  }),
}));

const defaultPluginInstance = { addDefaultPhotorealScene: vi.fn() };
vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(function () {
    return defaultPluginInstance;
  }),
}));

const cityPluginInstance = { getHandle: vi.fn(), addCityModel: vi.fn() };
const CityJSONPluginMock = vi.fn(function () {
  return cityPluginInstance;
});
vi.mock("@cityjson/navara-cityjson/plugin", () => ({
  CityJSONPlugin: CityJSONPluginMock,
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";

describe("NavaraViewport lifecycle", () => {
  beforeEach(() => {
    addPlugin.mockClear();
    init.mockClear();
    dispose.mockClear();
    setCamera.mockClear();
    flyTo.mockClear();
    on.mockClear();
    off.mockClear();
    CityJSONPluginMock.mockClear();
    init.mockImplementation(async () => {});
    defaultPluginInstance.addDefaultPhotorealScene.mockClear();
    viewInstances.length = 0;
    viewOptions.length = 0;
    cameraThrows = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("registers DefaultPlugin then CityJSONPlugin, both before view.init()", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addPlugin.mock.calls.map((c) => c[0])).toEqual([
      defaultPluginInstance,
      cityPluginInstance,
    ]);
    expect(addPlugin.mock.invocationCallOrder[1]!).toBeLessThan(
      init.mock.invocationCallOrder[0]!,
    );
  });

  it("adds the photoreal scene after init, and resolves `ready`", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(
      defaultPluginInstance.addDefaultPhotorealScene,
    ).toHaveBeenCalledTimes(1);
    expect(
      defaultPluginInstance.addDefaultPhotorealScene.mock
        .invocationCallOrder[0]!,
    ).toBeGreaterThan(init.mock.invocationCallOrder[0]!);
  });

  it("builds the view on a real container, with picking and shadows", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    const options = viewOptions[0] as Record<string, unknown>;
    expect(options.container).toBeInstanceOf(HTMLElement);
    expect(options.picking).toBe(true);
    expect(options.shadow).toBe(true);
    // Task B1 finding 3: `Options` has no `useNormal` field.
    expect("useNormal" in options).toBe(false);
  });

  it("REJECTS `ready` and shows an error panel when view.init() fails", async () => {
    init.mockRejectedValueOnce(new Error("wasm boom"));
    const ref = createRef<CitySceneHandle>();
    const { findByRole } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).rejects.toThrow("wasm boom");
    // The failure is visible, not just a console line: C20's restore flow
    // catches the rejection, and the user sees why nothing rendered.
    expect((await findByRole("alert")).textContent).toMatch(/wasm boom/);
  });

  it("getCameraState reads the engine camera; setCameraState writes it", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    expect(ref.current!.getCameraState()).toEqual({
      lng: 4.35,
      lat: 52,
      height: 500,
      heading: 0,
      pitch: -60,
      roll: 0,
    });

    const restored = {
      lng: 1,
      lat: 2,
      height: 3,
      heading: 4,
      pitch: 5,
      roll: 6,
    };
    ref.current!.setCameraState(restored);
    expect(setCamera).toHaveBeenCalledWith(restored);
  });

  it("has no camera state before the engine is up", () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    // The effect has run but `ready` has not settled yet.
    expect(ref.current!.getCameraState()).toBeNull();
    expect(() => {
      ref.current!.setCameraState({
        lng: 0,
        lat: 0,
        height: 0,
        heading: 0,
        pitch: 0,
        roll: 0,
      });
    }).not.toThrow();
  });

  it("reports no camera instead of throwing before the first frame", async () => {
    // BROWSER-VERIFIED: between `view.init()` resolving and the first rendered
    // frame, `camera.positionGeographic` throws a bare "Invariant failed".
    // C20's autosave/share capture must survive that window.
    cameraThrows = true;
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    expect(ref.current!.getCameraState()).toBeNull();
  });

  it("moves no camera while there are no bounds to fit (layers land in B11b)", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    ref.current!.fitAll();
    ref.current!.fitLayer("nope");
    ref.current!.alignView("top");
    expect(flyTo).not.toHaveBeenCalled();
    expect(setCamera).not.toHaveBeenCalled();
  });

  it("disposes the view on unmount", async () => {
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("builds exactly ONE engine across a StrictMode double mount", async () => {
    // Not cosmetic: `@navaramap/three` keeps its worker pool in a module-level
    // singleton, and a second `view.init()` overlapping the first throws
    // "Worker pool has already been initialized." — verified in the browser
    // before the mount serialisation went in.
    const ref = createRef<CitySceneHandle>();
    const { queryByRole } = render(
      <StrictMode>
        <NavaraViewport ref={ref} onTriangleCount={() => {}} />
      </StrictMode>,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(queryByRole("alert")).toBeNull();
    expect(viewInstances).toHaveLength(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(ref.current!.getCameraState()).not.toBeNull();
  });

  it("subscribes to postRender only when an FPS callback is given", async () => {
    const { unmount } = render(
      <NavaraViewport onTriangleCount={() => {}} onFps={() => {}} />,
    );
    await waitFor(() =>
      expect(on.mock.calls.some((c) => c[0] === "postRender")).toBe(true),
    );
    unmount();
    expect(off.mock.calls.some((c) => c[0] === "postRender")).toBe(true);
  });
});
