#!/usr/bin/env node
// Download the DuckDB extensions listed in public/duckdb-ext/manifest.json into
// public/duckdb-ext/<duckdb>/<platform>/ and record their sha256 and footer.
//
//   node scripts/vendor-extensions.mjs                  # every extension with a URL source
//   node scripts/vendor-extensions.mjs cityjson=<path>  # one extension from a local build
//
// Then `npm run check:lockstep`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MANIFEST_PATH,
  extensionPath,
  footerFields,
  readManifest,
  sha256,
} from "./duckdb-ext.mjs";

const manifest = readManifest();
const overrides = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [name, ...rest] = arg.split("=");
    return [name, rest.join("=")];
  }),
);

for (const [name, ext] of Object.entries(manifest.extensions)) {
  const local = overrides[name];
  let bytes;
  if (local) {
    bytes = new Uint8Array(readFileSync(local));
    ext.source = `local file (${path.basename(local)})`;
  } else if (/^https?:\/\//.test(ext.source)) {
    const res = await fetch(ext.source);
    if (!res.ok) throw new Error(`${name}: GET ${ext.source} → ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    console.log(
      `skip ${name}: source is "${ext.source}"; pass ${name}=<file> to replace it`,
    );
    continue;
  }
  const fields = footerFields(bytes);
  if (
    !fields.includes(manifest.duckdb) ||
    !fields.includes(manifest.platform)
  ) {
    throw new Error(
      `${name}: footer ${JSON.stringify(fields)} is not ${manifest.duckdb}/${manifest.platform}`,
    );
  }
  const dest = extensionPath(manifest, name);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  ext.sha256 = sha256(bytes);
  ext.footer = fields.filter((f) => f !== "duckdb_signature");
  console.log(
    `vendored ${name} (${bytes.length} bytes) → ${path.relative(process.cwd(), dest)}`,
  );
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
