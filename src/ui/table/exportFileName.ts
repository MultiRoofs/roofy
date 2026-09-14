/**
 * The download's file name for a layer and a format.
 *
 * Its own module rather than a second export from `ExportDialog.tsx`, for the
 * same reason `tableText.ts` and `crsCode.ts` exist: a file that exports both
 * a component and a function loses fast refresh, and the linter says so.
 */

/**
 * The extensions a layer name is KNOWN to carry, longest first.
 *
 * Longest first because the list is matched in order and `.city.json` must win
 * over `.json`; `.gz` is stripped in its own pass, so a `.city.json.gz` layer
 * loses both. Splitting at the first dot instead — which is what this used to
 * do — turned "3dbag.v2024.city.json" into "3dbag" and "Delft LoD 2.2" into
 * "Delft LoD 2", quietly deleting the part of the name that said which extract
 * the file was.
 */
const KNOWN_EXTENSIONS: ReadonlyArray<string> = [
  ".city.jsonl",
  ".city.json",
  ".citygml",
  ".parquet",
  ".jsonl",
  ".json",
  ".gml",
  ".fcb",
  ".zip",
];

/**
 * Anything a file name should not carry. Replaced rather than dropped, so two
 * layers whose names differ only in punctuation do not collapse into one.
 *
 * UNICODE-AWARE (`\p{L}\p{N}` under `/u`), not `\w`, which is ASCII: `\w` turned
 * "Zürich" into "Z_rich" and left "東京.city.json" with no stem at all, so a
 * PLATEAU or Swiss extract downloaded as `export.csv`. Every filesystem this
 * app's downloads land on takes non-ASCII letters; what has to go is the
 * separator and shell metacharacter set, which this still removes.
 */
const UNSAFE = /[^\p{L}\p{N}._-]+/gu;

function stripKnownExtensions(name: string): string {
  let stem = name;
  // A chain, not one pass: `.city.json.gz` is a real spelling in the catalog
  // (3D BAG serves it), and so is a doubled `.zip.gz` from an archive mirror.
  for (let stripped = true; stripped; ) {
    stripped = false;
    const lower = stem.toLowerCase();
    if (lower.endsWith(".gz")) {
      stem = stem.slice(0, -3);
      stripped = true;
      continue;
    }
    for (const extension of KNOWN_EXTENSIONS) {
      if (!lower.endsWith(extension)) continue;
      stem = stem.slice(0, -extension.length);
      stripped = true;
      break;
    }
  }
  return stem;
}

/**
 * "delft.city.json" + "csv" -> "delft.csv": the layer's name with every
 * extension it is KNOWN to carry replaced by the format's own, and everything
 * a file name has no business holding replaced by `_`.
 *
 * A name that is nothing but an extension — or nothing but punctuation — has
 * no stem left, and "export" is better than a file called ".csv".
 */
export function exportFileName(layerName: string, format: string): string {
  const cleaned = stripKnownExtensions(layerName.trim()).replace(UNSAFE, "_");
  // Leading and trailing separators are the residue of the strip, not part of
  // anybody's name: "Delft (LoD 2.2)" would otherwise end `..2_`.
  const stem = cleaned.replace(/^[._-]+/, "").replace(/[._-]+$/, "");
  return `${stem || "export"}.${format}`;
}
