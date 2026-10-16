// The vendored DuckDB extension binaries in public/duckdb-ext/, and the facts
// about them that the vendor and lockstep scripts share.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const EXT_ROOT = path.join(ROOT, "public", "duckdb-ext");
export const MANIFEST_PATH = path.join(EXT_ROOT, "manifest.json");

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

/** Where duckdb-wasm looks: `<repository>/<duckdb>/<platform>/<name>.duckdb_extension.wasm`. */
export function extensionPath(manifest, name) {
  return path.join(
    EXT_ROOT,
    manifest.duckdb,
    manifest.platform,
    `${name}.duckdb_extension.wasm`,
  );
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The printable metadata fields of a DuckDB extension footer, such as
 * ["duckdb_signature", "CPP", "a1455e1", "v1.5.5", "wasm_eh"]. The footer is
 * the last 512 bytes: eight NUL-padded 32-byte fields, then the signature.
 */
export function footerFields(bytes) {
  const start = bytes.length - 512;
  if (start < 0) return [];
  const fields = [];
  for (let i = 0; i < 8; i++) {
    const raw = Buffer.from(
      bytes.subarray(start + i * 32, start + (i + 1) * 32),
    ).toString("latin1");
    const value = raw.replace(/\0+$/, "").replace(/^\0+/, "");
    if (/^[\x20-\x7e]+$/.test(value)) fields.push(value);
  }
  return fields;
}
