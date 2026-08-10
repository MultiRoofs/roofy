import proj4 from "proj4";
import { describe, expect, it, vi } from "vitest";
import {
  createThrottle,
  crsFromGeodetic,
  epsgForLayer,
} from "../../../src/scene/cursorCrsReadout";

describe("epsgForLayer", () => {
  it("parses an OGC CRS URI", () => {
    expect(epsgForLayer("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(
      7415,
    );
  });

  it("returns null when the CRS has no proj4 definition", () => {
    expect(epsgForLayer(undefined)).toBeNull();
    expect(
      epsgForLayer("https://www.opengis.net/def/crs/EPSG/0/99999"),
    ).toBeNull();
  });
});

describe("crsFromGeodetic", () => {
  it("inverts WGS84 back into RD New metres", () => {
    // Delft, roughly: RD New eastings run 0..300000 m and northings
    // 300000..620000 m, so a result in that band proves the conversion went
    // WGS84 -> projected metres and not the other way round. Expected metres
    // are PROJ ground truth (cs2cs EPSG:4326 → EPSG:28992); the values pinned
    // before came through a towgs84 def with half-negated rotation signs and
    // sat ~76 m off.
    const out = crsFromGeodetic(4.348, 52.006, 14, 7415)!;
    expect(out[0]).toBeCloseTo(83647.09, 1);
    expect(out[1]).toBeCloseTo(446913.56, 1);
    // Height is carried through untouched — proj4 only moves the horizontal
    // pair (see HEIGHT SEMANTICS in the module doc).
    expect(out[2]).toBe(14);
  });

  it("round-trips through proj4's inverse", () => {
    // Calling the module first is what registers EPSG:7415 with proj4, so the
    // reference transform below is available precisely because it worked.
    const out = crsFromGeodetic(4.348, 52.006, 14, 7415)!;
    const [lng, lat] = proj4("EPSG:7415", "WGS84", [out[0], out[1]]) as [
      number,
      number,
    ];
    expect(lng).toBeCloseTo(4.348, 6);
    expect(lat).toBeCloseTo(52.006, 6);
  });

  it("returns null for an unusable epsg", () => {
    expect(crsFromGeodetic(4.348, 52.006, 0, 99999)).toBeNull();
  });

  it("returns null rather than a NaN readout for a non-finite input", () => {
    expect(crsFromGeodetic(Number.NaN, 52.006, 14, 7415)).toBeNull();
    expect(crsFromGeodetic(4.348, 52.006, Number.NaN, 7415)).toBeNull();
  });
});

describe("createThrottle", () => {
  it("runs immediately then suppresses until the interval elapses", () => {
    let t = 1000;
    const throttle = createThrottle(66, () => t);
    const fn = vi.fn();
    throttle(fn);
    throttle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    t += 70;
    throttle(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("fires on the very first call however late the clock starts", () => {
    // The old inline gate seeded its cursor `useRef(0)` with 0 and compared
    // against `performance.now()`, so the first move always passed. A fresh
    // throttle must behave the same even when `now()` is small.
    const throttle = createThrottle(66, () => 0);
    const fn = vi.fn();
    throttle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps separate gates per throttle instance", () => {
    const t = 0;
    const a = createThrottle(66, () => t);
    const b = createThrottle(66, () => t);
    const fnA = vi.fn();
    const fnB = vi.fn();
    a(fnA);
    b(fnB);
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});
