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

  it("lands writes to one key in the order they were made", async () => {
    const backend = new MemoryBackend();
    const put = backend.put.bind(backend);
    // The first write is the slow one, as a request to a server can be.
    let first = true;
    vi.spyOn(backend, "put").mockImplementation(async (ns, key, value) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 20));
      }
      await put(ns, key, value);
    });
    const prefs = createPreferenceStore(backend);
    prefs.set("theme", "dark");
    prefs.set("theme", "light");
    await vi.waitFor(async () => {
      expect(backend.put).toHaveBeenCalledTimes(2);
      await new Promise((r) => setTimeout(r, 30));
      expect(await backend.get(PREFERENCE_NAMESPACE, "theme")).toBe("light");
    });
  });

  it("keeps a value set while the backend was still being read", async () => {
    const backend = new MemoryBackend();
    await backend.put(PREFERENCE_NAMESPACE, "theme", "dark");
    // The write is still on its way when the read answers with the old value.
    vi.spyOn(backend, "put").mockImplementation(() => new Promise(() => {}));
    const prefs = createPreferenceStore(backend);
    const hydrated = prefs.hydrate();
    prefs.set("theme", "light");
    await hydrated;
    expect(prefs.get("theme")).toBe("light");
  });
});
