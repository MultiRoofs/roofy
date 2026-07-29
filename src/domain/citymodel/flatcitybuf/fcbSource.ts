/**
 * Opening a .fcb source and deciding whether it can be streamed at all.
 *
 * Header extent, transform, and reference system are OPTIONAL in the format;
 * featuresCount 0 means unknown, not empty; and select() throws NoIndex when
 * rtreeSize is 0. Streaming needs an extent and an R-tree, and every distance
 * constant is metres, so a CRS that cannot be established as projected and
 * metre-based is refused rather than guessed — an unknown, missing, or
 * unparseable CRS is refused for the same reason a known degree-based one
 * is: a wrong render is worse than a clear refusal.
 */
import proj4 from "proj4";
import { FcbReader, type HeaderView } from "@cityjson/flatcitybuf";
import type { BBox3 } from "../types";
import { ensureProjDef } from "../crsProjDefs";

export interface FcbHeaderModel {
  readonly version: string;
  readonly featuresCount: number | undefined;
  /** `undefined` exactly when the header carries no geographical extent —
   *  callers must check `checkAdmission` first; this model does not repeat
   *  that gate, so it never lies about having an extent it doesn't. */
  readonly extent: BBox3 | undefined;
  readonly referenceSystem: string | undefined;
  readonly epsg: number | null;
}

export type AdmissionCode =
  | "no-extent"
  | "degenerate-extent"
  | "no-index"
  | "unknown-count"
  | "non-metric-crs"
  | "non-finite";

export interface AdmissionError {
  readonly code: AdmissionCode;
  readonly message: string;
}

/**
 * The EPSG code, read from the header's STRUCTURED reference-system fields
 * (`header.raw.referenceSystem()` → `authority()`/`code()`), never by
 * recomposing them into a display string and parsing that string back
 * apart. Three rounds of hardening `parseEpsg` — an authority check, an
 * anchor, a version-slot character class — each closed one hole and opened
 * another (policy → parser form → field content → input normalisation)
 * because string-round-tripping an already-structured integer is the wrong
 * shape for this decision, not because any one regex was insufficiently
 * clever. `code()` is an integer FlatBuffers field: no digit shape to
 * validate, no range to worry about, no whitespace to trim.
 *
 * `authority()` must equal "EPSG" (case-insensitive, since writers vary
 * capitalisation) — a missing or non-EPSG authority returns `null` rather
 * than being assumed. `code() === 0` means "not set" (mirrors
 * `buildReferenceSystem` in the reader's own `file-info.ts`, which falls
 * back to `codeString()` only to build a display string — not something
 * this function reparses, for the same reason it doesn't reparse anything
 * else).
 */
function structuredEpsg(header: HeaderView): number | null {
  const rs = header.raw.referenceSystem();
  if (rs === null) return null;
  const authority = rs.authority();
  if (authority === null || authority.toUpperCase() !== "EPSG") return null;
  const code = rs.code();
  return code === 0 ? null : code;
}

/**
 * Whether `epsgCode` is known to proj4 (built in, or registered via
 * {@link ensureProjDef}'s fixed list) AND explicitly declared metre-based.
 * Absence of an explicit `units: "m"` — an unregistered code, or one whose
 * definition omits `+units` or uses degrees/feet/etc. — is treated as "not
 * established," per this feature's conservative-refusal policy: every
 * distance constant downstream is metres, so admitting a CRS this function
 * cannot vouch for would silently produce nonsense-scaled cells rather than
 * an honest error.
 */
function isEstablishedMetricCrs(epsgCode: number): boolean {
  ensureProjDef(epsgCode);
  const def = proj4.defs(`EPSG:${epsgCode}`);
  return def?.units === "m";
}

export function checkAdmission(header: HeaderView): AdmissionError | null {
  const info = header.info;
  const layout = header.layout;

  // Checked FIRST: the reader computes rtreeSize = 0 whenever
  // featuresCount === 0 (an unknown count implies no index either), so this
  // check must win over no-index for a real header to ever reach it —
  // otherwise the generic "no spatial index" message would always fire
  // first and this more specific, more actionable one would be dead code.
  if (info.featuresCount === 0) {
    return {
      code: "unknown-count",
      message:
        "This file declares an unknown feature count, which streaming requires.",
    };
  }
  if (layout.rtreeSize === 0) {
    return {
      code: "no-index",
      message:
        "This file has no spatial index, so it cannot be streamed by viewport.",
    };
  }
  const extent = info.geographicalExtent;
  if (!extent) {
    return {
      code: "no-extent",
      message:
        "This file declares no geographical extent, which streaming requires.",
    };
  }
  if (extent.some((v) => !Number.isFinite(v))) {
    return {
      code: "non-finite",
      message: "This file's geographical extent contains non-finite values.",
    };
  }
  if (extent[3] - extent[0] <= 0 || extent[4] - extent[1] <= 0) {
    return {
      code: "degenerate-extent",
      message: "This file's geographical extent has zero width or height.",
    };
  }
  // Admission is decided from the STRUCTURED fields (authority()/code()),
  // never from `info.referenceSystem` — that composed string is used below
  // only to name the CRS in the refusal message, which is metadata, not
  // the decision.
  const epsg = structuredEpsg(header);
  if (epsg === null || !isEstablishedMetricCrs(epsg)) {
    const named = info.referenceSystem
      ? `Reference system "${info.referenceSystem}"`
      : "This file's (missing) reference system";
    return {
      code: "non-metric-crs",
      message: `${named} could not be established as a projected, metre-based CRS. Streaming requires metres.`,
    };
  }
  return null;
}

export function headerModel(header: HeaderView): FcbHeaderModel {
  const info = header.info;
  return {
    version: info.version,
    featuresCount: info.featuresCount === 0 ? undefined : info.featuresCount,
    extent: info.geographicalExtent,
    referenceSystem: info.referenceSystem,
    epsg: structuredEpsg(header),
  };
}

export function openFcb(
  src: { url: string } | { blob: Blob },
): Promise<FcbReader> {
  // fromBlob uses Blob.slice() for real range access; fromBytes COPIES its
  // input, so a multi-GB local file must never go through an ArrayBuffer.
  return "url" in src
    ? FcbReader.fromUrl(src.url)
    : FcbReader.fromBlob(src.blob);
}
