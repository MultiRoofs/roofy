/**
 * Unit tests for LocalStorageProjectStateStore.
 *
 * Uses jsdom's built-in localStorage. Each test gets a clean slate
 * via beforeEach clear.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStorageProjectStateStore } from "../../../src/persistence/localStorage";
import type { ProjectSnapshot } from "../../../src/persistence/types";

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    version: "1",
    savedAt: "2025-06-21T12:00:00Z",
    label: "Test snapshot",
    modelRef: { type: "url", url: "https://example.com/model.city.json" },
    viewState: {
      cameraPosition: [50, 50, 50],
      cameraTarget: [0, 0, 0],
      datetime: "2025-06-21T12:00:00Z",
    },
    rules: [],
    rulesEnabled: true,
    pickMode: "object",
    ...overrides,
  };
}

describe("LocalStorageProjectStateStore", () => {
  let store: LocalStorageProjectStateStore;

  beforeEach(() => {
    localStorage.clear();
    store = new LocalStorageProjectStateStore();
  });

  it("save returns a UUID and load retrieves the snapshot", async () => {
    const snapshot = makeSnapshot();
    const id = await store.save(snapshot);

    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(8);

    const loaded = await store.load(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.label).toBe("Test snapshot");
    expect(loaded!.modelRef).toEqual({ type: "url", url: "https://example.com/model.city.json" });
    expect(loaded!.viewState.cameraPosition).toEqual([50, 50, 50]);
  });

  it("list returns summaries of all saved snapshots", async () => {
    await store.save(makeSnapshot({ label: "First" }));
    await store.save(makeSnapshot({ label: "Second" }));

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.label)).toContain("First");
    expect(list.map((s) => s.label)).toContain("Second");
  });

  it("remove deletes a snapshot and updates the index", async () => {
    const id = await store.save(makeSnapshot());
    await store.remove(id);

    const loaded = await store.load(id);
    expect(loaded).toBeNull();

    const list = await store.list();
    expect(list).toHaveLength(0);
  });

  it("load returns null for unknown ID", async () => {
    const loaded = await store.load("nonexistent-id");
    expect(loaded).toBeNull();
  });

  it("preserves rules in the snapshot", async () => {
    const snapshot = makeSnapshot({
      rules: [
        {
          id: "r1",
          name: "South-facing",
          color: "#ff0000",
          conditions: [{ field: "azimuthDeg", operator: ">", value: 135 }],
          logic: "AND",
          enabled: true,
        },
      ],
    });

    const id = await store.save(snapshot);
    const loaded = await store.load(id);

    expect(loaded!.rules).toHaveLength(1);
    expect(loaded!.rules[0]!.name).toBe("South-facing");
    expect(loaded!.rules[0]!.conditions[0]!.field).toBe("azimuthDeg");
  });

  it("preserves file model reference", async () => {
    const snapshot = makeSnapshot({
      modelRef: { type: "file", fileName: "delft.city.json" },
    });

    const id = await store.save(snapshot);
    const loaded = await store.load(id);

    expect(loaded!.modelRef).toEqual({ type: "file", fileName: "delft.city.json" });
  });

  it("handles null modelRef", async () => {
    const snapshot = makeSnapshot({ modelRef: null });
    const id = await store.save(snapshot);
    const loaded = await store.load(id);

    expect(loaded!.modelRef).toBeNull();
  });

  it("multiple saves create distinct IDs", async () => {
    const id1 = await store.save(makeSnapshot({ label: "A" }));
    const id2 = await store.save(makeSnapshot({ label: "B" }));

    expect(id1).not.toBe(id2);
  });
});
