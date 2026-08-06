/**
 * Global terrain relief: the piece of Navara's own "photoreal base scene"
 * recipe this app was missing.
 *
 * The vendor template (`reearth/navara-template`) and the `navara-usage` skill
 * that ships with it both compose the base scene as `DefaultPlugin` +
 * `addDefaultPhotorealScene()` + **Re:Earth quantized-mesh terrain** + satellite
 * imagery + attribution. We had every piece but the terrain, so the raster
 * basemap was draped over a smooth ellipsoid and all relief in the scene came
 * from Google's 3D Tiles, wherever they happen to have coverage.
 *
 * `requestVertexNormals` is the load-bearing option, and not only for shading
 * the hills: the skill notes that the globe has no normals of its own unless a
 * terrain or hillshade layer supplies them (the `useNormal` view option that
 * would otherwise provide them does not exist in 0.0.5 — its `Options` type has
 * no such field). That is exactly the resource the aerial-perspective pass
 * wants in `irradiance` mode; see Known Issue (e) in CLAUDE.md.
 *
 * Engine-free on purpose, exactly like `basemaps.ts` and `googleTiles.ts`: pure
 * data, unit-testable under Node where `@navaramap/three` cannot even be
 * imported (NODE_IMPORT_SAFE = false). `NavaraViewport` is the only caller.
 */

/**
 * Re:Earth's global quantized-mesh terrain — keyless, and the source the
 * vendor's own recipe names.
 *
 * The SAME service this app already reads the EGM2008 geoid from
 * (`GEOID_TILEJSON_URL` in `@cityjson/navara-core`), which is why the credits
 * below deliberately do not repeat what `GEOID_ATTRIBUTION` already states.
 */
export const TERRAIN_URL =
  "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain";

export interface TerrainConfig {
  readonly source: {
    readonly type: "quantized-mesh";
    readonly url: string;
    readonly maxZoom: number;
    /**
     * Vertex normals from the tile itself. Without them the terrain is
     * shaded flat AND the globe contributes no normals to the g-buffer at
     * all — see the module note above.
     */
    readonly requestVertexNormals: boolean;
    /** Marks water surfaces so they can be shaded as water rather than land. */
    readonly requestWaterMask: boolean;
  };
  readonly layer: {
    readonly type: "terrain";
    readonly terrain: {
      readonly castShadow: boolean;
      readonly receiveShadow: boolean;
    };
  };
}

/**
 * The source+layer pair for global terrain.
 *
 * A plain constant rather than a function: unlike the Google tileset there is
 * no key to check and no reason it could be unavailable at config time. It is
 * still a value, not a call into the engine, so the module stays Node-safe.
 */
export const TERRAIN: TerrainConfig = {
  source: {
    type: "quantized-mesh",
    url: TERRAIN_URL,
    maxZoom: 18,
    requestVertexNormals: true,
    requestWaterMask: true,
  },
  layer: {
    type: "terrain",
    terrain: {
      // Terrain CASTS as well as receives, unlike the Google tileset: a hill
      // between the sun and a roof should shade it, and unlike the tiles this
      // geometry carries no baked lighting of its own.
      castShadow: true,
      receiveShadow: true,
    },
  },
};

/**
 * The credit for the terrain service, and only what is not already on screen.
 *
 * `GEOID_ATTRIBUTION` (rendered unconditionally, because every georeferenced
 * layer samples the geoid) already carries "© Mapterhorn, CC BY 4.0",
 * "© OpenStreetMap contributors, ODbL" and "Re:Earth Terrain, EGM2008 (NGA)".
 * The elevation data is the same provider, so repeating those three lines
 * would credit nobody new and only crowd the overlay. This names the terrain
 * itself, which the geoid lines do not.
 */
export const TERRAIN_ATTRIBUTION: readonly string[] = [
  "Terrain: © Re:Earth Terrain",
];
