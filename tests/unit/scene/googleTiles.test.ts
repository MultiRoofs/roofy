import { describe, it, expect } from "vitest";
import {
  GOOGLE_TILES_ROOT,
  TILE_CREASE_ANGLE,
  googleTilesConfig,
} from "../../../src/scene/googleTiles";

describe("googleTilesConfig", () => {
  it("returns null without an API key, so the viewer runs tile-free rather than 401-looping", () => {
    expect(googleTilesConfig(undefined)).toBeNull();
    expect(googleTilesConfig("")).toBeNull();
  });

  it("puts the key in the root URL's query string, not a header", () => {
    const cfg = googleTilesConfig("KEY123")!;
    expect(cfg.source.url).toBe(`${GOOGLE_TILES_ROOT}?key=KEY123`);
    expect(cfg.source.type).toBe("3d-tiles");
  });

  it("URL-encodes a key containing reserved characters", () => {
    expect(googleTilesConfig("a b&c")!.source.url).toBe(
      `${GOOGLE_TILES_ROOT}?key=a%20b%26c`,
    );
  });

  it("carries the crease angle previously applied by TileCreasedNormalsPlugin", () => {
    expect(googleTilesConfig("K")!.layer.model.creaseNormalAngle).toBe(
      TILE_CREASE_ANGLE,
    );
    expect(TILE_CREASE_ANGLE).toBeCloseTo(Math.PI / 6, 12);
  });

  it("receives shadows but does not cast them, matching the old baked-lighting tiles", () => {
    const model = googleTilesConfig("K")!.layer.model;
    expect(model.receiveShadow).toBe(true);
    expect(model.castShadow).toBe(false);
  });

  // `creaseNormalAngle` is documented by the engine as "used when `normals` is
  // true" — without this the crease angle above would be inert, i.e. the old
  // TileCreasedNormalsPlugin would have been dropped rather than ported.
  it("asks the engine to recompute normals, which is what makes the crease angle mean anything", () => {
    expect(googleTilesConfig("K")!.layer.model.normals).toBe(true);
  });

  it("is a 3d-tiles layer, so the engine picks its tileset renderer", () => {
    expect(googleTilesConfig("K")!.layer.type).toBe("3d-tiles");
  });
});
