/**
 * The sun's cascaded-shadow-map tuning, by quality level.
 *
 * Engine-free (data only) so the store, the panel and the tests can import
 * it without `three`; `NavaraViewport` writes the selected row into
 * `SunLightDesc` together with `castShadow`, so the pieces can never drift
 * apart across the toggle.
 *
 * WHAT A LEVEL COSTS AND BUYS. The shadow map is one square depth texture
 * per cascade (four cascades), so `shadowMapSize` 4096 is 64 MB of GPU
 * memory per cascade against 16 MB at 2048 and 4 MB at 1024, plus the fill
 * cost of rendering every caster into it each frame. What it buys is a
 * smaller texel on the ground — a cascade spans its frustum slice plus
 * `shadowMargin` on either side, divided by the map size — and the texel is
 * what shadow ACNE is made of: on a surface the sun hits at a grazing angle
 * the true depth changes more within one texel than the depth bias covers,
 * so half of every texel is judged to lie behind its own stored depth and
 * the surface stripes itself along the texel grid (the "repeated waves" on
 * roofs and walls at a low sun). The cure is a bias at least a texel's
 * worth of depth slope, and the bias is worth the cascade's depth range
 * times its value in metres, so the rows below keep `shadowBias × map size`
 * CONSTANT: every level resists acne alike, and a higher level only shrinks
 * the bias's metre equivalent — a caster closer than that to its receiver
 * casts nothing on it (peter-panning), so finer maps attach shadows closer
 * to building bases and to roof furniture. Browser-swept at the Delft
 * sample with the sun at ~12° (2026-09-06 17:00 UTC): 2048 at −0.0005 —
 * the tuning before this table — stripes every sunlit roof; each row below
 * renders clean, and the differences between them are in how far a shadow
 * stands off its caster.
 *
 * A DEPTH bias, not a normal bias, and that is a finding: `shadowNormalBias`
 * (metres along the VERTEX normal that the lookup is moved off the surface)
 * cleared the big roofs and turned every mis-wound one — a face whose
 * normal points into its own building, which real CityJSON is full of (see
 * `createCityMaterial` in the plugin) — solid dark, because it pushed the
 * lookup INSIDE the roof. The fragment shader flips a back face's normal
 * for lighting; the vertex-stage bias cannot. `shadowBias` is added to the
 * fragment's depth in the cascade's own clip space, so a NEGATIVE value
 * moves every fragment a little towards the sun regardless of its winding.
 * It is ONE number for all four cascades (`CascadedShadowMaps.bias` fans it
 * out unscaled); a per-cascade bias would need the engine to expose one.
 *
 * `shadowMargin` is the other lever on the cascade's depth range. The
 * engine's 5 km (room for a mountain outside the frustum to shadow the
 * valley in view) put the nearest cascade at 8.3 km of depth; 500 m — still
 * five times any building — brings it to 3.8 km (probed: cascade fars
 * 8328/11929/18865/83085 → 3828/7429/14365/78585), at the price of a caster
 * more than 500 m outside a cascade slice along the light casting nothing.
 * The far cascades stay coarse whatever the level: at the layer-fit view
 * (2.2 km up) buildings shadow the ground but not each other.
 */

export const SHADOW_QUALITIES = ["low", "medium", "high"] as const;

export type ShadowQuality = (typeof SHADOW_QUALITIES)[number];

/** Medium: the 2048 map the engine defaults to, which most GPUs carry
 *  without a frame-time cost worth a setting. */
export const DEFAULT_SHADOW_QUALITY: ShadowQuality = "medium";

export interface ShadowTuning {
  /** Square shadow-map edge, per cascade. */
  readonly shadowMapSize: number;
  /** Depth bias in the cascade's clip space; negative moves fragments
   *  towards the sun. */
  readonly shadowBias: number;
  readonly shadowNormalBias: 0;
  /** Metres either side of a cascade's frustum slice its shadow camera
   *  spans. */
  readonly shadowMargin: number;
}

/** `shadowBias × shadowMapSize`, the acne resistance every level shares:
 *  a 2048 map at −0.001, twice the bias the first tuning shipped with,
 *  which is what a ~12° sun needs on this data. */
const BIAS_TEXEL_PRODUCT = -0.001 * 2048;

const SHADOW_MARGIN_M = 500;

function row(shadowMapSize: number): ShadowTuning {
  return Object.freeze({
    shadowMapSize,
    shadowBias: BIAS_TEXEL_PRODUCT / shadowMapSize,
    shadowNormalBias: 0,
    shadowMargin: SHADOW_MARGIN_M,
  });
}

const TABLE: Readonly<Record<ShadowQuality, ShadowTuning>> = Object.freeze({
  low: row(1024),
  medium: row(2048),
  high: row(4096),
});

/** The tuning row `NavaraViewport` writes for a level. Frozen and stable
 *  across calls, so it is safe to spread into a config or compare by
 *  identity. */
export function shadowTuningFor(quality: ShadowQuality): ShadowTuning {
  return TABLE[quality];
}
