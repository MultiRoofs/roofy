/**
 * Terrain is data, not behaviour, so these pin the two things that would
 * silently break it: the options the engine actually reads, and the credit
 * rules the overlay depends on.
 */
import { describe, expect, it } from "vitest";
import {
  TERRAIN,
  TERRAIN_ATTRIBUTION,
  TERRAIN_URL,
} from "../../../src/scene/terrain";
import { GEOID_ATTRIBUTION } from "@cityjson/navara-core";

describe("TERRAIN", () => {
  it("is a quantized-mesh source at the Re:Earth endpoint the vendor recipe names", () => {
    expect(TERRAIN.source.type).toBe("quantized-mesh");
    expect(TERRAIN.source.url).toBe(TERRAIN_URL);
    expect(TERRAIN_URL).toContain("{z}/{x}/{y}");
  });

  it("requests vertex normals, which the globe has none of without them", () => {
    // Load-bearing twice over: terrain shading, and the normals the
    // aerial-perspective pass reads in irradiance mode (docs/architecture-notes.md issue (e)).
    expect(TERRAIN.source.requestVertexNormals).toBe(true);
  });

  it("requests the water mask, so water is not shaded as land", () => {
    expect(TERRAIN.source.requestWaterMask).toBe(true);
  });

  it("both casts and receives shadows, unlike the baked-lighting 3D tiles", () => {
    expect(TERRAIN.layer.type).toBe("terrain");
    expect(TERRAIN.layer.terrain.castShadow).toBe(true);
    expect(TERRAIN.layer.terrain.receiveShadow).toBe(true);
  });
});

describe("TERRAIN_ATTRIBUTION", () => {
  it("credits the terrain service", () => {
    expect(TERRAIN_ATTRIBUTION.length).toBeGreaterThan(0);
    expect(TERRAIN_ATTRIBUTION.join(" ")).toContain("Re:Earth Terrain");
  });

  it("repeats no line the unconditional geoid credit already shows", () => {
    // Same provider, so the overlap is easy to reintroduce by accident — and
    // a duplicated credit line is a worse overlay, not a safer one.
    for (const line of TERRAIN_ATTRIBUTION) {
      expect(GEOID_ATTRIBUTION).not.toContain(line);
    }
  });
});
