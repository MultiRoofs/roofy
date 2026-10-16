import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "shadow-quality";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.resetModules();
});

/** A fresh module graph, with `stored` already in the preference cache. */
async function freshStore(stored?: string) {
  vi.resetModules();
  const storage =
    await import("../../../../src/persistence/storage/appStorage");
  if (stored !== undefined) storage.appPreferences.set(KEY, stored);
  const store = await import("../../../../src/features/debug/renderDebugStore");
  return { ...storage, ...store };
}

describe("shadow quality preference", () => {
  it.each(["low", "high"] as const)(
    "initializes from a stored %s",
    async (quality) => {
      const { useRenderDebugStore } = await freshStore(quality);
      expect(useRenderDebugStore.getState().shadowQuality).toBe(quality);
    },
  );

  it.each([undefined, "invalid"])("defaults medium for %s", async (value) => {
    const { useRenderDebugStore } = await freshStore(value);
    expect(useRenderDebugStore.getState().shadowQuality).toBe("medium");
  });

  it("persists setShadowQuality and reset through the storage backend", async () => {
    const { useRenderDebugStore, appPreferences, appStorageBackend } =
      await freshStore();
    useRenderDebugStore.getState().setShadowQuality("low");
    expect(appPreferences.get(KEY)).toBe("low");
    await vi.waitFor(async () =>
      expect(await appStorageBackend.get("preference", KEY)).toBe("low"),
    );
    useRenderDebugStore.getState().reset();
    expect(appPreferences.get(KEY)).toBe("medium");
  });

  it("applies the choice when the backend cannot store it", async () => {
    const { useRenderDebugStore } = await freshStore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useRenderDebugStore.getState().setShadowQuality("high");
    expect(useRenderDebugStore.getState().shadowQuality).toBe("high");
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
