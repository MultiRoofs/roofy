import { describe, it, expect, vi } from "vitest";
import { FcbReader } from "@cityjson/flatcitybuf";
import {
  checkAdmission,
  headerModel,
  openFcb,
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
  it("accepts a well-formed metric header (EPSG:28992, RD New)", () => {
    expect(checkAdmission(ok)).toBeNull();
  });

  it("accepts a metric CRS proj4 knows built in (EPSG:32631, UTM 31N), not just the RD New special case", () => {
    const h = {
      info: { ...okInfo, referenceSystem: "EPSG:32631" },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)).toBeNull();
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

  it("rejects an unknown feature count, using a reader-consistent fixture (rtreeSize is 0 whenever featuresCount is 0)", () => {
    const h = {
      info: { ...okInfo, featuresCount: 0 },
      layout: { rtreeSize: 0 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("unknown-count");
  });

  it("rejects a known geographic (degree-based) CRS: EPSG:4326 WGS84", () => {
    const h = {
      info: {
        ...okInfo,
        referenceSystem: "EPSG:4326",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a known geographic (degree-based) CRS: EPSG:4269 NAD83", () => {
    const h = {
      info: {
        ...okInfo,
        referenceSystem: "EPSG:4269",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects an unregistered projected-but-non-metric CRS: EPSG:2263 (US survey feet) — not established, so refused rather than assumed", () => {
    const h = {
      info: {
        ...okInfo,
        referenceSystem: "EPSG:2263",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a missing reference system rather than assuming metric", () => {
    const h = {
      info: {
        ...okInfo,
        referenceSystem: undefined,
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a non-EPSG authority (OGC:CRS84) rather than misparsing a trailing digit as an EPSG code", () => {
    const h = {
      info: {
        ...okInfo,
        referenceSystem: "OGC:CRS84",
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

  it("reports a missing extent as undefined, not a fabricated BBox3 — admission failed, so the model must not lie about having one", () => {
    const h = {
      info: {
        version: "1.1",
        featuresCount: 250,
        geographicalExtent: undefined,
        referenceSystem: "EPSG:28992",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(headerModel(h).extent).toBeUndefined();
  });
});

describe("parseEpsg", () => {
  it("extracts the trailing numeric code from an EPSG string", () => {
    expect(parseEpsg("EPSG:28992")).toBe(28992);
  });

  it("is case-insensitive on the authority token", () => {
    expect(parseEpsg("epsg:28992")).toBe(28992);
  });

  it("extracts the trailing code from a URN-style reference system", () => {
    expect(parseEpsg("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(7415);
  });

  it("extracts the trailing code from a slash-separated short URI, ignoring the version segment before it", () => {
    expect(parseEpsg("EPSG/0/28992")).toBe(28992);
  });

  it("returns null for an undefined reference system", () => {
    expect(parseEpsg(undefined)).toBeNull();
  });

  it("returns null when there is no trailing numeric code", () => {
    expect(parseEpsg("EPSG:")).toBeNull();
  });

  it("returns null for a non-EPSG authority (OGC:CRS84), rather than misreading a trailing digit as an EPSG code", () => {
    expect(parseEpsg("OGC:CRS84")).toBeNull();
  });

  it("does not match 'EPSG' embedded inside a larger word (authority token must stand alone)", () => {
    expect(parseEpsg("NOTEPSG:1234")).toBeNull();
  });
});

describe("openFcb", () => {
  it("routes a url source through FcbReader.fromUrl, not fromBlob", async () => {
    const sentinel = {} as unknown as FcbReader;
    const fromUrl = vi.spyOn(FcbReader, "fromUrl").mockResolvedValue(sentinel);
    const fromBlob = vi
      .spyOn(FcbReader, "fromBlob")
      .mockResolvedValue(sentinel);
    try {
      const result = await openFcb({ url: "https://example.com/city.fcb" });
      expect(fromUrl).toHaveBeenCalledWith("https://example.com/city.fcb");
      expect(fromBlob).not.toHaveBeenCalled();
      expect(result).toBe(sentinel);
    } finally {
      fromUrl.mockRestore();
      fromBlob.mockRestore();
    }
  });

  it("routes a blob source through FcbReader.fromBlob, not fromUrl (fromBytes would copy and OOM a large local file)", async () => {
    const sentinel = {} as unknown as FcbReader;
    const blob = new Blob(["x"]);
    const fromUrl = vi.spyOn(FcbReader, "fromUrl").mockResolvedValue(sentinel);
    const fromBlob = vi
      .spyOn(FcbReader, "fromBlob")
      .mockResolvedValue(sentinel);
    try {
      const result = await openFcb({ blob });
      expect(fromBlob).toHaveBeenCalledWith(blob);
      expect(fromUrl).not.toHaveBeenCalled();
      expect(result).toBe(sentinel);
    } finally {
      fromUrl.mockRestore();
      fromBlob.mockRestore();
    }
  });
});
