/**
 * Unit tests for LocalStorageProjectStateStore.
 *
 * Uses jsdom's built-in localStorage. Each test gets a clean slate
 * via beforeEach clear.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStorageProjectStateStore } from "../../../src/persistence/localStorage";
import type { ProjectSnapshot } from "../../../src/persistence/types";

function makeSnapshot(
  overrides: Partial<ProjectSnapshot> = {},
): ProjectSnapshot {
  return {
    version: "4",
    savedAt: "2025-06-21T12:00:00Z",
    label: "Test snapshot",
    layers: [
      {
        name: "delft",
        modelRef: { type: "url", url: "https://example.com/model.city.json" },
        rules: [],
        rulesEnabled: true,
        visible: true,
      },
    ],
    viewState: {
      camera: {
        lng: 4.3571,
        lat: 52.0116,
        height: 800,
        heading: 30,
        pitch: -45,
        roll: 0,
      },
      datetime: "2025-06-21T12:00:00Z",
    },
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
    expect(loaded!.version).toBe("4");
    expect(loaded!.layers![0]!.modelRef).toEqual({
      type: "url",
      url: "https://example.com/model.city.json",
    });
    expect(loaded!.viewState.camera).toEqual({
      lng: 4.3571,
      lat: 52.0116,
      height: 800,
      heading: 30,
      pitch: -45,
      roll: 0,
    });
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

  it("preserves per-layer rules in the snapshot", async () => {
    const snapshot = makeSnapshot({
      layers: [
        {
          name: "delft",
          modelRef: { type: "url", url: "https://example.com/model.city.json" },
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
          rulesEnabled: true,
          visible: true,
        },
      ],
    });

    const id = await store.save(snapshot);
    const loaded = await store.load(id);

    expect(loaded!.layers![0]!.rules).toHaveLength(1);
    expect(loaded!.layers![0]!.rules[0]!.name).toBe("South-facing");
    expect(loaded!.layers![0]!.rules[0]!.conditions[0]!.field).toBe(
      "azimuthDeg",
    );
  });

  it("preserves a file-backed layer's model reference", async () => {
    const snapshot = makeSnapshot({
      layers: [
        {
          name: "delft",
          modelRef: { type: "file", fileName: "delft.city.json" },
          rules: [],
          rulesEnabled: true,
          visible: true,
        },
      ],
    });

    const id = await store.save(snapshot);
    const loaded = await store.load(id);

    expect(loaded!.layers![0]!.modelRef).toEqual({
      type: "file",
      fileName: "delft.city.json",
    });
  });

  it("handles a snapshot with no layers", async () => {
    const snapshot = makeSnapshot({ layers: [] });
    const id = await store.save(snapshot);
    const loaded = await store.load(id);

    expect(loaded!.layers).toEqual([]);
  });

  it("multiple saves create distinct IDs", async () => {
    const id1 = await store.save(makeSnapshot({ label: "A" }));
    const id2 = await store.save(makeSnapshot({ label: "B" }));

    expect(id1).not.toBe(id2);
  });
});

it("updates a saved workspace in place without adding a duplicate", async () => {
  localStorage.clear();
  const store = new LocalStorageProjectStateStore();
  const id = await store.save(makeSnapshot());
  await store.update(id, makeSnapshot({ label: "Renamed" }));
  expect((await store.list()).map((s) => s.label)).toEqual(["Renamed"]);
  expect((await store.load(id))?.label).toBe("Renamed");
});
