/**
 * Opening a .fcb source and deciding whether it can be streamed at all.
 *
 * Header extent, transform, and reference system are OPTIONAL in the format;
 * featuresCount 0 means unknown, not empty; and select() throws NoIndex when
 * rtreeSize is 0. Streaming needs an extent and an R-tree, and every distance
 * constant is metres, so a degree-based CRS is refused rather than guessed.
 */
import { FcbReader, type HeaderView } from "@cityjson/flatcitybuf";
import type { BBox3 } from "../types";

export interface FcbHeaderModel {
  readonly version: string;
  readonly featuresCount: number | undefined;
  readonly extent: BBox3;
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

/** Geographic CRS are degree-based; every streaming constant is metres. */
const GEOGRAPHIC_EPSG = new Set([4326, 4979, 4258]);

export function parseEpsg(rs: string | undefined): number | null {
  if (!rs) return null;
  const m = /(\d+)\s*$/.exec(rs.trim());
  return m ? Number(m[1]) : null;
}

export function checkAdmission(header: HeaderView): AdmissionError | null {
  const info = header.info;
  const layout = header.layout;

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
  if (info.featuresCount === 0) {
    return {
      code: "unknown-count",
      message:
        "This file declares an unknown feature count, which streaming requires.",
    };
  }
  const epsg = parseEpsg(info.referenceSystem);
  if (epsg !== null && GEOGRAPHIC_EPSG.has(epsg)) {
    return {
      code: "non-metric-crs",
      message: `EPSG:${epsg} is degree-based. Streaming requires a projected, metre-based CRS.`,
    };
  }
  return null;
}

export function headerModel(header: HeaderView): FcbHeaderModel {
  const info = header.info;
  return {
    version: info.version,
    featuresCount: info.featuresCount === 0 ? undefined : info.featuresCount,
    extent: info.geographicalExtent as BBox3,
    referenceSystem: info.referenceSystem,
    epsg: parseEpsg(info.referenceSystem),
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
