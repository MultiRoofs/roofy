import { describe, it, expect } from "vitest";
import { migrateSnapshot } from "../../../src/persistence/types";

describe("migrateSnapshot", () => {
  it("upgrades a v1 snapshot, defaulting lodMode to auto", () => {
    const v1 = {
      version: 1,
      layers: [{ id: "a", name: "x", selectedLod: "2.2" }],
    };
    const v2 = migrateSnapshot(v1 as never);
    expect(v2.version).toBe(2);
    expect(v2.layers[0]!.lodMode).toBe("auto");
    expect(v2.layers[0]!.selectedLod).toBe("2.2");
  });

  it("preserves streaming source metadata on a v2 snapshot", () => {
    const v2in = {
      version: 2,
      layers: [
        {
          id: "a",
          name: "x",
          lodMode: "manual",
          selectedLod: "1.2",
          stream: { kind: "url", url: "https://x/a.fcb" },
        },
      ],
    };
    expect(migrateSnapshot(v2in as never).layers[0]!.stream).toEqual({
      kind: "url",
      url: "https://x/a.fcb",
    });
  });

  it("marks a local streaming layer unavailable on restore", () => {
    const v2in = {
      version: 2,
      layers: [
        {
          id: "a",
          name: "x",
          lodMode: "auto",
          stream: { kind: "file", fileName: "a.fcb" },
        },
      ],
    };
    expect(migrateSnapshot(v2in as never).layers[0]!.unavailable).toBe(true);
  });

  // --- Beyond the brief's 3 cases -----------------------------------------

  it("preserves an already-manual lodMode on a v2 snapshot rather than overwriting it", () => {
    const v2in = {
      version: 2,
      layers: [{ id: "a", name: "x", lodMode: "manual" }],
    };
    expect(migrateSnapshot(v2in as never).layers[0]!.lodMode).toBe("manual");
  });

  it("does not mark a url-backed streaming layer unavailable", () => {
    const v2in = {
      version: 2,
      layers: [
        {
          id: "a",
          name: "x",
          stream: { kind: "url", url: "https://x/a.fcb" },
        },
      ],
    };
    expect(
      migrateSnapshot(v2in as never).layers[0]!.unavailable,
    ).toBeUndefined();
  });

  it("does not mark a non-streaming layer (no `stream` field) unavailable", () => {
    const v1 = { version: 1, layers: [{ id: "a", name: "x" }] };
    expect(migrateSnapshot(v1 as never).layers[0]!.unavailable).toBeUndefined();
  });

  it("handles a document with no `layers` array at all, returning an empty array rather than throwing", () => {
    expect(() => migrateSnapshot({} as never)).not.toThrow();
    expect(migrateSnapshot({} as never).layers).toEqual([]);
  });

  it("preserves unrelated fields on each layer (name, modelRef, id) unchanged", () => {
    const v1 = {
      version: 1,
      layers: [
        {
          id: "a",
          name: "x",
          modelRef: { type: "url", url: "https://x/a.city.json" },
          rules: [],
          rulesEnabled: true,
          visible: false,
        },
      ],
    };
    const migrated = migrateSnapshot(v1 as never).layers[0]!;
    expect(migrated.name).toBe("x");
    expect(migrated.modelRef).toEqual({
      type: "url",
      url: "https://x/a.city.json",
    });
    expect(migrated.visible).toBe(false);
  });
});
