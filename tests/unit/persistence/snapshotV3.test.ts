/**
 * `normalizeLayers` — what used to be `migrateSnapshot`.
 *
 * The cross-VERSION migration lives in `migrateSnapshot` (v3 -> v4; see
 * snapshotV4.test.ts) and is not what this file is about. What is here is the
 * per-layer normalisation that is right for a document of ANY accepted
 * version: default `lodMode` to "auto" when the field is absent, and flag a
 * file-backed streaming layer `unavailable` because its bytes cannot survive
 * a reload.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeLayers,
  normalizeViewMode,
} from "../../../src/persistence/types";

describe("normalizeLayers", () => {
  it("defaults a missing lodMode to auto", () => {
    const layers = normalizeLayers({
      layers: [{ id: "a", name: "x", selectedLod: "2.2" }],
    } as never);
    expect(layers[0]!.lodMode).toBe("auto");
    expect(layers[0]!.selectedLod).toBe("2.2");
  });

  it("preserves an explicit manual lodMode rather than overwriting it", () => {
    const layers = normalizeLayers({
      layers: [{ id: "a", name: "x", lodMode: "manual" }],
    } as never);
    expect(layers[0]!.lodMode).toBe("manual");
  });

  it("defaults an absent hiddenTypes to nothing hidden", () => {
    const layers = normalizeLayers({
      layers: [{ id: "a", name: "x" }],
    } as never);
    expect(layers[0]!.hiddenTypes).toEqual([]);
  });

  it("preserves saved hiddenTypes", () => {
    const layers = normalizeLayers({
      layers: [{ id: "a", name: "x", hiddenTypes: ["Building"] }],
    } as never);
    expect(layers[0]!.hiddenTypes).toEqual(["Building"]);
  });

  it("marks a local (file-backed) streaming layer unavailable", () => {
    const layers = normalizeLayers({
      layers: [
        {
          id: "a",
          name: "x",
          lodMode: "auto",
          stream: { kind: "file", fileName: "a.fcb" },
        },
      ],
    } as never);
    expect(layers[0]!.unavailable).toBe(true);
  });

  it("leaves a url-backed streaming layer available, stream metadata intact", () => {
    const layers = normalizeLayers({
      layers: [
        {
          id: "a",
          name: "x",
          lodMode: "manual",
          selectedLod: "1.2",
          stream: { kind: "url", url: "https://x/a.fcb" },
        },
      ],
    } as never);
    expect(layers[0]!.stream).toEqual({
      kind: "url",
      url: "https://x/a.fcb",
    });
    expect(layers[0]!.unavailable).toBeUndefined();
  });

  it("does not mark a non-streaming layer (no `stream` field) unavailable", () => {
    const layers = normalizeLayers({
      layers: [{ id: "a", name: "x" }],
    } as never);
    expect(layers[0]!.unavailable).toBeUndefined();
  });

  it("handles a document with no `layers` array at all, returning an empty array rather than throwing", () => {
    expect(() => normalizeLayers({} as never)).not.toThrow();
    expect(normalizeLayers({} as never)).toEqual([]);
  });

  it("preserves unrelated fields on each layer (name, modelRef, visible) unchanged", () => {
    const normalized = normalizeLayers({
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
    } as never)[0]!;
    expect(normalized.name).toBe("x");
    expect(normalized.modelRef).toEqual({
      type: "url",
      url: "https://x/a.city.json",
    });
    expect(normalized.visible).toBe(false);
  });
});

/**
 * The view mode rides along in the same optional-field-with-a-default shape as
 * `hiddenTypes`: a snapshot written before modes existed restores into 3D,
 * which is the behaviour that snapshot was saved under.
 */
describe("normalizeViewMode", () => {
  it("defaults an absent view mode to 3D", () => {
    expect(normalizeViewMode(undefined)).toBe("3d");
  });

  it("keeps a saved mode", () => {
    expect(normalizeViewMode("2d")).toBe("2d");
    expect(normalizeViewMode("2.5d")).toBe("2.5d");
    expect(normalizeViewMode("3d")).toBe("3d");
  });

  it("refuses a value that is not a mode, rather than wedging the camera", () => {
    expect(normalizeViewMode("isometric" as never)).toBe("3d");
    expect(normalizeViewMode(null as never)).toBe("3d");
  });
});
