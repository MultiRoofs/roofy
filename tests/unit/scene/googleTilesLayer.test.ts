import { describe, expect, it } from "vitest";
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TileCompressionPlugin, TilesFadePlugin, UpdateOnChangePlugin } from "3d-tiles-renderer/plugins";
import {
  getGoogleTilesPluginSpecs,
  TILE_CREASE_ANGLE,
} from "../../../src/scene/GoogleTilesLayer";
import { TileCreasedNormalsPlugin } from "../../../src/scene/TileCreasedNormalsPlugin";

describe("getGoogleTilesPluginSpecs", () => {
  it("matches the Takram-style plugin chain for Google tiles", () => {
    const specs = getGoogleTilesPluginSpecs("demo-key");

    expect(specs.map((spec) => spec.plugin)).toEqual([
      GoogleCloudAuthPlugin,
      GLTFExtensionsPlugin,
      TileCompressionPlugin,
      UpdateOnChangePlugin,
      TilesFadePlugin,
      TileCreasedNormalsPlugin,
    ]);

    expect(specs[0]?.args).toEqual({ apiToken: "demo-key" });
    expect(specs[5]?.args).toEqual({ creaseAngle: TILE_CREASE_ANGLE });
  });
});
