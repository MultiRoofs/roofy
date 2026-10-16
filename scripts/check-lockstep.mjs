#!/usr/bin/env node
// The pinned @duckdb/duckdb-wasm and the vendored extensions must agree:
// duckdb-wasm refuses to LOAD an extension whose footer names another DuckDB
// version, and that refusal would only show in the browser.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  extensionPath,
  footerFields,
  readManifest,
  sha256,
} from "./duckdb-ext.mjs";

/** Every disagreement, as a sentence; empty when the three agree. */
export async function lockstepErrors() {
  const require = createRequire(path.join(ROOT, "package.json"));
  const errors = [];
  const manifest = readManifest();

  // 1. package.json pins duckdb-wasm exactly, to the manifest's version.
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const pin = pkg.dependencies?.["@duckdb/duckdb-wasm"];
  if (pin !== manifest.duckdbWasm) {
    errors.push(
      `package.json pins @duckdb/duckdb-wasm "${pin}", the manifest expects "${manifest.duckdbWasm}"`,
    );
  }

  // 2. The installed duckdb-wasm embeds the DuckDB the extensions are built for.
  const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
  const dist = path.dirname(
    require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"),
  );
  const db = await duckdb.createDuckDB(
    {
      mvp: {
        mainModule: path.join(dist, "duckdb-mvp.wasm"),
        mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs"),
      },
      eh: {
        mainModule: path.join(dist, "duckdb-eh.wasm"),
        mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs"),
      },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  const conn = db.connect();
  const version = conn
    .query("PRAGMA version")
    .toArray()[0]
    .toJSON().library_version;
  conn.close();
  if (version !== manifest.duckdb) {
    errors.push(
      `@duckdb/duckdb-wasm embeds DuckDB ${version}, the manifest expects ${manifest.duckdb}`,
    );
  }

  // 3. Every binary is present, unmodified, and built for that DuckDB and platform.
  for (const [name, ext] of Object.entries(manifest.extensions)) {
    let bytes;
    try {
      bytes = new Uint8Array(readFileSync(extensionPath(manifest, name)));
    } catch {
      errors.push(
        `${name}: missing ${path.relative(ROOT, extensionPath(manifest, name))}`,
      );
      continue;
    }
    if (sha256(bytes) !== ext.sha256)
      errors.push(`${name}: sha256 differs from the manifest`);
    const fields = footerFields(bytes);
    for (const want of [manifest.duckdb, manifest.platform]) {
      if (!fields.includes(want))
        errors.push(
          `${name}: footer ${JSON.stringify(fields)} lacks "${want}"`,
        );
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = await lockstepErrors();
  if (errors.length > 0) {
    console.error(`lockstep check failed:\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("lockstep ok");
}
