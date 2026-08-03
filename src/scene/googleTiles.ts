/**
 * Google Photorealistic 3D Tiles as a native Navara `3d-tiles` source+layer,
 * replacing `GoogleTilesLayer.tsx` (3d-tiles-renderer/r3f) and
 * `TileCreasedNormalsPlugin.ts` — Navara's `ModelMaterial` exposes
 * `creaseNormalAngle` directly, and its own lighting removes the need for the
 * `MeshBasicMaterial` swap the old component performed. (Both old files are
 * deleted with the rest of the R3F stack in Task C21.)
 *
 * Engine-free on purpose: this module is pure data, so it is unit-tested under
 * Node while `@navaramap/three` cannot even be imported there (Task B1 →
 * NODE_IMPORT_SAFE = false). `NavaraViewport` is the only caller, and the only
 * place the result meets the engine.
 */
export const GOOGLE_TILES_ROOT =
  "https://tile.googleapis.com/v1/3dtiles/root.json";

/** 30°, the angle `TileCreasedNormalsPlugin` was configured with. */
export const TILE_CREASE_ANGLE = Math.PI / 6;

export interface GoogleTilesConfig {
  readonly source: { readonly type: "3d-tiles"; readonly url: string };
  readonly layer: {
    readonly type: "3d-tiles";
    readonly model: {
      /**
       * Recompute vertex normals on load. Load-bearing, not cosmetic: the
       * engine documents `creaseNormalAngle` as "used when `normals` is true",
       * so without this the crease angle below would be inert and the ported
       * plugin would be a no-op.
       */
      readonly normals: boolean;
      readonly creaseNormalAngle: number;
      readonly castShadow: boolean;
      readonly receiveShadow: boolean;
      readonly maxSse: number;
    };
  };
}

/**
 * The source+layer pair for Google's photorealistic tileset, or `null` when no
 * API key is configured — the viewer then runs tile-free over Navara's default
 * photoreal scene rather than pointing the engine at a URL that 401s on every
 * tile request.
 */
export function googleTilesConfig(
  apiKey: string | undefined,
): GoogleTilesConfig | null {
  if (!apiKey) return null;
  return {
    source: {
      type: "3d-tiles",
      // Google authenticates with a query parameter, not a header: the engine
      // fetches tile URLs itself, and the root document's `key` is what it
      // propagates (there is no request-interceptor seam to add a header in).
      url: `${GOOGLE_TILES_ROOT}?key=${encodeURIComponent(apiKey)}`,
    },
    layer: {
      type: "3d-tiles",
      model: {
        normals: true,
        creaseNormalAngle: TILE_CREASE_ANGLE,
        // The tiles ship baked lighting and cover the whole globe: letting
        // them cast would shadow the city model from geometry that is already
        // shaded, and cost a shadow-map pass over every loaded tile.
        castShadow: false,
        receiveShadow: true,
        maxSse: 8,
      },
    },
  };
}
