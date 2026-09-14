/**
 * ZIP archives of CityGML, unpacked in the browser.
 *
 * WHY THIS EXISTS: the STAC catalog ships thousands of CityGML datasets as
 * `application/zip` — for many national and municipal providers it is the ONLY
 * distribution form — so "download it yourself, unzip it, drop the .gml" was
 * the whole user journey for those items. Unpacking the container is the only
 * step that was missing; everything past `parseCityGML` already worked.
 *
 * A ZIP IS RECOGNISED BY ITS MAGIC BYTES, NEVER BY ITS EXTENSION — the same
 * rule `decodeModelBytes` uses for gzip, and for the same reason: the catalog
 * is full of `?download=` endpoints and signed-URL redirects whose path has no
 * useful extension at all. `detectEncoding(".zip")` still returns its
 * `"cityjson"` default and that is deliberately left alone; the byte sniff in
 * the loader runs first and never reaches it.
 *
 * ONE ZIP IS ONE LAYER. The archive is a container, not a model, so a
 * multi-entry archive is merged into a single `CityModel` — but ONLY when the
 * merge is trivially correct (every entry agrees on the CRS, and no two entries
 * claim the same object id). Anything else fails with a sentence naming the
 * reason, because a silently half-merged city is worse than a refusal.
 *
 * MEMORY IS BOUNDED BY A TWO-PASS READ, not by hope. `unzipSync` inflates
 * every entry it does not filter out, and a real catalog archive can be far
 * larger than it looks: the PLATEAU Muroran package is a 238 MB download
 * holding 251 `.gml` entries that inflate to ~4.4 GB. So pass 1 inflates
 * NOTHING and only collects the entry list, pass 2 inflates just the entries
 * that were selected, and {@link MAX_CITYGML_ARCHIVE_ENTRIES} caps how many
 * that can be — reported, never silently applied.
 */

import { unzipSync, type UnzipFileInfo } from "fflate";
import { mergeBBox, mergeModelAppearances } from "@cityjson/navara-core";
import type { BBox3, CityModel, CityObject } from "./types";
import { parseCityGML } from "./citygml/parseCityGML";

/**
 * How many CityGML entries one archive may contribute to a single layer.
 *
 * This is a whole-LOAD bound, the same shape of limit as CityParquet's
 * `MAX_CITYPARQUET_FILES`: every selected entry is inflated and DOM-parsed on
 * the UI thread, so the cap is what keeps that pause finite. A fully tiled
 * national dataset is a streaming problem, not a whole-load one.
 */
export const MAX_CITYGML_ARCHIVE_ENTRIES = 32;

/** Extensions that name a CityGML document outright. */
const GML_EXTENSIONS = [".gml", ".citygml"] as const;

/**
 * Considered only when the archive holds no `.gml`/`.citygml` at all.
 *
 * `.xml` is how a few providers spell CityGML, but it is far more often a
 * metadata sidecar (`metadata.xml`, ISO 19139 records — the PLATEAU packages
 * ship 33 of them beside their GML). Treating it as a candidate unconditionally
 * would turn a clean single-GML archive into a multi-entry merge that then
 * fails on the sidecar, so it is a FALLBACK, never a peer.
 */
const XML_EXTENSION = ".xml";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const; // "PK\x03\x04"

/**
 * True when these bytes begin a ZIP local file header.
 *
 * Only the local-file-header spelling is accepted: an empty archive
 * (`PK\x05\x06`) carries no CityGML by definition, and letting it through here
 * would trade a clear "not a city model" for a confusing "no .gml inside".
 */
export function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= ZIP_MAGIC.length &&
    ZIP_MAGIC.every((byte, i) => bytes[i] === byte)
  );
}

/** The last path segment of a zip entry name. */
function baseName(name: string): string {
  return name.split("/").at(-1) ?? name;
}

/**
 * Entries that are real files a user would consider content.
 *
 * Directory entries carry no bytes; `__MACOSX/` holds AppleDouble resource
 * forks that mirror every real name (so a `._foo.gml` would double every
 * candidate); dotfiles are editor and OS litter.
 */
function isContentEntry(name: string): boolean {
  if (name.endsWith("/")) return false;
  if (name.startsWith("__MACOSX/") || name.includes("/__MACOSX/")) return false;
  return !baseName(name).startsWith(".");
}

function hasExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

/**
 * Which entries of an archive to parse as CityGML, in a stable order.
 *
 * Sorted by name so a multi-entry merge is deterministic — the object insertion
 * order of the merged model, and therefore anything downstream that iterates
 * it, must not depend on how the zip happened to be written.
 */
export function selectCityGmlEntries(
  names: readonly string[],
): readonly string[] {
  const content = names.filter(isContentEntry);
  const gml = content.filter((name) => hasExtension(name, GML_EXTENSIONS));
  const selected =
    gml.length > 0
      ? gml
      : content.filter((name) => hasExtension(name, [XML_EXTENSION]));
  return [...selected].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Read an archive's entry names without inflating any of its contents. */
function listEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(bytes, {
    filter: (file: UnzipFileInfo) => {
      names.push(file.name);
      return false;
    },
  });
  return names;
}

/**
 * Merge models parsed from several entries of ONE archive.
 *
 * Refuses rather than guesses. Two entries with different CRSs are two
 * datasets, and every vertex is projected through the model's CRS — merging
 * them would place one of the two somewhere it is not.
 */
function mergeArchiveModels(
  models: readonly { entry: string; model: CityModel }[],
): CityModel {
  const first = models[0];
  if (first === undefined) {
    // Unreachable: the caller rejects an empty selection first.
    throw new Error("The archive contains no CityGML (.gml) file.");
  }
  if (models.length === 1) return first.model;

  const referenceSystem = first.model.metadata.referenceSystem;
  for (const { entry, model } of models) {
    if (model.metadata.referenceSystem !== referenceSystem) {
      throw new Error(
        `The archive mixes coordinate reference systems — "${baseName(first.entry)}" declares ${describeCrs(referenceSystem)} but "${baseName(entry)}" declares ${describeCrs(model.metadata.referenceSystem)}. Unzip it and load the files you want separately.`,
      );
    }
  }

  const objects: Record<string, CityObject> = {};
  const owners = new Map<string, string>();
  let bbox: BBox3 | null = null;
  let vertexCount = 0;

  // Each file parsed its own appearance with its own indices; fold them into
  // one table and rewrite the surfaces to it (shared images deduplicate).
  const merged = mergeModelAppearances(models.map((m) => m.model));

  for (const [i, { entry, model }] of models.entries()) {
    for (const [id, object] of Object.entries(merged.units[i]!)) {
      const owner = owners.get(id);
      if (owner !== undefined) {
        throw new Error(
          `The archive's CityGML files describe overlapping objects — the id "${id}" appears in both "${baseName(owner)}" and "${baseName(entry)}". Unzip it and load the files you want separately.`,
        );
      }
      owners.set(id, entry);
      objects[id] = object;
    }
    bbox = mergeBBox(bbox, model.bbox);
    vertexCount += model.vertexCount;
  }

  return {
    sourceEncoding: "citygml",
    metadata: { ...first.model.metadata, referenceSystem },
    bbox,
    objects,
    vertexCount,
    ...(merged.appearance ? { appearance: merged.appearance } : {}),
  };
}

/** A CRS for an error sentence, including the case where a file declared none. */
function describeCrs(referenceSystem: string | undefined): string {
  return referenceSystem === undefined ? "none" : `"${referenceSystem}"`;
}

/**
 * Parse a ZIP archive of CityGML into one CityModel.
 *
 * @param bytes the raw archive, already known to carry ZIP magic.
 * @param sourceName file name or URL, used only in error sentences.
 * @throws with a sentence naming the reason — no CityGML inside, too many
 *   entries, mixed CRSs, colliding ids, or a corrupt archive.
 */
export function parseCityGmlArchive(
  bytes: Uint8Array,
  sourceName: string,
): CityModel {
  let names: string[];
  try {
    names = listEntryNames(bytes);
  } catch (err) {
    throw new Error(
      `Corrupt or truncated ZIP archive "${sourceName}" — its contents could not be listed.`,
      { cause: err },
    );
  }

  const entries = selectCityGmlEntries(names);
  if (entries.length === 0) {
    throw new Error("The archive contains no CityGML (.gml) file.");
  }
  if (entries.length > MAX_CITYGML_ARCHIVE_ENTRIES) {
    throw new Error(
      `The archive holds ${entries.length} CityGML files, more than the ${MAX_CITYGML_ARCHIVE_ENTRIES} this viewer loads at once. Unzip it and load the tiles you want separately.`,
    );
  }

  const wanted = new Set<string>(entries);
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (file: UnzipFileInfo) => wanted.has(file.name),
    });
  } catch (err) {
    throw new Error(
      `Corrupt or truncated ZIP archive "${sourceName}" — its CityGML entries could not be decompressed.`,
      { cause: err },
    );
  }

  const decoder = new TextDecoder();
  const models = entries.map((entry) => {
    const content = unzipped[entry];
    if (content === undefined) {
      throw new Error(
        `Corrupt or truncated ZIP archive "${sourceName}" — "${baseName(entry)}" could not be read.`,
      );
    }
    try {
      return { entry, model: parseCityGML(decoder.decode(content)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The entry name matters more than the archive's: a user who is told
      // which file inside failed can open exactly that one.
      throw new Error(`"${baseName(entry)}" in the archive: ${message}`, {
        cause: err,
      });
    }
  });

  return mergeArchiveModels(models);
}
