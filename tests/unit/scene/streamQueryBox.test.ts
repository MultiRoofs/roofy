/**
 * The streaming fetch-box outline: which descriptor, which points, and how the
 * numbers read.
 *
 * Engine-free — `streamQueryBox.ts` takes the view as a structural seam, so
 * none of this needs Navara (which cannot be imported under Node at all:
 * NODE_IMPORT_SAFE = false).
 */
import { describe, expect, it, vi } from "vitest";
import type { QueryRegion } from "@cityjson/navara-flatcitybuf";
import {
  addQueryBox,
  QUERY_BOX_COLOR,
  QUERY_BOX_LIFT_M,
  queryBoxMeshConfig,
  queryBoxReadout,
} from "../../../src/scene/streamQueryBox";

const REGION: QueryRegion = {
  layerId: "delft.fcb",
  bbox: [84000, 445000, 86500, 446500],
  epsg: 7415,
  span: 2500,
  heightM: 43.2,
  ring: [
    [4.35, 52.0],
    [4.36, 52.0],
    [4.36, 52.01],
    [4.35, 52.01],
  ],
};

interface SmoothLinesConfig {
  readonly smoothLines: {
    readonly points: ReadonlyArray<{
      lng: number;
      lat: number;
      height: number;
    }>;
    readonly closed: boolean;
    readonly tension: number;
    readonly color: number;
    readonly showPoints: boolean;
    readonly lineWidth: number;
  };
}

describe("queryBoxMeshConfig", () => {
  it("uses the smoothLines descriptor DefaultPlugin registers", () => {
    // Not `arcLines`, the other registered line descriptor: ArcLine lifts every
    // span into an arc ABOVE the ground and documents itself as unreliable
    // below ~2 km, and it takes LatLng with no height at all.
    const config = queryBoxMeshConfig(REGION) as unknown as SmoothLinesConfig;
    expect(Object.keys(config)).toEqual(["smoothLines"]);
  });

  it("draws a closed polygon, not a spline", () => {
    const { smoothLines } = queryBoxMeshConfig(
      REGION,
    ) as unknown as SmoothLinesConfig;
    expect(smoothLines.closed).toBe(true);
    // Navara feeds these to a CatmullRomCurve3; at tension 0 both Hermite
    // tangents are zero, so every sample lies on the straight segment between
    // two ring vertices. At the default 0.5 the box bulges at the corners.
    expect(smoothLines.tension).toBe(0);
    // 32 control-point beads strung along a diagnostic outline is noise.
    expect(smoothLines.showPoints).toBe(false);
    expect(smoothLines.color).toBe(QUERY_BOX_COLOR);
    expect(smoothLines.lineWidth).toBeGreaterThan(0);
  });

  it("places every vertex on the layer's ground plane, lifted clear of it", () => {
    const { smoothLines } = queryBoxMeshConfig(
      REGION,
    ) as unknown as SmoothLinesConfig;
    expect(smoothLines.points).toHaveLength(REGION.ring.length);
    smoothLines.points.forEach((p, i) => {
      // DEGREES, straight through: `SmoothLine.updatePointsData` applies
      // `degreeToRadian` itself.
      expect(p.lng).toBe(REGION.ring[i]![0]);
      expect(p.lat).toBe(REGION.ring[i]![1]);
      // The plane the footprint was actually taken on — anything else outlines
      // somewhere the query was not — plus the z-fight lift.
      expect(p.height).toBe(REGION.heightM + QUERY_BOX_LIFT_M);
    });
  });
});

describe("addQueryBox", () => {
  it("hands the descriptor to the view and returns its handle", () => {
    const mesh = { delete: vi.fn() };
    const view = { addMesh: vi.fn(() => mesh) };
    expect(addQueryBox(view, REGION)).toBe(mesh);
    expect(view.addMesh).toHaveBeenCalledWith(queryBoxMeshConfig(REGION));
  });

  it("reports and answers null when the engine refuses, leaving the viewer running", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = {
      addMesh: vi.fn(() => {
        throw new Error("no line pass on this backend");
      }),
    };
    expect(addQueryBox(view, REGION)).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("queryBoxReadout", () => {
  it("prints the source-CRS bbox, its EPSG and its extent", () => {
    expect(queryBoxReadout(REGION)).toEqual({
      layerId: "delft.fcb",
      crs: "EPSG:7415",
      x: "84000.0 → 86500.0",
      y: "445000.0 → 446500.0",
      size: "2,500 m × 1,500 m",
    });
  });

  it("says so out loud when the CRS is unknown", () => {
    // A bbox with no CRS is a number pair that means nothing; a blank would
    // read as "same as above".
    expect(queryBoxReadout({ ...REGION, epsg: null }).crs).toBe("CRS unknown");
  });
});
