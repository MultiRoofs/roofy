import { describe, expect, it, vi } from "vitest";
import { MemoryBackend } from "../../../../src/persistence/storage/memoryBackend";
import {
  createPreferenceStore,
  PREFERENCE_NAMESPACE,
} from "../../../../src/persistence/storage/preferenceStore";
import type { StorageBackend } from "../../../../src/persistence/storage/backend";

describe("createPreferenceStore", () => {
  it("reads nothing before hydrate, and what the backend holds after", async () => {
    const backend = new MemoryBackend();
    await backend.put(PREFERENCE_NAMESPACE, "theme", "dark");
    const prefs = createPreferenceStore(backend);
    expect(prefs.get("theme")).toBeNull();
    await prefs.hydrate();
    expect(prefs.get("theme")).toBe("dark");
  });

  it("answers a write at once and persists it behind", async () => {
    const backend = new MemoryBackend();
    const prefs = createPreferenceStore(backend);
    prefs.set("theme", "light");
    expect(prefs.get("theme")).toBe("light");
    await vi.waitFor(async () =>
      expect(await backend.get(PREFERENCE_NAMESPACE, "theme")).toBe("light"),
    );
    prefs.set("theme", null);
    expect(prefs.get("theme")).toBeNull();
    await vi.waitFor(async () =>
      expect(await backend.get(PREFERENCE_NAMESPACE, "theme")).toBeNull(),
    );
  });

  it("keeps the value for the session when the backend refuses it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refusing: StorageBackend = {
      get: async () => null,
      list: async () => [],
      delete: async () => {},
      put: async () => {
        throw new Error("blocked");
      },
    };
    const prefs = createPreferenceStore(refusing);
    prefs.set("theme", "dark");
    expect(prefs.get("theme")).toBe("dark");
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
