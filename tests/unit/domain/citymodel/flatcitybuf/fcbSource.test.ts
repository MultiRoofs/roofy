import { describe, it, expect, vi } from "vitest";
import proj4 from "proj4";
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

/**
 * Permanent record of the reviewer's temporary 14-case CRS probe
 * (2026-07-28 final review, non-blocking item #4). The existing EPSG:2263
 * test above ("rejects a real, projected-but-non-metric CRS") does NOT
 * actually exercise `isEstablishedMetricCrs`'s `def?.units === "m"`
 * comparison — proj4 has no built-in EPSG:2263 definition and it isn't in
 * `crsProjDefs.ts`'s `KNOWN_PROJ4_DEFS` either, so that test only proves the
 * "unregistered code" branch (the SAME branch an absent/malformed authority
 * or a made-up code number falls through to), not "a REGISTERED but
 * non-metric definition is refused." This block closes that gap with a
 * fake code registered directly via `proj4.defs()`, plus authority-shape and
 * code-value edge cases `structuredEpsg`/`isEstablishedMetricCrs` must
 * fail closed on.
 */
describe("checkAdmission — CRS matrix", () => {
  it("accepts a lowercase 'epsg' authority — case-insensitive, since writers vary capitalisation", () => {
    const h = fakeHeader({ rs: { authority: "epsg", code: 28992 } });
    expect(checkAdmission(h)).toBeNull();
  });

  it("accepts a mixed-case 'Epsg' authority", () => {
    const h = fakeHeader({
      info: { referenceSystem: "Epsg:32631" },
      rs: { authority: "Epsg", code: 32631 },
    });
    expect(checkAdmission(h)).toBeNull();
  });

  it("fails closed on an empty-string authority", () => {
    const h = fakeHeader({ rs: { authority: "", code: 28992 } });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("fails closed on a malformed authority that merely contains 'EPSG' as a substring ('EPSGX')", () => {
    const h = fakeHeader({ rs: { authority: "EPSGX", code: 28992 } });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("fails closed on a transposed-letter authority typo ('ESPG')", () => {
    const h = fakeHeader({ rs: { authority: "ESPG", code: 28992 } });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("fails closed on a Unicode homoglyph authority (Cyrillic Е U+0415, not Latin E) that visually resembles 'EPSG'", () => {
    const h = fakeHeader({
      rs: { authority: "ЕPSG", code: 28992 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("fails closed on an authority with trailing whitespace ('EPSG ') — not trimmed before comparison", () => {
    const h = fakeHeader({ rs: { authority: "EPSG ", code: 28992 } });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("fails closed on a negative code — no crash, treated as simply unregistered", () => {
    const h = fakeHeader({ rs: { authority: "EPSG", code: -1 } });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("fails closed on an implausibly huge code — no overflow/coercion surprise admits it", () => {
    const h = fakeHeader({
      rs: { authority: "EPSG", code: Number.MAX_SAFE_INTEGER },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("refuses a REGISTERED non-metre definition — the gap the old EPSG:2263 test didn't actually close", () => {
    // A fake EPSG code, registered directly with proj4 (bypassing
    // crsProjDefs.ts's fixed metric-only list) using US survey feet, not
    // metres — proves `isEstablishedMetricCrs`'s `def.units === "m"` check
    // itself discriminates, not just "is this code known at all."
    proj4.defs(
      "EPSG:900001",
      "+proj=longlat +datum=WGS84 +units=us-ft +no_defs",
    );
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:900001" },
      rs: { authority: "EPSG", code: 900001 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("refuses a REGISTERED definition with no +units at all (undefined, not 'm')", () => {
    proj4.defs("EPSG:900002", "+proj=longlat +datum=WGS84 +no_defs");
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:900002" },
      rs: { authority: "EPSG", code: 900002 },
    });
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("accepts a REGISTERED metre-based definition under a fake code — proves the SAME branch admits when units really is 'm'", () => {
    proj4.defs(
      "EPSG:900003",
      "+proj=sterea +lat_0=52 +lon_0=5 +k=1 +x_0=0 +y_0=0 +ellps=bessel +units=m +no_defs",
    );
    const h = fakeHeader({
      info: { referenceSystem: "EPSG:900003" },
      rs: { authority: "EPSG", code: 900003 },
    });
    expect(checkAdmission(h)).toBeNull();
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
