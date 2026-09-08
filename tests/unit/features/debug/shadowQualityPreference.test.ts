import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "roofy.shadowQuality";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.resetModules();
});

async function freshStore() {
  vi.resetModules();
  return await import("../../../../src/features/debug/renderDebugStore");
}

describe("shadow quality preference", () => {
  it.each(["low", "high"] as const)(
    "initializes from valid %s storage",
    async (quality) => {
      localStorage.setItem(KEY, quality);
      const { useRenderDebugStore } = await freshStore();
      expect(useRenderDebugStore.getState().shadowQuality).toBe(quality);
    },
  );

  it.each([null, "invalid"])(
    "defaults medium for %s storage",
    async (value) => {
      if (value !== null) localStorage.setItem(KEY, value);
      const { useRenderDebugStore } = await freshStore();
      expect(useRenderDebugStore.getState().shadowQuality).toBe("medium");
    },
  );

  it("defaults medium when localStorage.getItem throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { useRenderDebugStore } = await freshStore();
    expect(useRenderDebugStore.getState().shadowQuality).toBe("medium");
  });

  it("persists setShadowQuality and reset", async () => {
    const { useRenderDebugStore } = await freshStore();
    useRenderDebugStore.getState().setShadowQuality("low");
    expect(localStorage.getItem(KEY)).toBe("low");
    useRenderDebugStore.getState().reset();
    expect(localStorage.getItem(KEY)).toBe("medium");
  });

  it("continues when localStorage.setItem throws", async () => {
    const { useRenderDebugStore } = await freshStore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    useRenderDebugStore.getState().setShadowQuality("high");
    expect(useRenderDebugStore.getState().shadowQuality).toBe("high");
  });
});
