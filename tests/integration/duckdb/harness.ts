/**
 * A real DuckDB 1.5.5 with the cityjson extension, under Node.
 *
 * THE EXTENSIONS THE APP SHIPS: every one installs from `public/duckdb-ext/`,
 * served over HTTP by a child process (the blocking bindings fetch an
 * extension synchronously, so a server on this process's own event loop could
 * never answer, and a `LOAD '<path>'` hangs). What the suite proves is
 * therefore about the exact builds a deploy serves.
 *
 * The node runtime caches what it installs under
 * `~/.duckdb/extensions/<last segment of the repository URL>/` and loads that
 * copy ever after: `FORCE INSTALL` does not refresh it and `extension_directory`
 * does not move it. So the repository's last segment carries a hash of the
 * manifest, and a re-vendored build is downloaded afresh.
 *
 * The BLOCKING node bindings, not the app's async browser ones: the app's
 * module boots a `Worker` from a jsDelivr blob, which Node has no equivalent
 * for. Reads over `registerFileBuffer` share the code path with the browser
 * runtime, so what this suite proves about the SQL holds there too.
 *
 * IMPORTED DYNAMICALLY by the suite, inside `beforeAll`. The deep
 * `dist/duckdb-node-blocking.cjs` import below is allowed HERE and nowhere in
 * `src/` — and evaluating it costs a `require` of the node bindings plus three
 * wasm path resolutions, which the default offline run must not pay for a file
 * it only collects and skips.
 *
 * ONE DIFFERENCE FROM THE BROWSER, and it shapes the export tests: under
 * `NODE_RUNTIME` a `COPY … TO 'name'` (and `cityparquet_write`) writes to the
 * REAL filesystem, relative to the process's cwd, rather than into the wasm
 * VFS. `copyFileToBuffer` and `dropFile` still address those paths and behave
 * as the app expects — a dropped name stops being addressable and stops being
 * globbed — but the BYTES survive on disk, so a suite that writes must also
 * clean up after itself with `fs`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/** `public/`, whose `duckdb-ext/` is the vendored extension repository. */
const PUBLIC_DIR = resolve(here, "../../../public");

/** A static server over `public/` on an ephemeral port, in its own process. */
const SERVER = `
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const root = process.argv[1];
const server = http.createServer((req, res) => {
  // "/duckdb-ext-<hash>/…" is "/duckdb-ext/…" under public/.
  const asked = new URL(req.url, "http://x").pathname.replace(/^\\/duckdb-ext-[0-9a-f]+\\//, "/duckdb-ext/");
  const file = path.join(root, decodeURIComponent(asked));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, bytes) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": "application/wasm" }).end(bytes);
  });
});
server.listen(0, "127.0.0.1", () => process.stdout.write(server.address().port + "\\n"));
`;

async function serveExtensions(): Promise<{
  repository: string;
  child: ChildProcess;
}> {
  const child = spawn(process.execPath, ["-e", SERVER, PUBLIC_DIR], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<string>((done, fail) => {
    child.once("error", fail);
    child.once("exit", (code) =>
      fail(new Error(`extension server exited (${code})`)),
    );
    child.stdout!.once("data", (chunk: Buffer) =>
      done(chunk.toString().trim()),
    );
  });
  const key = createHash("sha256")
    .update(readFileSync(resolve(PUBLIC_DIR, "duckdb-ext/manifest.json")))
    .digest("hex")
    .slice(0, 16);
  return { repository: `http://127.0.0.1:${port}/duckdb-ext-${key}`, child };
}

/** `fixtures/`, resolved from THIS file rather than from the cwd. */
export const FIXTURE_DIR = resolve(here, "../../../fixtures");

/** The bytes of a file in `fixtures/`. */
export function fixtureBytes(fixture: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURE_DIR, fixture)));
}

export interface Harness {
  query(sql: string): Record<string, unknown>[];
  /** Register a file from `fixtures/`. */
  register(name: string, fixture: string): void;
  /** Register bytes built in the test itself. */
  registerBytes(name: string, bytes: Uint8Array): void;
  /** A file DuckDB wrote, as bytes — the app's `readFile`. Null on failure. */
  readFile(name: string): Uint8Array | null;
  /** Drop a VFS/disk entry. Never throws, exactly like the app's dropBuffer. */
  dropFile(name: string): void;
  close(): void;
}

/**
 * The slice of the node bindings this harness uses.
 *
 * Spelled out rather than reached through `any`: the module has no ESM types
 * of its own at this path, and naming the four methods is both the
 * documentation of what a harness needs and the thing that would fail to
 * compile if a binding were renamed.
 */
interface ArrowishTable {
  toArray(): ReadonlyArray<{ toJSON?: () => unknown }>;
}

interface NodeConnection {
  query(sql: string): ArrowishTable;
  close(): void;
}

interface NodeDuckDB {
  instantiate(): Promise<void>;
  open(config: { allowUnsignedExtensions?: boolean }): void;
  connect(): NodeConnection;
  registerFileBuffer(name: string, bytes: Uint8Array): void;
  copyFileToBuffer(name: string): Uint8Array;
  dropFile(name: string): void;
}

interface DuckDBNodeModule {
  createDuckDB(
    bundles: unknown,
    logger: unknown,
    runtime: unknown,
  ): Promise<NodeDuckDB>;
  VoidLogger: new () => unknown;
  NODE_RUNTIME: unknown;
}

export async function openDuckDB(): Promise<Harness> {
  const duckdb =
    require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs") as DuckDBNodeModule;
  const dist = dirname(
    require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"),
  );
  const bundles = {
    mvp: {
      mainModule: resolve(dist, "./duckdb-mvp.wasm"),
      mainWorker: resolve(dist, "./duckdb-node-mvp.worker.cjs"),
    },
    eh: {
      mainModule: resolve(dist, "./duckdb-eh.wasm"),
      mainWorker: resolve(dist, "./duckdb-node-eh.worker.cjs"),
    },
  };

  const db = await duckdb.createDuckDB(
    bundles,
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  // As the app opens it: the vendored develop builds are CI artefacts, not
  // signed by a repository.
  db.open({ allowUnsignedExtensions: true });
  const conn = db.connect();
  const { repository, child } = await serveExtensions();
  conn.query(`SET custom_extension_repository = '${repository}';`);
  conn.query(`SET autoinstall_extension_repository = '${repository}';`);
  // Left to throw with the extension's own words: a vendored build this
  // DuckDB refuses is the report the suite exists to make.
  conn.query("INSTALL cityjson;");
  conn.query("LOAD cityjson;");

  return {
    query(sql) {
      const table = conn.query(sql);
      return table.toArray().map((row) => {
        const plain = (row.toJSON ? row.toJSON() : row) as Record<
          string,
          unknown
        >;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(plain)) {
          // The same narrowing the app's `toRows` does: a COUNT(*) arrives as
          // a BigInt, which `JSON.stringify` refuses outright.
          out[key] = typeof value === "bigint" ? Number(value) : value;
        }
        return out;
      });
    },
    register(name, fixture) {
      db.registerFileBuffer(name, fixtureBytes(fixture));
    },
    registerBytes(name, bytes) {
      db.registerFileBuffer(name, bytes);
    },
    readFile(name) {
      try {
        return db.copyFileToBuffer(name);
      } catch {
        return null;
      }
    },
    dropFile(name) {
      try {
        db.dropFile(name);
      } catch {
        /* the name is dead either way — the app's dropBuffer swallows too */
      }
    },
    close() {
      conn.close();
      child.kill();
    },
  };
}

/**
 * `INSTALL` + `LOAD` for one of the app's two lazy extensions, through the
 * harness's own connection.
 *
 * The app's door is `ensureExtension(name)` (`duckdb.ts:540`), which issues
 * exactly these two statements once per session and memoises the promise. The
 * node harness cannot call it (it boots a Worker from a jsDelivr blob), so the
 * statements are spelled here — the ONE place in the integration suites that
 * may, and the reason a probe suite for both extensions is possible at all.
 *
 * Both come from the vendored repository the harness points at. Left to
 * throw: the extension's own words say more than any wrapper could.
 */
export function installExtension(
  db: Harness,
  name: "spatial" | "three_d",
): void {
  db.query(`INSTALL ${name};`);
  db.query(`LOAD ${name};`);
}
