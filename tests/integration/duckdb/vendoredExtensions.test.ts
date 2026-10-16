// @vitest-environment node
/**
 * The harness runs the extensions the app ships: every one it loads is the
 * build `public/duckdb-ext/manifest.json` records, by the commit in its
 * footer. Without this, a harness that fell back to some other build would
 * keep the rest of the integration suite green while testing the wrong code.
 *
 * Opt-in: `DUCKDB_INTEGRATION=1 npx vp test run tests/integration/duckdb`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Harness } from "./harness";

const enabled = process.env.DUCKDB_INTEGRATION === "1";

interface Manifest {
  readonly extensions: Record<string, { readonly footer: string[] }>;
}

describe.skipIf(!enabled)("the vendored extensions under test", () => {
  let db: Harness;
  let manifest: Manifest;

  beforeAll(async () => {
    const harness = await import("./harness");
    db = await harness.openDuckDB();
    harness.installExtension(db, "three_d");
    harness.installExtension(db, "spatial");
    manifest = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../public/duckdb-ext/manifest.json",
        ),
        "utf8",
      ),
    ) as Manifest;
  }, 180_000);

  afterAll(() => db?.close());

  it.each(["cityjson", "three_d", "spatial"])(
    "loads %s at the manifest's build",
    (name) => {
      const [row] = db.query(
        `SELECT extension_version FROM duckdb_extensions() WHERE extension_name = '${name}' AND loaded`,
      );
      // The footer's second field is the extension's version or commit.
      expect(row?.extension_version).toBe(manifest.extensions[name]!.footer[1]);
    },
  );
});
