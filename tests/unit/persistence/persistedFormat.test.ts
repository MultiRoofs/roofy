/**
 * The format a layer was opened as travels with its saved reference, so a
 * restore (and a share link, and a re-link) opens it the same way instead of
 * guessing again from the name.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeLayers,
  normalizeModelRef,
} from "../../../src/persistence/types";
import {
  encodeShareState,
  readShareHash,
  type ShareableViewState,
} from "../../../src/persistence/urlShare";

const cam = { lng: 4, lat: 52, height: 100, heading: 0, pitch: -45, roll: 0 };

describe("normalizeModelRef", () => {
  it("keeps a known format", () => {
    expect(
      normalizeModelRef({
        type: "url",
        url: "https://x/tile.json",
        encoding: "cityjsonseq",
      }),
    ).toEqual({
      type: "url",
      url: "https://x/tile.json",
      encoding: "cityjsonseq",
    });
    expect(
      normalizeModelRef({
        type: "file",
        fileName: "a.json",
        encoding: "flatcitybuf",
      }),
    ).toEqual({ type: "file", fileName: "a.json", encoding: "flatcitybuf" });
  });

  it("drops a format this build does not know, keeping the reference", () => {
    expect(
      normalizeModelRef({ type: "url", url: "https://x/a", encoding: "gltf" }),
    ).toEqual({ type: "url", url: "https://x/a" });
  });

  it("refuses what is not a reference", () => {
    expect(normalizeModelRef(null)).toBeNull();
    expect(normalizeModelRef({ type: "url" })).toBeNull();
    expect(normalizeModelRef({ type: "ftp", url: "x" })).toBeNull();
  });
});

describe("a saved layer's format", () => {
  it("survives normalisation", () => {
    const [layer] = normalizeLayers({
      layers: [
        {
          name: "seq served as json",
          modelRef: {
            type: "url",
            url: "https://x/tile.json",
            encoding: "cityjsonseq",
          },
          rules: [],
          rulesEnabled: false,
          visible: true,
        },
      ],
    });
    expect(layer!.modelRef).toEqual({
      type: "url",
      url: "https://x/tile.json",
      encoding: "cityjsonseq",
    });
  });

  it("rides a share link", () => {
    const state: ShareableViewState = {
      v: 3,
      cam,
      dt: "2026-06-21T12:00:00.000Z",
      pm: "object",
      layers: [
        {
          name: "seq served as json",
          modelUrl: "https://x/tile.json",
          encoding: "cityjsonseq",
          rules: [],
          rulesEnabled: false,
          visible: true,
        },
      ],
    };
    const result = readShareHash(`#${encodeShareState(state)}`);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.layers[0]!.encoding).toBe("cityjsonseq");
  });

  it("is dropped from a share link when it names no known format", () => {
    const state = {
      v: 3,
      cam,
      dt: "2026-06-21T12:00:00.000Z",
      pm: "object",
      layers: [
        {
          name: "a",
          modelUrl: "https://x/a",
          encoding: "gltf",
          rules: [],
          rulesEnabled: false,
          visible: true,
        },
      ],
    } as unknown as ShareableViewState;
    const result = readShareHash(`#${encodeShareState(state)}`);
    if (result.kind !== "ok") throw new Error("link did not decode");
    expect(result.state.layers[0]!.encoding).toBeUndefined();
  });
});
