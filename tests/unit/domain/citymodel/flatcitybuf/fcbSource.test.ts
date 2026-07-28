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

  it("rejects a reference system that merely CONTAINS a registered metric code after a query string (the mirror of authority-spoofing: unlike CRS84's misparse landing on an unregistered code, this misparse would land on 28992 — a REAL registered metric CRS — so a reverted parser would wrongly admit this end to end)", () => {
    const h = {
      info: {
        ...okInfo,
        referenceSystem: "EPSG:999999?dataset=28992",
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
  it("extracts the code from the colon form (FlatCityBuf's own header.referenceSystem shape)", () => {
    expect(parseEpsg("EPSG:28992")).toBe(28992);
  });

  it("extracts the code from the colon form for a second code, to prove this isn't special-cased to 28992", () => {
    expect(parseEpsg("EPSG:32631")).toBe(32631);
  });

  it("is case-insensitive on the authority token", () => {
    expect(parseEpsg("epsg:28992")).toBe(28992);
  });

  it("extracts the code from the OGC URI form (CityJSON's metadata.referenceSystem convention)", () => {
    expect(parseEpsg("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(7415);
  });

  it("extracts the code from the OGC URN form", () => {
    expect(parseEpsg("urn:ogc:def:crs:EPSG::28992")).toBe(28992);
  });

  it("returns null for an undefined reference system", () => {
    expect(parseEpsg(undefined)).toBeNull();
  });

  it("returns null when there is no numeric code (colon form)", () => {
    expect(parseEpsg("EPSG:")).toBeNull();
  });

  it("returns null for a non-EPSG authority (OGC:CRS84), rather than misreading a trailing digit as an EPSG code", () => {
    expect(parseEpsg("OGC:CRS84")).toBeNull();
  });

  it("does not match 'EPSG' embedded inside a larger word (authority token must stand alone)", () => {
    expect(parseEpsg("NOTEPSG:1234")).toBeNull();
  });

  // Adversarial sweep (fix round 2): the whole string must match one of the
  // anchored forms exactly. Merely CONTAINING "EPSG" plus a registered code
  // is the mirror-image bug to authority-spoofing, and must fail closed the
  // same way.
  it("refuses a trailing query string after an otherwise-valid colon form", () => {
    expect(parseEpsg("EPSG:999999?dataset=28992")).toBeNull();
  });

  it("refuses a spoofed authority prefix ('NOT-EPSG:') that merely contains 'EPSG'", () => {
    expect(parseEpsg("NOT-EPSG:32631")).toBeNull();
  });

  it("refuses free text that merely mentions EPSG near an unrelated number", () => {
    expect(parseEpsg("garbage EPSG nonsense 32631")).toBeNull();
  });

  // Version-slot smuggling (fix round 3): round 2's anchors used [^/]+ /
  // [^:]* for the <version> placeholder, which matches ANYTHING but the
  // delimiter — a query string, a fragment, a bare space, or an embedded
  // newline — not just a real version number. The version is an integer
  // field in the format (header.fbs), so the slot must be constrained to
  // \d+ / \d* rather than "not the delimiter character".
  it("refuses a URI with a query string smuggled into the version slot", () => {
    expect(
      parseEpsg("https://www.opengis.net/def/crs/EPSG/0?dataset=x/28992"),
    ).toBeNull();
  });

  it("refuses a URI with a fragment smuggled into the version slot", () => {
    expect(
      parseEpsg("https://www.opengis.net/def/crs/EPSG/0#dataset/28992"),
    ).toBeNull();
  });

  it("refuses a URI with an embedded newline smuggled into the version slot", () => {
    expect(
      parseEpsg("https://www.opengis.net/def/crs/EPSG/0\nspoof/28992"),
    ).toBeNull();
  });

  it("refuses a URI with a bare space as the version slot", () => {
    expect(
      parseEpsg("https://www.opengis.net/def/crs/EPSG/ /28992"),
    ).toBeNull();
  });

  it("refuses a URN with a query string smuggled into the version slot", () => {
    expect(parseEpsg("urn:ogc:def:crs:EPSG:?dataset:28992")).toBeNull();
  });

  it("refuses a URN with a fragment smuggled into the version slot", () => {
    expect(parseEpsg("urn:ogc:def:crs:EPSG:#dataset:28992")).toBeNull();
  });

  it("refuses a URN with an embedded newline smuggled into the version slot", () => {
    expect(parseEpsg("urn:ogc:def:crs:EPSG:0\nspoof:28992")).toBeNull();
  });

  it("refuses a URN with a bare space as the version slot", () => {
    expect(parseEpsg("urn:ogc:def:crs:EPSG: :28992")).toBeNull();
  });

  // Already correctly refused before this round (regression guards, not new
  // behaviour): a prefix before "urn:", and trailing content after the code.
  it("still refuses a spoofed prefix before a valid URN form", () => {
    expect(parseEpsg("xurn:ogc:def:crs:EPSG::28992")).toBeNull();
  });

  it("still refuses a valid URN form followed by a trailing query string", () => {
    expect(parseEpsg("urn:ogc:def:crs:EPSG::28992?x=1")).toBeNull();
  });

  it("still refuses a valid URN form followed by a trailing fragment", () => {
    expect(parseEpsg("urn:ogc:def:crs:EPSG::28992#foo")).toBeNull();
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
