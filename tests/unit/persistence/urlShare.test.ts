/**
 * Unit tests for URL share state codec.
 */

import { describe, it, expect } from "vitest";
import {
  encodeShareState,
  decodeShareState,
} from "../../../src/persistence/urlShare";
import type { ShareableViewState } from "../../../src/persistence/urlShare";

function makeState(
  overrides: Partial<ShareableViewState> = {},
): ShareableViewState {
  return {
    layers: [],
    modelUrl: "https://example.com/model.city.json",
    cp: [50, 50, 50],
    ct: [0, 0, 0],
    dt: "2025-06-21T12:00:00.000Z",
    rules: [],
    re: true,
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
    expect(decoded!.modelUrl).toBe(state.modelUrl);
    expect(decoded!.cp).toEqual([50, 50, 50]);
    expect(decoded!.ct).toEqual([0, 0, 0]);
    expect(decoded!.dt).toBe("2025-06-21T12:00:00.000Z");
    expect(decoded!.re).toBe(true);
    expect(decoded!.pm).toBe("object");
  });

  it("round-trips state with rules", () => {
    const state = makeState({
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
    });
    const decoded = decodeShareState(encodeShareState(state));

    expect(decoded).not.toBeNull();
    expect(decoded!.rules).toHaveLength(1);
    expect(decoded!.rules![0]!.name).toBe("South");
  });

  it("round-trips state with null modelUrl", () => {
    const state = makeState({ modelUrl: null });
    const decoded = decodeShareState(encodeShareState(state));

    expect(decoded).not.toBeNull();
    expect(decoded!.modelUrl).toBeNull();
  });

  it("decodes with leading # hash", () => {
    const state = makeState();
    const encoded = "#" + encodeShareState(state);
    const decoded = decodeShareState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.modelUrl).toBe(state.modelUrl);
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
    const bad = "share=" + btoa(JSON.stringify({ cp: "not an array" }));
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
