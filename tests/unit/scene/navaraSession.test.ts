import { describe, expect, it, vi } from "vitest";
import {
  createNavaraSession,
  NavaraSessionDisposedError,
  type NavaraPluginSpec,
} from "../../../src/scene/navaraSession";

/**
 * The session module is deliberately engine-free (Task B1: NODE_IMPORT_SAFE =
 * false), so these tests never import `@navaramap/*`: the view is injected
 * through `createView` and the plugins are plain objects. The real wiring —
 * `new ThreeView(...)`, `new DefaultPlugin()`, `new CityJSONPlugin()` — happens
 * in the caller (Task B11a's viewport), which is browser-smoke territory.
 */
function makeSetup() {
  const view = {
    addPlugin: vi.fn<(plugin: unknown) => void>(),
    init: vi.fn<() => Promise<void>>(async () => {
      await new Promise((r) => setTimeout(r, 5));
    }),
    dispose: vi.fn<() => void>(),
  };
  const defaultPlugin = { addDefaultPhotorealScene: vi.fn<() => void>() };
  const cityPlugin = { id: "city" };
  const flatPlugin = { id: "flat" };
  const plugins: NavaraPluginSpec[] = [
    {
      key: "default",
      instance: defaultPlugin,
      afterInit: () => defaultPlugin.addDefaultPhotorealScene(),
    },
    { key: "cityjson", instance: cityPlugin },
    { key: "flatcitybuf", instance: flatPlugin },
  ];
  return {
    view,
    defaultPlugin,
    cityPlugin,
    flatPlugin,
    plugins,
    options: { createView: () => view, plugins },
  };
}

describe("createNavaraSession", () => {
  it("adds EVERY plugin, in list order, before init", async () => {
    const { view, cityPlugin, flatPlugin, defaultPlugin, options } =
      makeSetup();
    const session = createNavaraSession(options);
    await session.ready;

    expect(view.addPlugin.mock.calls.map((c) => c[0])).toEqual([
      defaultPlugin,
      cityPlugin,
      flatPlugin,
    ]);
    // The LAST addPlugin still precedes init: adding after init throws in
    // Navara, which is the whole reason the list exists.
    expect(view.addPlugin.mock.invocationCallOrder[2]!).toBeLessThan(
      view.init.mock.invocationCallOrder[0]!,
    );
  });

  it("returns the constructed plugin instances keyed, so callers hold typed refs", async () => {
    const { view, cityPlugin, flatPlugin, options } = makeSetup();
    const result = await createNavaraSession(options).ready;
    expect(result.view).toBe(view);
    expect(result.plugins.get("cityjson")).toBe(cityPlugin);
    expect(result.plugins.get("flatcitybuf")).toBe(flatPlugin);
  });

  it("runs afterInit hooks only after init settles", async () => {
    const { view, defaultPlugin, options } = makeSetup();
    const session = createNavaraSession(options);
    expect(defaultPlugin.addDefaultPhotorealScene).not.toHaveBeenCalled();
    await session.ready;
    expect(defaultPlugin.addDefaultPhotorealScene).toHaveBeenCalledTimes(1);
    expect(
      defaultPlugin.addDefaultPhotorealScene.mock.invocationCallOrder[0]!,
    ).toBeGreaterThan(view.init.mock.invocationCallOrder[0]!);
  });

  it("dispose before init completes REJECTS with NavaraSessionDisposedError and skips scene setup", async () => {
    const { view, defaultPlugin, options } = makeSetup();
    const session = createNavaraSession(options);
    session.dispose();
    await expect(session.ready).rejects.toBeInstanceOf(
      NavaraSessionDisposedError,
    );
    expect(defaultPlugin.addDefaultPhotorealScene).not.toHaveBeenCalled();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it("dispose is idempotent (StrictMode double cleanup)", async () => {
    const { view, options } = makeSetup();
    const session = createNavaraSession(options);
    await session.ready;
    session.dispose();
    session.dispose();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it("REJECTS with the init error instead of swallowing it into null", async () => {
    const { view, options } = makeSetup();
    view.init.mockRejectedValueOnce(new Error("wasm boom"));
    const session = createNavaraSession(options);
    await expect(session.ready).rejects.toThrow("wasm boom");
    // The dead view is still torn down, and the rejection is not a
    // NavaraSessionDisposedError, so callers can tell failure from unmount.
    expect(view.dispose).toHaveBeenCalledTimes(1);
    await expect(session.ready).rejects.not.toBeInstanceOf(
      NavaraSessionDisposedError,
    );
  });

  it("does not emit an unhandled rejection when nobody awaits ready", async () => {
    const { view, options } = makeSetup();
    view.init.mockRejectedValueOnce(new Error("wasm boom"));
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    createNavaraSession(options).dispose();
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", onUnhandled);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it("rejects — and disposes the half-built view — when createView throws", async () => {
    const boom = new Error("no webgl");
    const session = createNavaraSession({
      createView: () => {
        throw boom;
      },
      plugins: [],
    });
    await expect(session.ready).rejects.toBe(boom);
    // Nothing to tear down, and dispose() must not explode on a null view.
    expect(() => session.dispose()).not.toThrow();
  });

  it("rejects and disposes when an afterInit hook throws", async () => {
    const { view, options, plugins } = makeSetup();
    const boom = new Error("photoreal boom");
    plugins[0]!.afterInit = () => {
      throw boom;
    };
    const session = createNavaraSession(options);
    await expect(session.ready).rejects.toBe(boom);
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects on duplicate plugin keys rather than silently shadowing an instance", async () => {
    const { view, options, plugins } = makeSetup();
    plugins.push({ key: "cityjson", instance: { id: "impostor" } });
    const session = createNavaraSession(options);
    await expect(session.ready).rejects.toThrow(/duplicate.*cityjson/i);
    expect(view.init).not.toHaveBeenCalled();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });
});
