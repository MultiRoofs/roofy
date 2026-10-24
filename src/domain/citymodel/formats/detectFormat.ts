/**
 * What a source IS, from its name, its first bytes and the user's word.
 *
 * Precedence, strongest witness first:
 *  1. the user's choice (the Add Layer dialog's correction, or the format a
 *     saved layer was opened as);
 *  2. a `definite` byte signature — a magic number, or a second line that
 *     opens another object;
 *  3. the name, unless the bytes rule it out;
 *  4. the strongest `possible` byte verdict;
 *  5. CityJSON, this viewer's own format, whose parser then says what is
 *     wrong with the bytes.
 *
 * A gzipped head is no evidence at all: the formats this app gunzips are told
 * apart by what is inside, and only the name sees that far.
 */

import type { CityModelEncoding } from "@cityjson/navara-core";
import { CITY_FORMATS, cityFormat, type SniffVerdict } from "./cityFormats";
import { isCityParquetUrl } from "./cityParquetUrl";

/** The path part of a name or URL, lowercased, with one `.gz` stripped. */
function extensionPath(nameOrUrl: string): string {
  let path: string;
  try {
    path = new URL(nameOrUrl).pathname.toLowerCase();
  } catch {
    path = nameOrUrl.toLowerCase().split("#")[0]!.split("?")[0]!;
  }
  return path.endsWith(".gz") ? path.slice(0, -3) : path;
}

/**
 * The format a name or URL names, or `null` when it names none.
 *
 * CityParquet first: it is as often a package directory (`…/pkg/`) or a
 * bucket pattern (`gs://b/*.parquet`) as a `.parquet` file, and only its own
 * classifier recognises those. `isCityParquetUrl` is total — it answers true
 * for an unlistable https wildcard too, so the loader can explain why.
 */
export function formatFromName(nameOrUrl: string): CityModelEncoding | null {
  const trimmed = nameOrUrl.trim();
  if (trimmed === "") return null;
  if (isCityParquetUrl(trimmed)) return "cityparquet";
  const path = extensionPath(trimmed);
  // Longest extension first across ALL formats, so `.city.jsonl` is never
  // taken for `.json`'s neighbour and `.jsonl` never ends in `.json`.
  let best: { id: CityModelEncoding; length: number } | null = null;
  for (const format of CITY_FORMATS) {
    for (const ext of format.extensions) {
      if (path.endsWith(ext) && (best === null || ext.length > best.length)) {
        best = { id: format.id, length: ext.length };
      }
    }
  }
  return best?.id ?? null;
}

function isGzip(head: Uint8Array): boolean {
  return head.length > 2 && head[0] === 0x1f && head[1] === 0x8b;
}

function verdicts(
  head: Uint8Array,
): ReadonlyArray<{ id: CityModelEncoding; verdict: SniffVerdict }> {
  return CITY_FORMATS.map((format) => ({
    id: format.id,
    verdict: format.sniff(head),
  }));
}

/**
 * The format a source's first bytes point at — the `definite` one, else the
 * first `possible` one — or `null` when they say nothing (empty, gzipped, or
 * unlike every format).
 */
export function sniffFormat(head: Uint8Array): CityModelEncoding | null {
  if (head.length === 0 || isGzip(head)) return null;
  const all = verdicts(head);
  return (
    all.find((v) => v.verdict === "definite")?.id ??
    all.find((v) => v.verdict === "possible")?.id ??
    null
  );
}

export interface DetectFormatInput {
  readonly name?: string;
  /** The source's first bytes, when the caller has them (a dropped file). */
  readonly head?: Uint8Array | null;
  readonly override?: CityModelEncoding;
}

export function detectFormat(input: DetectFormatInput): CityModelEncoding {
  if (input.override !== undefined) return input.override;
  const named = input.name === undefined ? null : formatFromName(input.name);
  const head = input.head;
  if (
    head === undefined ||
    head === null ||
    head.length === 0 ||
    isGzip(head)
  ) {
    return named ?? "cityjson";
  }
  const all = verdicts(head);
  const definite = all.find((v) => v.verdict === "definite");
  if (definite !== undefined) return definite.id;
  if (named !== null && cityFormat(named).sniff(head) !== "no") return named;
  return all.find((v) => v.verdict === "possible")?.id ?? named ?? "cityjson";
}
