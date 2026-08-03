/**
 * Unit tests for URL share state codec.
 *
 * The share hash carries the same geographic camera as snapshot v3 (`cam`);
 * a link minted before v3 carried two scene-space tuples (`cp`/`ct`) and no
 * longer decodes at all — see the "rejects a pre-v3 share link" case.
 */

import { describe, it, expect } from "vitest";
import {
  encodeShareState,
  decodeShareState,
} from "../../../src/persistence/urlShare";
import type { ShareableViewState } from "../../../src/persistence/urlShare";

const CAM = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
} as const;

function makeState(
  overrides: Partial<ShareableViewState> = {},
): ShareableViewState {
  return {
    layers: [
      {
        name: "delft",
        modelUrl: "https://example.com/model.city.json",
        rules: [],
        rulesEnabled: true,
        visible: true,
      },
    ],
    cam: CAM,
    dt: "2025-06-21T12:00:00.000Z",
    pm: "object",
    ...overrides,
  };
}

describe("encodeShareState / decodeShareState", () => {
  it("round-trips a complete state", () => {
    const state = makeState();
    const encoded = encodeShareState(state);
    const decoded = decodeShareState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.layers[0]!.modelUrl).toBe(
      "https://example.com/model.city.json",
    );
    expect(decoded!.cam).toEqual(CAM);
    expect(decoded!.dt).toBe("2025-06-21T12:00:00.000Z");
    expect(decoded!.pm).toBe("object");
  });

  it("round-trips state with rules", () => {
    const state = makeState({
      layers: [
        {
          name: "delft",
          modelUrl: "https://example.com/model.city.json",
          rules: [
            {
              id: "r1",
              name: "South",
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
    const decoded = decodeShareState(encodeShareState(state));

    expect(decoded).not.toBeNull();
    expect(decoded!.layers[0]!.rules).toHaveLength(1);
    expect(decoded!.layers[0]!.rules[0]!.name).toBe("South");
  });

  it("round-trips a camera-only state with no layers", () => {
    const decoded = decodeShareState(
      encodeShareState(makeState({ layers: [] })),
    );

    expect(decoded).not.toBeNull();
    expect(decoded!.layers).toEqual([]);
    expect(decoded!.cam).toEqual(CAM);
  });

  it("decodes with leading # hash", () => {
    const encoded = "#" + encodeShareState(makeState());
    const decoded = decodeShareState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.cam).toEqual(CAM);
  });

  it("returns null for empty string", () => {
    expect(decodeShareState("")).toBeNull();
  });

  it("returns null for random hash", () => {
    expect(decodeShareState("#foo=bar")).toBeNull();
  });

  it("returns null for corrupted base64", () => {
    expect(decodeShareState("share=!!!invalid!!!")).toBeNull();
  });

  it("returns null for valid JSON but missing required fields", () => {
    const bad = "share=" + btoa(JSON.stringify({ cam: "not an object" }));
    expect(decodeShareState(bad)).toBeNull();
  });

  it("rejects a pre-v3 share link carrying the old cp/ct tuples", () => {
    const legacy =
      "share=" +
      btoa(
        JSON.stringify({
          layers: [],
          cp: [50, 50, 50],
          ct: [0, 0, 0],
          dt: "2025-06-21T12:00:00.000Z",
          pm: "object",
        }),
      );
    expect(decodeShareState(legacy)).toBeNull();
  });

  it("rejects a camera with a non-finite component rather than wedging setCamera", () => {
    const bad =
      "share=" +
      btoa(
        JSON.stringify({
          layers: [],
          cam: { ...CAM, lat: null },
          dt: "2025-06-21T12:00:00.000Z",
          pm: "object",
        }),
      );
    expect(decodeShareState(bad)).toBeNull();
  });

  it("encoded string starts with share=", () => {
    const encoded = encodeShareState(makeState());
    expect(encoded).toMatch(/^share=/);
  });

  it("encoded string uses base64url characters (no +, /, =)", () => {
    const encoded = encodeShareState(makeState());
    const payload = encoded.slice("share=".length);
    expect(payload).not.toMatch(/[+/=]/);
  });
});
