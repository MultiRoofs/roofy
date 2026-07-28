import { describe, it, expect } from "vitest";
import {
  checkAdmission,
  headerModel,
  parseEpsg,
} from "../../../../../src/domain/citymodel/flatcitybuf/fcbSource";

// Minimal structural stand-ins — checkAdmission only reads info/layout.
// `okInfo` stays a plain (non-`never`) object so it can be spread; `ok` is
// the `never`-cast HeaderView stand-in actually passed to checkAdmission.
// (`(ok as never as typeof ok).info` — the brief's original spread source —
// does not type-check: once a value is annotated `as never`, `typeof` it
// collapses to `never` too, and `never` has no properties to spread.)
const okInfo = {
  version: "1.0",
  featuresCount: 100,
  geographicalExtent: [0, 0, 0, 1000, 1000, 30] as number[] | undefined,
  referenceSystem: "EPSG:28992" as string | undefined,
};
const ok = {
  info: okInfo,
  layout: { rtreeSize: 4096 },
} as never;

describe("checkAdmission", () => {
  it("accepts a well-formed metric header", () => {
    expect(checkAdmission(ok)).toBeNull();
  });

  it("rejects a missing extent", () => {
    const h = {
      info: {
        ...okInfo,
        geographicalExtent: undefined,
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("no-extent");
  });

  it("rejects a degenerate extent", () => {
    const h = {
      info: {
        ...okInfo,
        geographicalExtent: [5, 5, 0, 5, 5, 0],
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("degenerate-extent");
  });

  it("rejects a file with no spatial index", () => {
    const h = {
      info: okInfo,
      layout: { rtreeSize: 0 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("no-index");
  });

  it("rejects an unknown feature count", () => {
    const h = {
      info: { ...okInfo, featuresCount: 0 },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("unknown-count");
  });

  it("rejects a geographic (degree-based) CRS", () => {
    const h = {
      info: {
        ...okInfo,
        referenceSystem: "EPSG:4326",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects non-finite extent values", () => {
    const h = {
      info: {
        ...okInfo,
        geographicalExtent: [0, 0, 0, NaN, 1000, 30],
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-finite");
  });
});

describe("headerModel", () => {
  it("maps every field through, with an asymmetric extent to catch swapped axes", () => {
    const h = {
      info: {
        version: "1.1",
        featuresCount: 250,
        geographicalExtent: [10, 20, 30, 110, 220, 330],
        referenceSystem: "EPSG:7415",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    const model = headerModel(h);
    expect(model.version).toBe("1.1");
    expect(model.featuresCount).toBe(250);
    expect(model.extent).toEqual([10, 20, 30, 110, 220, 330]);
    expect(model.referenceSystem).toBe("EPSG:7415");
    expect(model.epsg).toBe(7415);
  });

  it("reports an unknown feature count (0) as undefined, not 0", () => {
    const h = {
      info: {
        version: "1.1",
        featuresCount: 0,
        geographicalExtent: [0, 0, 0, 1000, 1000, 30],
        referenceSystem: "EPSG:28992",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(headerModel(h).featuresCount).toBeUndefined();
  });

  it("reports a missing reference system as a null epsg, not a thrown error", () => {
    const h = {
      info: {
        version: "1.1",
        featuresCount: 250,
        geographicalExtent: [0, 0, 0, 1000, 1000, 30],
        referenceSystem: undefined,
      },
      layout: { rtreeSize: 4096 },
    } as never;
    const model = headerModel(h);
    expect(model.referenceSystem).toBeUndefined();
    expect(model.epsg).toBeNull();
  });
});

describe("parseEpsg", () => {
  it("extracts the trailing numeric code from an EPSG string", () => {
    expect(parseEpsg("EPSG:28992")).toBe(28992);
  });

  it("extracts the trailing code from a URN-style reference system", () => {
    expect(parseEpsg("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(7415);
  });

  it("returns null for an undefined reference system", () => {
    expect(parseEpsg(undefined)).toBeNull();
  });

  it("returns null when there is no trailing numeric code", () => {
    expect(parseEpsg("EPSG:")).toBeNull();
  });
});
