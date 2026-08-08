/**
 * The async CRS pre-flight: fixed-list codes pass silently, unknown codes are
 * fetched from epsg.io, and the units gate still refuses degree-based CRS —
 * all BEFORE a model reaches the layer store.
 *
 * proj4's definition registry is global and survives between tests, so every
 * case that registers a definition uses its own fake EPSG code.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import proj4 from "proj4";
import { ensureModelCrsLoadable } from "../../../../src/features/layers/ensureCrs";
import type { CityModel } from "../../../../src/domain/citymodel/types";

function model(referenceSystem?: string): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: referenceSystem === undefined ? {} : { referenceSystem },
    bbox: null,
    objects: {},
    vertexCount: 0,
  };
}

function fetchOk(body: string): typeof fetch {
  return vi.fn(async () => new Response(body, { status: 200 })) as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureModelCrsLoadable", () => {
  it("passes a model with no reference system through untouched", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      ensureModelCrsLoadable(model(undefined)),
    ).resolves.toBeUndefined();
    await expect(
      ensureModelCrsLoadable(model("CRS84")),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves a fixed-list CRS without any network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      ensureModelCrsLoadable(
        model("https://www.opengis.net/def/crs/EPSG/0/7415"),
      ),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches an unknown metric CRS from epsg.io and admits it", async () => {
    // Real SVY21 (Singapore) definition under a fake code, so the global
    // registry is not polluted for other tests reading the real 3414.
    const svy21 =
      "+proj=tmerc +lat_0=1.366666666666667 +lon_0=103.8333333333333 +k=1 " +
      "+x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs";
    const fetchSpy = fetchOk(svy21);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      ensureModelCrsLoadable(model("urn:ogc:def:crs:EPSG::94321")),
    ).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      "https://epsg.io/94321.proj4",
      expect.anything(),
    );
    expect(proj4.defs("EPSG:94321")).toBeTruthy();
  });

  it("refuses with a sentence when the definition cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(
      ensureModelCrsLoadable(model("urn:ogc:def:crs:EPSG::94322")),
    ).rejects.toThrow(/EPSG:94322 has no proj4 definition/);
  });

  it("still refuses a degree-based CRS the fetch resolved — coverage, not permission", async () => {
    vi.stubGlobal("fetch", fetchOk("+proj=longlat +datum=WGS84 +no_defs"));
    await expect(ensureModelCrsLoadable(model("EPSG:94323"))).rejects.toThrow(
      /not metre-based/,
    );
  });
});
