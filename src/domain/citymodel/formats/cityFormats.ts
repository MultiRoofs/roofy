/**
 * The city model formats this app reads: one record per encoding, saying how
 * to recognise it, how a layer of it is read, and what its DuckDB table is
 * built from.
 *
 * Every door a city layer comes through asks THIS module. Name detection, the
 * Add Layer dialog's labels, the STAC asset badges, the layer kind line and
 * the table source all used to keep their own table of the five encodings, and
 * the copies disagreed at the edges (`.zip`, an extensionless package
 * directory).
 *
 * ENGINE-FREE and I/O-FREE: the records are data and pure predicates. Reading
 * a file's first bytes, probing a URL and opening a stream are the opener's
 * job (`features/layers/openCityLayer.ts`); this module only says what the
 * bytes and names mean.
 */

import type { CityModelEncoding } from "@cityjson/navara-core";

/**
 * What a layer's DuckDB table is built from when the source is read whole.
 * A streamed layer's table is always `cells`, whatever its format says here.
 */
export type CityTableSource =
  /** The cityjson extension's own reader, over the source's bytes. */
  | {
      readonly kind: "reader";
      readonly reader: "read_cityjson" | "read_cityjsonseq";
      /** The VFS extension the reader recognises the file by. */
      readonly extension: "city.json" | "city.jsonl";
    }
  /** Flattened from the parsed model: no DuckDB reader exists for it. */
  | { readonly kind: "model" }
  /** The package's own Parquet files, read by `read_parquet`. */
  | { readonly kind: "parquet" }
  /** Rows appended as the stream commits cells. */
  | { readonly kind: "cells" };

/**
 * How much a format's first bytes say about it.
 *
 * `definite` is a magic number or a structure no other format has; `possible`
 * is a shape two formats share (a `{` opens both CityJSON and a CityJSONSeq
 * whose first line is longer than the head); `no` rules the format out.
 */
export type SniffVerdict = "definite" | "possible" | "no";

export interface CityFormat {
  readonly id: CityModelEncoding;
  /** How the format is named to the user. */
  readonly label: string;
  /**
   * The path endings that name this format, lowercased, matched after a
   * trailing `.gz` is stripped. CityParquet also recognises shapes no
   * extension describes (a package directory, a bucket pattern); see
   * {@link formatFromName}.
   */
  readonly extensions: ReadonlyArray<string>;
  /** What the first {@link SNIFF_BYTES} of a source say. */
  readonly sniff: (head: Uint8Array) => SniffVerdict;
  /**
   * How a layer is read: parsed `whole` into memory, streamed by viewport, or
   * decided `by-size` (a large CityParquet source streams).
   */
  readonly access: "whole" | "stream" | "by-size";
  /** The stream adapter that reads it, for a format that can stream. */
  readonly adapter: "flatcitybuf" | "cityparquet" | null;
  readonly table: CityTableSource;
}

/**
 * How much of a source the byte sniffers look at. Enough for a CityJSONSeq's
 * first line (its metadata) and the start of the second in every published
 * dataset seen so far; a longer first line leaves the two JSON formats
 * `possible`, and the name decides.
 */
export const SNIFF_BYTES = 64 * 1024;

const FCB_MAGIC = [0x66, 0x63, 0x62] as const; // "fcb", then a version byte
const FCB_MAGIC_TAIL = [0x66, 0x63, 0x62, 0x00] as const; // "fcb\0"
const PARQUET_MAGIC = [0x50, 0x41, 0x52, 0x31] as const; // "PAR1"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const; // "PK\3\4"

function hasBytes(
  head: Uint8Array,
  offset: number,
  bytes: ReadonlyArray<number>,
): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

/** The index of the first byte that is not a UTF-8 BOM or JSON/XML
 *  whitespace, or `head.length`. */
function firstSignificant(head: Uint8Array): number {
  let i = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (
    i < head.length &&
    (head[i] === 0x20 ||
      head[i] === 0x09 ||
      head[i] === 0x0a ||
      head[i] === 0x0d)
  ) {
    i += 1;
  }
  return i;
}

const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_ANGLE = 0x3c;
const NEWLINE = 0x0a;

/** The last byte before `end` that is not JSON whitespace, or -1. */
function lastSignificant(head: Uint8Array, end: number): number {
  let i = end - 1;
  while (
    i >= 0 &&
    (head[i] === 0x20 ||
      head[i] === 0x09 ||
      head[i] === 0x0a ||
      head[i] === 0x0d)
  ) {
    i -= 1;
  }
  return i;
}

/**
 * Is this the head of a JSON text sequence: a first line that is a whole
 * object, a newline, and a second line that opens another one? Both halves
 * are needed: a hand-formatted CityJSON document can open an object on its
 * second line (`"transform":` then `{` below it), but its first line never
 * closes one.
 */
function looksLikeSequence(head: Uint8Array, start: number): boolean {
  const newline = head.indexOf(NEWLINE, start);
  if (newline === -1) return false;
  const close = lastSignificant(head, newline);
  if (close < start || head[close] !== CLOSE_BRACE) return false;
  const next = firstSignificant(head.subarray(newline));
  const at = newline + next;
  return at < head.length && head[at] === OPEN_BRACE;
}

function opensJsonObject(head: Uint8Array): number | null {
  const start = firstSignificant(head);
  return head[start] === OPEN_BRACE ? start : null;
}

const CITYJSON: CityFormat = {
  id: "cityjson",
  label: "CityJSON",
  extensions: [".city.json", ".json"],
  sniff: (head) => {
    const start = opensJsonObject(head);
    if (start === null) return "no";
    return looksLikeSequence(head, start) ? "no" : "possible";
  },
  access: "whole",
  adapter: null,
  table: { kind: "reader", reader: "read_cityjson", extension: "city.json" },
};

const CITYJSONSEQ: CityFormat = {
  id: "cityjsonseq",
  label: "CityJSONSeq",
  extensions: [".city.jsonl", ".jsonl"],
  sniff: (head) => {
    const start = opensJsonObject(head);
    if (start === null) return "no";
    return looksLikeSequence(head, start) ? "definite" : "possible";
  },
  access: "whole",
  adapter: null,
  table: {
    kind: "reader",
    reader: "read_cityjsonseq",
    extension: "city.jsonl",
  },
};

const FLATCITYBUF: CityFormat = {
  id: "flatcitybuf",
  label: "FlatCityBuf",
  extensions: [".fcb"],
  sniff: (head) =>
    hasBytes(head, 0, FCB_MAGIC) && hasBytes(head, 4, FCB_MAGIC_TAIL)
      ? "definite"
      : "no",
  access: "stream",
  adapter: "flatcitybuf",
  table: { kind: "cells" },
};

const CITYGML: CityFormat = {
  id: "citygml",
  label: "CityGML",
  // A ZIP is a container, and CityGML is the only thing this app unpacks from
  // one — so `.zip` names CityGML, and so do the archive's magic bytes.
  extensions: [".gml", ".citygml", ".zip"],
  sniff: (head) => {
    if (hasBytes(head, 0, ZIP_MAGIC)) return "definite";
    return head[firstSignificant(head)] === OPEN_ANGLE ? "definite" : "no";
  },
  access: "whole",
  adapter: null,
  table: { kind: "model" },
};

const CITYPARQUET: CityFormat = {
  id: "cityparquet",
  label: "CityParquet",
  extensions: [".parquet"],
  sniff: (head) => (hasBytes(head, 0, PARQUET_MAGIC) ? "definite" : "no"),
  access: "by-size",
  adapter: "cityparquet",
  table: { kind: "parquet" },
};

/**
 * Every format, in the order the sniffers are consulted when two say
 * `possible`: CityJSON before CityJSONSeq, because a single `{` line is a
 * CityJSON document more often than it is a sequence's first line.
 */
export const CITY_FORMATS: ReadonlyArray<CityFormat> = [
  CITYJSON,
  CITYJSONSEQ,
  FLATCITYBUF,
  CITYGML,
  CITYPARQUET,
];

const BY_ID = new Map<CityModelEncoding, CityFormat>(
  CITY_FORMATS.map((format) => [format.id, format]),
);

export function cityFormat(id: CityModelEncoding): CityFormat {
  const format = BY_ID.get(id);
  if (format === undefined) throw new Error(`Unknown city format "${id}".`);
  return format;
}
