/**
 * The camera-derived fetch bbox of a streaming layer, as a ground-plane
 * outline.
 *
 * A `.fcb` layer does not load a file, it asks a spatial index for whatever
 * falls inside a rectangle derived from the four viewport corner rays
 * (`viewportFootprint` in `@cityjson/navara-flatcitybuf`). That rectangle is
 * the single most useful thing to see when the streamer is fetching too much,
 * too little, or the wrong place — and it is invisible by construction. This
 * module draws it.
 *
 * The region is NOT recomputed here. `FcbStreamLayerHandle.onQueryRegion`
 * publishes the very footprint its `probe`/`fetch` messages carried, so the
 * outline is the query by construction rather than by agreement (see
 * `queryRegion.ts` in the plugin).
 *
 * ENGINE-FREE, deliberately, even though this is `src/scene/`: the mesh
 * descriptor is plain data and the view arrives as the structural
 * {@link QueryBoxView}, so every decision below — which descriptor, which
 * points, how the numbers read — is unit-testable in jsdom without booting
 * Navara. `NavaraViewport` supplies the real `view`.
 */
import type { QueryRegion } from "@cityjson/navara-flatcitybuf";

/** The half of `MeshHandle` this module uses. */
export interface QueryBoxMesh {
  delete(): void;
}

/** The half of `ThreeView` this module uses. */
export interface QueryBoxView {
  addMesh(config: Record<string, unknown>): QueryBoxMesh;
}

/**
 * Outline colour, as the `0xRRGGBB` integer Navara's line material takes.
 *
 * The blue of the reference implementation's `fetch-bbox` layer, and chosen
 * against this scene rather than copied blindly: it is a hue the rule palettes
 * do not use for roof surfaces, and it stays legible over both the Esri
 * imagery and the default photoreal globe.
 */
export const QUERY_BOX_COLOR = 0x2f7fff;

/**
 * How far above the layer's ground plane the outline is drawn, in metres.
 *
 * Not decoration: the plane the footprint was taken on is exactly the plane
 * the basemap/terrain is drawn at, so an outline placed on it z-fights with
 * the ground for its entire length. Two metres is below anything a viewer
 * would mistake for a real height and far above the depth-buffer resolution at
 * these camera distances.
 */
export const QUERY_BOX_LIFT_M = 2;

/**
 * Navara's `smoothLines` descriptor, configured to render a POLYGON rather
 * than a spline.
 *
 * `smoothLines` over `arcLines` — the two line descriptors `DefaultPlugin`
 * registers — for two reasons: `ArcLine` lifts every segment into a geodesic
 * ARC above the ground (that is its whole purpose) and documents itself as
 * unreliable below ~2 km, which is most of the fetch boxes this draws; and it
 * takes `LatLng` pairs with no height, so it could not sit on the layer's
 * ground plane at all.
 *
 * `tension: 0` is what makes a *smooth* line straight. Navara builds a
 * `CatmullRomCurve3(points, closed, "catmullrom", tension)`, and at tension 0
 * both Hermite tangents are zero, so each span is a cubic from corner to
 * corner with zero end derivatives — every sample lies exactly on the straight
 * segment between two ring vertices. At the default 0.5 the rectangle would
 * bulge outward at each corner.
 */
export function queryBoxMeshConfig(
  region: QueryRegion,
): Record<string, unknown> {
  return {
    smoothLines: {
      points: region.ring.map(([lng, lat]) => ({
        lng,
        lat,
        // DEGREES go in — the same units `flyTo` and
        // `camera.positionGeographic` use. On 0.0.5 the engine converted them
        // with `degreeToRadian` inside `SmoothLine.updatePointsData`; since
        // 0.1.0 every geodetic entry point takes degrees outright.
        height: region.heightM + QUERY_BOX_LIFT_M,
      })),
      closed: true,
      tension: 0,
      // Sampling density along the curve. The ring already carries the
      // rectangle's shape (its edges are densified before projection), so this
      // only decides how closely the polyline hugs the corners; 4 puts the
      // nearest sample within 1/4 of an edge-eighth of every corner.
      segments: 4,
      lineWidth: 2,
      color: QUERY_BOX_COLOR,
      // The outline, and nothing else: the descriptor draws a sphere at every
      // control point by default, which on a 32-vertex ring is 32 beads
      // strung along the box.
      showPoints: false,
    },
  };
}

/**
 * Add one layer's outline to the view, or `null` if the engine refused.
 *
 * Same failure policy as every other engine push in the viewport: a diagnostic
 * overlay that a backend cannot draw must leave the viewer running.
 */
export function addQueryBox(
  view: QueryBoxView,
  region: QueryRegion,
): QueryBoxMesh | null {
  try {
    return view.addMesh(queryBoxMeshConfig(region));
  } catch (error) {
    console.error(
      `NavaraViewport: the streaming query box for layer "${region.layerId}" could not be drawn.`,
      error,
    );
    return null;
  }
}

/** One bbox side, as the readout shows it. Metres, because the CRS gate admits
 *  metric CRSs only — so no unit is guessed. */
function axis(min: number, max: number): string {
  return `${min.toFixed(1)} → ${max.toFixed(1)}`;
}

/** A whole-metre extent, for the "how big is this?" line. */
function metres(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} m`;
}

/** The bbox numbers as the overlay prints them: the CRS, the two spans, and
 *  each axis' min → max. Pure, so the formatting is pinned by a test rather
 *  than by reading a screenshot. */
export interface QueryBoxReadout {
  readonly layerId: string;
  readonly crs: string;
  readonly x: string;
  readonly y: string;
  readonly size: string;
}

export function queryBoxReadout(region: QueryRegion): QueryBoxReadout {
  const [minX, minY, maxX, maxY] = region.bbox;
  return {
    layerId: region.layerId,
    // "unknown" rather than a blank: a bbox with no CRS is a number pair that
    // means nothing, and saying so is the point of a diagnostic.
    crs: region.epsg === null ? "CRS unknown" : `EPSG:${region.epsg}`,
    x: axis(minX, maxX),
    y: axis(minY, maxY),
    size: `${metres(maxX - minX)} × ${metres(maxY - minY)}`,
  };
}
