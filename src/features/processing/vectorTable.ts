/**
 * The vector source as ONE table, `__src_<runId>`, for the length of ONE run.
 *
 * A vector layer has no DuckDB table of its own and never gets one: its durable
 * copy is its feature `properties` (§7.6, Design decision (c)). What the
 * predicates, the largest-overlap area and the nearest-distance search need is
 * a relation, and that is what this builds — from an NDJSON document the app
 * has just produced by reprojecting the layer app-side.
 *
 * The pattern is `computedColumns.ts`'s write buffer: encode, `registerBuffer`,
 * one statement, `dropBuffer` the moment it has parsed. The TABLE outlives the
 * buffer by exactly the length of the compute, and the run drops it in a
 * `finally` that runs on every exit — done, failed, cancelled, engine death.
 *
 * No `@duckdb/duckdb-wasm` import: the engine is reached through
 * `insights/duckdb.ts`.
 */
import {
  ddl,
  dropBuffer,
  getDuckDBStatus,
  registerBuffer,
  type QueryOutcome,
} from "../../insights/duckdb";
import {
  EngineDeadError,
  raced,
  racedWithDeath,
} from "../../insights/engineAwait";
import { quoteIdent, quoteLiteral } from "../../insights/sql";
import { SOURCE_OUT_OF_MEMORY } from "./sourceRead";
import type {
  ProjectedFeature,
  VectorPreflight,
  YieldControl,
} from "./vectorSource";

/** The log entry's own label for the one statement below — a statement label,
 *  not spec copy (§6.1's PHASE label "Reading source" is `runFormat.ts`'s and
 *  is unchanged). */
const SOURCE_LABEL = "Reading source layer";

/**
 * How many features one encode batch holds before the walk yields.
 *
 * ONE OF TWO BUDGETS, and the weaker one: ten thousand small areas are bounded
 * by the count, but a handful of enormous rings would blow past any count
 * before the first yield — {@link ENCODE_BYTES} is what bounds those.
 */
const ENCODE_BATCH = 1_000;

/**
 * How many BYTES may be serialised between two yields.
 *
 * Four megabytes is a few milliseconds of `stringify` and `encode` on the
 * shapes §7.5 sees, and far below the allocation sizes that matter.
 */
const ENCODE_BYTES = 4_000_000;

/**
 * How much of ONE value is serialised, encoded and copied per step.
 *
 * THE BUDGET ABOVE IS ONLY A BOUND IF NO SINGLE STEP CAN EXCEED IT.
 * `JSON.stringify`, `TextEncoder.encode` and `TypedArray.set` are each one
 * synchronous call that nothing can interrupt from outside, so a source whose
 * ONE feature is a five-megabyte ring would run every one of them to the end
 * before any budget was ever consulted — which is exactly the "Cancel does
 * nothing" §6.1 forbids. The geometry is the only value whose size is
 * unbounded by nature (Task 12 bounds its ASSEMBLY by the same argument), so
 * the line is written head-first and the WKT is appended in pieces of this
 * size, each escaped, encoded and later copied on its own.
 */
const TEXT_SLICE = 262_144;

/** The same budget for the final copy, which is real work on a large source. */
const COPY_BYTES = 4_000_000;

/** One shared empty array, so a copied chunk can be released without
 *  allocating a replacement. */
const EMPTY = new Uint8Array(0);

export function vectorTableName(runId: string): string {
  return `__src_${runId}`;
}

/**
 * The one statement, with the column types SPELLED OUT.
 *
 * Not `read_json_auto`: inference reads the nested `props` object as a STRUCT,
 * and every probed property accessor is a JSON one (`props->>'name'`,
 * `(props->>'n')::DOUBLE`, `json_keys(props)`). A heterogeneous source layer —
 * one feature carrying a property another lacks — is exactly what inference
 * gets wrong, and `columns=` also pins `idx` to BIGINT so a uniform source
 * cannot be read back as something else.
 *
 * `ST_GeomFromText` and not `ST_GeomFromGeoJSON`: the WKT is already in the
 * target's CRS (the app reprojects app-side; `ST_Transform` is never called),
 * and the GeoJSON path carries the probed trap that an empty `coordinates`
 * array yields an EMPTY geometry rather than NULL — a case preflight has
 * already removed.
 */
export function buildVectorTableSql(table: string, file: string): string {
  return (
    `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT ` +
    `"idx", "sid", "fid", "props", ST_GeomFromText("wkt") AS "geom" ` +
    `FROM read_json(${quoteLiteral(file)}, format = 'newline_delimited', ` +
    `columns = {idx: 'BIGINT', sid: 'VARCHAR', fid: 'VARCHAR', ` +
    `props: 'JSON', wkt: 'VARCHAR'})`
  );
}

export function buildDropVectorTableSql(table: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(table)}`;
}

/**
 * A checkpoint, a macrotask, and a checkpoint again.
 *
 * BOTH SIDES, deliberately. A Cancel is delivered by a timer or an event, which
 * can only run while the walk is parked here — a checkpoint taken solely before
 * the yield reads the state as it was one whole batch ago, and the walk would
 * serialise another four megabytes before noticing. The one after the macrotask
 * is the one that sees a cancel pressed during the pause.
 */
async function pause(control: YieldControl | undefined): Promise<void> {
  control?.checkpoint?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  control?.checkpoint?.();
}

/**
 * One JSON object per line: `{idx, sid, fid, props, wkt}`.
 *
 * `idx` is §7.5's tie rule (source order, gaps included); `sid` is the stable
 * feature id §7.6 writes its results back under; `fid` is §7.7's default
 * nearest-id property; `props` is the fields §7.5 copies; `wkt` becomes the
 * geometry. Every key is written even when its value is null, so the column
 * list above is satisfied by every line.
 *
 * ASYNC AND BOUNDED BY FEATURES, BY BYTES AND WITHIN ONE FEATURE, for the
 * reason `reprojectGeoLayer` is: a source is not "many small features" or "few
 * large ones", it is whatever the user loaded. The feature count bounds the
 * first kind, {@link ENCODE_BYTES} bounds the second, and {@link TEXT_SLICE}
 * bounds the case both miss — the source whose ONE feature is a five-megabyte
 * ring, where a whole-line `stringify` or `encode` would run to the end before
 * any budget was read. Every piece is encoded as it is produced, so the byte
 * count is exact rather than estimated and no batch is ever held twice.
 *
 * THE FINAL BUFFER IS ONE EXACT ALLOCATION, filled chunk by chunk with each
 * chunk RELEASED as it is copied. The total is already known (it was counted
 * during the walk), so a growing buffer with a doubling strategy would buy
 * nothing and cost a full re-copy at every grow; and holding the chunk list
 * until the copy ends would keep a second whole copy of the document alive at
 * the exact moment the first one is at full size. Releasing as we go makes the
 * peak fall from two copies towards one instead of holding at two.
 */
export async function encodeProjectedFeatures(
  features: ReadonlyArray<ProjectedFeature>,
  control?: YieldControl,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let sinceYield = 0;
  let inBatch = 0;
  const write = (text: string): void => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    total += bytes.byteLength;
    sinceYield += bytes.byteLength;
  };
  const spent = (): boolean => sinceYield >= ENCODE_BYTES;
  const rest = async (): Promise<void> => {
    sinceYield = 0;
    inBatch = 0;
    await pause(control);
  };
  for (const [index, f] of features.entries()) {
    // The head is everything but the geometry: four keys of scalars, which is
    // one small `stringify` however large the feature is.
    const head = JSON.stringify(
      { idx: f.idx, sid: f.stableId, fid: f.featureId, props: f.properties },
      // A BIGINT that came from an upstream table arrives as a `BigInt`, which
      // `JSON.stringify` refuses outright rather than skipping — the same
      // replacer `computedColumns.ts`'s write needs.
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    );
    // `head` ends in the object's own `}`; the geometry is appended as the
    // fifth member and the object is closed after it.
    write(`${head.slice(0, -1)},"wkt":"`);
    const wkt = f.wkt;
    let from = 0;
    while (from < wkt.length) {
      let end = Math.min(from + TEXT_SLICE, wkt.length);
      // Never split a surrogate PAIR: JSON escaping is per code unit, so a
      // lone half would be written as one and the value would not read back.
      const last = wkt.charCodeAt(end - 1);
      if (
        end < wkt.length &&
        end - 1 > from &&
        last >= 0xd800 &&
        last <= 0xdbff
      ) {
        end -= 1;
      }
      // `JSON.stringify` of the piece, minus its quotes, IS the escape rule —
      // it is per character, so a piece escapes exactly as the whole would.
      write(JSON.stringify(wkt.slice(from, end)).slice(1, -1));
      from = end;
      if (from < wkt.length && spent()) await rest();
    }
    write('"}\n');
    inBatch += 1;
    // Nothing left to stop before: a yield after the last feature would only
    // delay the caller.
    if (index + 1 >= features.length) break;
    if (inBatch >= ENCODE_BATCH || spent()) await rest();
  }
  const out = new Uint8Array(total);
  let at = 0;
  let copied = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    // Sliced for the same reason the encode is: one `set` of a whole chunk is
    // uninterruptible, and a feature with a large property bag makes a chunk
    // as big as its head.
    let piece = 0;
    while (piece < chunk.byteLength) {
      const end = Math.min(piece + TEXT_SLICE, chunk.byteLength);
      out.set(chunk.subarray(piece, end), at + piece);
      copied += end - piece;
      piece = end;
      const more = piece < chunk.byteLength || i + 1 < chunks.length;
      if (copied >= COPY_BYTES && more) {
        copied = 0;
        await pause(control);
      }
    }
    at += chunk.byteLength;
    chunks[i] = EMPTY;
  }
  return out;
}

export interface VectorTableHandle {
  readonly table: string;
  /** Idempotent, and it NEVER throws or hangs — see {@link releaseVectorTable}. */
  release(): Promise<void>;
}

/**
 * Both halves raced against the engine's death, and neither allowed to throw.
 *
 * This is awaited from a `finally` INSIDE the run's FIFO slot. An unraced await
 * caught by the death never answers (duckdb-wasm clears its pending requests
 * without rejecting them, `engineAwait.ts`'s header), and the shared queue
 * would be held for the life of the page. A rejection would do the same damage
 * a different way. There is nothing to report either: the table died with the
 * database.
 */
async function releaseVectorTable(table: string, file: string): Promise<void> {
  await racedWithDeath(ddl(buildDropVectorTableSql(table))).catch(() => {});
  // A second drop of a name already dropped is free, and it is the only cover
  // for a throw between the register and the create (`export.ts`'s `finally`).
  await racedWithDeath(dropBuffer(file)).catch(() => {});
}

/**
 * Spec §6.1's "Reading source" phase for a VECTOR source.
 *
 * The caller has already refused an empty preflight (§7.5's "The source layer
 * has no features" / "No usable areas in Zones"), so `features` is non-empty
 * here and the NDJSON is never an empty file.
 *
 * `signal` is the RUN's, and it is not optional decoration: `registerBuffer`
 * posts to the worker and waits, so this is one more engine await reached from
 * the table FIFO and it is raced exactly as `readSource`'s is — against the
 * abort AND against the death.
 */
export async function createVectorTable(input: {
  readonly runId: string;
  readonly preflight: VectorPreflight;
  readonly query: (label: string, sql: string) => Promise<QueryOutcome>;
  readonly control?: YieldControl;
  readonly signal?: AbortSignal | null;
}): Promise<VectorTableHandle> {
  const table = vectorTableName(input.runId);
  const file = `${table}.json`;
  const signal = input.signal ?? null;
  const handle: VectorTableHandle = {
    table,
    release: () => releaseVectorTable(table, file),
  };
  const bytes = await encodeProjectedFeatures(
    input.preflight.features,
    input.control,
  );
  const registration = registerBuffer(file, bytes);
  let registered: boolean;
  try {
    registered = await raced(registration, signal);
  } catch (error) {
    // The hand-off may still SUCCEED after the race was lost — a cancel does
    // not reach the worker. Drop what lands, or a multi-megabyte buffer sits in
    // the wasm heap under a name nobody holds. Fire-and-forget and swallowed:
    // the caller is already leaving with the real error.
    void registration.then(
      (ok) => {
        if (ok) void racedWithDeath(dropBuffer(file)).catch(() => {});
      },
      () => {},
    );
    throw error;
  }
  if (!registered) {
    // `registerBuffer` answers false for THREE different things: no database, a
    // status that is not `ready`, and ANY exception from `registerFileBuffer` —
    // it catches and returns false. So the engine's own status
    // (`getDuckDBStatus`, `duckdb.ts:240`) is what tells a death from a
    // registration that merely failed, and only the first is §6.1's "Analytics
    // engine stopped". The second is an allocation the wasm heap could not
    // serve, which §6.1 already has a sentence for; no new copy is invented for
    // it. The race above does not separate them either: `onEngineDeath` fires
    // once per engine and drops its waiters as it fires, so a hand-off STARTED
    // after the engine had gone simply resolves `false`.
    await racedWithDeath(dropBuffer(file)).catch(() => {});
    if (getDuckDBStatus().state !== "ready") throw new EngineDeadError();
    throw new Error(SOURCE_OUT_OF_MEMORY);
  }
  try {
    await input.query(SOURCE_LABEL, buildVectorTableSql(table, file));
  } catch (error) {
    await handle.release();
    throw error;
  }
  // The moment the CREATE has parsed: a large source must not sit in the wasm
  // heap for the length of the compute (`export.ts`'s reader phase).
  await racedWithDeath(dropBuffer(file)).catch(() => {});
  return handle;
}
