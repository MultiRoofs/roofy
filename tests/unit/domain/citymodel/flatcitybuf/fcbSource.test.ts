import { describe, it, expect, vi } from "vitest";
import { FcbReader } from "@cityjson/flatcitybuf";
import {
  checkAdmission,
  headerModel,
  openFcb,
} from "../../../../../src/domain/citymodel/flatcitybuf/fcbSource";

// Minimal structural stand-ins — checkAdmission/headerModel read
// info/layout/raw.referenceSystem(). `okInfo` stays a plain (non-`never`)
// object so it can be spread.
const okInfo = {
  version: "1.0",
  featuresCount: 100,
  geographicalExtent: [0, 0, 0, 1000, 1000, 30] as number[] | undefined,
  referenceSystem: "EPSG:28992" as string | undefined,
};

/**
 * A minimal stand-in for the generated `ReferenceSystem` FlatBuffers
 * accessor — `structuredEpsg` (fcbSource.ts) only calls `authority()` and
 * `code()`.
 */
function fakeReferenceSystem(spec: { authority: string | null; code: number }) {
  return { authority: () => spec.authority, code: () => spec.code };
}

/**
 * A minimal stand-in for `HeaderView`. `rs: null` models a header whose
 * `raw.referenceSystem()` itself returns `null` (no ReferenceSystem table
 * at all) — genuinely different from an `EPSG` authority with code `0`.
 */
function fakeHeader(opts: {
  info?: Partial<typeof okInfo>;
  rtreeSize?: number;
  rs: { authority: string | null; code: number } | null;
}) {
  return {
    info: { ...okInfo, ...opts.info },
    layout: { rtreeSize: opts.rtreeSize ?? 4096 },
    raw: {
      referenceSystem: () =>
        opts.rs === null ? null : fakeReferenceSystem(opts.rs),
    },
  } as never;
}

describe("checkAdmission", () => {
  it("accepts a well-formed metric header (EPSG:28992, RD New)", () => {
    const h = fakeHeader({ rs: { authority: "EPSG", code: 28992 } });
    expect(checkAdmission(h)).toBeNull();
  });

  it("accepts a metric CRS proj4 knows built in (EPSG:32631, UTM 31N), not just the RD New special case", () => {
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:32631" },
      rs: { authority: "EPSG", code: 32631 },
    });
    expect(checkAdmission(h)).toBeNull();
  });

  it("rejects a missing extent", () => {
    const h = fakeHeader({
      info: { geographicalExtent: undefined },
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(checkAdmission(h)?.code).toBe("no-extent");
  });

  it("rejects a degenerate extent", () => {
    const h = fakeHeader({
      info: { geographicalExtent: [5, 5, 0, 5, 5, 0] },
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(checkAdmission(h)?.code).toBe("degenerate-extent");
  });

  it("rejects a file with no spatial index", () => {
    const h = fakeHeader({
      rtreeSize: 0,
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(checkAdmission(h)?.code).toBe("no-index");
  });

  it("rejects an unknown feature count, using a reader-consistent fixture (rtreeSize is 0 whenever featuresCount is 0)", () => {
    const h = fakeHeader({
      info: { featuresCount: 0 },
      rtreeSize: 0,
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(checkAdmission(h)?.code).toBe("unknown-count");
  });

  it("rejects a known geographic (degree-based) CRS: EPSG:4326 WGS84", () => {
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:4326" },
      rs: { authority: "EPSG", code: 4326 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a known geographic (degree-based) CRS: EPSG:4269 NAD83", () => {
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:4269" },
      rs: { authority: "EPSG", code: 4269 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a real, projected-but-non-metric CRS: EPSG:2263 (US survey feet) — not established, so refused rather than assumed", () => {
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:2263" },
      rs: { authority: "EPSG", code: 2263 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects an EPSG code proj4 has never heard of (structurally valid, but not registered anywhere)", () => {
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:999999" },
      rs: { authority: "EPSG", code: 999999 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a header whose structured reference system is genuinely absent (raw.referenceSystem() returns null)", () => {
    const h = fakeHeader({
      info: { referenceSystem: undefined },
      rs: null,
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a structured authority that is not EPSG (OGC:CRS84), even though the display string names EPSG nowhere either", () => {
    const h = fakeHeader({
      info: { referenceSystem: "OGC:CRS84" },
      rs: { authority: "OGC", code: 84 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a non-EPSG structured authority even when its numeric code COINCIDES with a real, registered metric EPSG code (asymmetric fixture: a coincidental-pass mutation would admit this)", () => {
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:28992" },
      rs: { authority: "OGC", code: 28992 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects a structured code of 0 ('not set') even when authority is EPSG", () => {
    const h = fakeHeader({ rs: { authority: "EPSG", code: 0 } });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("admits based on the STRUCTURED fields even when the display string is garbage — the display string must not decide admission", () => {
    const h = fakeHeader({
      info: { referenceSystem: "not a real CRS string; ignore me" },
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(checkAdmission(h)).toBeNull();
  });

  it("refuses based on the STRUCTURED fields even when the display string LOOKS like a valid metric EPSG reference (closes the provenance hole: a crafted display string cannot buy admission)", () => {
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:28992" }, // claims RD New (metric)...
      rs: { authority: "EPSG", code: 4326 }, // ...but the structured fields say WGS84 (degrees)
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects non-finite extent values", () => {
    const h = fakeHeader({
      info: { geographicalExtent: [0, 0, 0, NaN, 1000, 30] },
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(checkAdmission(h)?.code).toBe("non-finite");
  });
});

describe("headerModel", () => {
  it("maps every field through, with an asymmetric extent to catch swapped axes", () => {
    const h = fakeHeader({
      info: {
        version: "1.1",
        featuresCount: 250,
        geographicalExtent: [10, 20, 30, 110, 220, 330],
        referenceSystem: "EPSG:7415",
      },
      rs: { authority: "EPSG", code: 7415 },
    });
    const model = headerModel(h);
    expect(model.version).toBe("1.1");
    expect(model.featuresCount).toBe(250);
    expect(model.extent).toEqual([10, 20, 30, 110, 220, 330]);
    expect(model.referenceSystem).toBe("EPSG:7415");
    expect(model.epsg).toBe(7415);
  });

  it("reports an unknown feature count (0) as undefined, not 0", () => {
    const h = fakeHeader({
      info: { version: "1.1", featuresCount: 0 },
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(headerModel(h).featuresCount).toBeUndefined();
  });

  it("reports a genuinely absent structured reference system as a null epsg, not a thrown error", () => {
    const h = fakeHeader({
      info: { version: "1.1", referenceSystem: undefined },
      rs: null,
    });
    const model = headerModel(h);
    expect(model.referenceSystem).toBeUndefined();
    expect(model.epsg).toBeNull();
  });

  it("reports epsg as null, not 0, when the structured code is 0 ('not set') — distinguishes 'not set' from a real code of zero", () => {
    const h = fakeHeader({
      info: { version: "1.1" },
      rs: { authority: "EPSG", code: 0 },
    });
    expect(headerModel(h).epsg).toBeNull();
  });

  it("reports epsg as null when the structured authority is not EPSG, even though the display string is untouched", () => {
    const h = fakeHeader({
      info: { version: "1.1", referenceSystem: "EPSG:28992" },
      rs: { authority: "OGC", code: 28992 },
    });
    expect(headerModel(h).epsg).toBeNull();
  });

  it("reports a missing extent as undefined, not a fabricated BBox3 — admission failed, so the model must not lie about having one", () => {
    const h = fakeHeader({
      info: { version: "1.1", geographicalExtent: undefined },
      rs: { authority: "EPSG", code: 28992 },
    });
    expect(headerModel(h).extent).toBeUndefined();
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
