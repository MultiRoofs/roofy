/**
 * Spec §6.1's "Reading source" phase: re-registering a reader-backed layer's
 * bytes so a run can read GEOMETRY, and dropping them the moment the parse is
 * done.
 *
 * `export.ts:558-578` is the working precedent and the shape is copied from it:
 * a FRESH array from the provider → ONE `registerBuffer` → a `FROM` clause →
 * `dropBuffer` as soon as the one statement has parsed, with the same call in a
 * `finally` for every other exit. A 300 MB CityJSON must not sit in the wasm
 * heap for the length of a compute, which is what §6's workload note is warning
 * the user about.
 *
 * THE LOD LABEL → COLUMN MAPPING COMES FROM `LodColumn`, NEVER FROM STRING
 * SURGERY. `read_cityjson(name, lod => 'X')` requires the file's OWN label
 * ('2.2', never '2') and names the column the label with "." → "_". `"0"` and
 * `"0.0"` are different columns and only the file knows which it has, so the
 * suffix is read off the table's `lods` and never derived.
 *
 * No `@duckdb/duckdb-wasm` import: the engine is reached through
 * `insights/duckdb.ts`.
 */
import {
  dropBuffer,
  getDuckDBStatus,
  registerBuffer,
} from "../../insights/duckdb";
import {
  CancelledError,
  EngineDeadError,
  raced,
  racedWithDeath,
} from "../../insights/engineAwait";
import { quoteLiteral } from "../../insights/sql";
import type { LayerTable } from "../../insights/layerTables";
import type { QueryOutcome } from "../../insights/duckdb";
// TYPE-ONLY, and therefore erased: this module reaches no queue at runtime.
import type { ToolContext } from "./runQueue";

/** Spec §6.1's three source-failure first lines, verbatim, in one place. */
export const SOURCE_READ_FAILED =
  "Could not re-read the source (network or decompression error)";
/**
 * Raised by the EXECUTOR, not by `readSource`: §6.1 says the mismatch is
 * "detected by the id join, the only check possible", and the join needs a
 * query door this module does not have. The words live here with the other
 * two so no tool invents a fourth wording.
 */
export const SOURCE_IDS_DIFFER =
  "The source no longer reads as the loaded layer (object ids differ); add the layer again";
export const SOURCE_OUT_OF_MEMORY = "Not enough memory to read the source";

/** §6's threshold for the workload note: "above 100 MB". */
const WORKLOAD_NOTE_BYTES = 100_000_000;

export interface ReadSourceHandle {
  /** e.g. `read_cityjson('layer_3_run_7.city.json', lod => '2.2')` */
  readonly from: string;
  readonly geometryColumn: string;
  readonly propertiesColumn: string;
  /** `dropBuffer`; idempotent, never throws. Call it from a `finally`. */
  release(): Promise<void>;
}

/**
 * Spec §6: "a workload note when the target's source is large: 'Re-reads a
 * 180 MB source; this can take a minute and needs memory' above 100 MB".
 *
 * Null when the size is unknown — a layer whose table was built from rows has
 * no source to re-read, and inventing a number for it would be worse than
 * saying nothing.
 */
export function sourceWorkloadNote(table: LayerTable): string | null {
  const bytes = table.sourceBytes;
  if (bytes === null || bytes <= WORKLOAD_NOTE_BYTES) return null;
  const mb = Math.round(bytes / 1_000_000);
  return `Re-reads a ${mb} MB source; this can take a minute and needs memory`;
}

/** Is this the failure of an allocation rather than of a fetch? */
function isMemoryFailure(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /out of memory|allocation failed|Array buffer allocation/i.test(
    message,
  );
}

/**
 * An error the APP built the statement wrong with, rather than one the SOURCE
 * caused.
 *
 * DuckDB names its own categories and `formatDuckDBError` keeps the first line
 * whole, so the prefix survives to here — `ctx.query` rethrows
 * `new Error(out.message)` with the engine's message undecorated
 * (`runQueue.ts`), which is what makes the `^` anchor safe. A Binder, Catalog
 * or Parser error is this app's SQL being wrong; telling the user to "check the
 * connection" over it would send them to fix their network because we
 * misspelled a column.
 */
const OUR_FAULT = /^(Binder|Catalog|Parser|Syntax) Error/i;

/**
 * Anything the reader, the decompressor or the file itself raised. DuckDB's
 * own categories for a source it cannot read, plus the shapes a provider's
 * fetch/gunzip produces.
 *
 * `Conversion Error` is IN, deliberately: in a statement whose only inputs are
 * the reader's own columns, it is the file handing back a value the reader
 * cannot turn into the type it declared — a bad WKB blob, a malformed
 * coordinate — and not a cast this app wrote.
 */
const SOURCE_FAULT =
  /invalid input|io error|serialization error|conversion error|decompress|gzip|zstd|json/i;

/**
 * Spec §6.1's source-failure sentence for an error raised while re-reading the
 * source, or `null` when the error is not a source problem and must travel as
 * it is.
 *
 * ONE classifier for BOTH stages. The fetch is the obvious one, but the READER
 * STATEMENT is where the parse and the wasm allocation actually happen: a
 * 300 MB CityJSON that gunzips to garbage or exhausts the heap fails THERE, and
 * without this the user would read DuckDB's own words where §6.1 promises a
 * sentence. The executors call it around their reader statement; `readSource`
 * calls it around the fetch and the hand-off.
 *
 * A `CancelledError` and an `EngineDeadError` come back UNCHANGED — `instanceof`
 * and never `.name`, because both classes extend `Error` without setting one
 * (`engineAwait.ts:33, 44`), so a `.name` test reads every cancellation as a
 * read failure. Neither is a failure of the source: the queue's own catch turns
 * them into "cancelled" and §6.1's "Analytics engine stopped".
 */
export function classifySourceFailure(error: unknown): Error | null {
  if (error instanceof CancelledError || error instanceof EngineDeadError) {
    return error;
  }
  if (isMemoryFailure(error)) return new Error(SOURCE_OUT_OF_MEMORY);
  const message = error instanceof Error ? error.message : String(error);
  if (OUR_FAULT.test(message)) return null;
  return SOURCE_FAULT.test(message) ? new Error(SOURCE_READ_FAILED) : null;
}

/**
 * Spec §6.1's id join — "the only check possible" — as ONE rule every tool that
 * re-reads a source obeys.
 *
 * THE CONTRACT, and it is the caller's half that matters: `requested` is the id
 * set the EXECUTOR'S OWN scope-rows read returned — every scoped row, roots and
 * non-contributors included, taken BEFORE any per-feature roll-up — and
 * `returned` is the set of ids the reader answered with. It is never
 * `ctx.featureIds`, which is `null` on scope "all" and would leave the widest
 * scope the only unchecked one; and it is never the contributors alone, because
 * a root or a non-contributing part that has vanished from the file is exactly
 * as much evidence that the source moved as a missing contributor is.
 *
 * The threshold is EVERY id, not "no match at all": the reader returns a row per
 * object of the file, so an id that does not come back means the file no longer
 * holds that object — precisely §6.1's "no longer reads as the loaded layer".
 * Accepting a partial answer would publish the missing features as "not a
 * solid", a verdict on geometry nobody looked at.
 *
 * What §6.1 excludes is still excluded: a URL whose CONTENT changed under the
 * same ids answers for every id and is not detected. That is the spec's own
 * stated limit, not a gap here.
 */
export function assertSourceIds(
  requested: ReadonlyArray<string>,
  returned: ReadonlySet<string>,
): void {
  for (const id of requested) {
    if (!returned.has(id)) throw new Error(SOURCE_IDS_DIFFER);
  }
}

/**
 * `ctx.query` for a statement that reads the RE-READ SOURCE.
 *
 * Both solids tools issue exactly one such statement and both owe §6.1 the
 * same three things: its sentence when the SOURCE failed, the engine's own
 * words kept in the log, and an error that is the APP's fault rethrown as
 * itself. Written once, here, beside the classifier — a second copy in the
 * second tool is how the two would come to disagree.
 *
 * The `ToolContext` import is TYPE-ONLY and therefore erased, so this module
 * still pulls in no queue at runtime.
 */
export async function readerQuery(
  ctx: Pick<ToolContext, "query" | "warn">,
  label: string,
  sql: string,
): Promise<Extract<QueryOutcome, { readonly ok: true }>> {
  try {
    const out = await ctx.query(label, sql);
    // A type guard, not logic: `ctx.query` throws on a failed statement.
    if (!out.ok) throw new Error(out.message);
    return out;
  } catch (error) {
    const failure = classifySourceFailure(error);
    // `null` is "not a source problem" and `failure === error` is a
    // cancellation or a death: both travel exactly as they are.
    if (failure === null || failure === error) throw error;
    // §6.4 keeps the reproducible record — the same shape the extension phase
    // already uses, which logs DuckDB's reason while the card shows §5's
    // sentence (`runQueue.ts`'s extension failure).
    ctx.warn(error instanceof Error ? error.message : String(error));
    throw failure;
  }
}

export async function readSource(input: {
  readonly runId: string;
  readonly table: LayerTable;
  /** The LoD LABEL ("2.2"), never a suffix. */
  readonly lod: string;
  readonly signal: AbortSignal;
}): Promise<ReadSourceHandle> {
  const { table, runId, lod, signal } = input;
  const { reader, extension, source } = table;
  // Eligibility guarantees all three for a `needsReader` tool
  // (`eligibility.ts`), so this is a narrowing, not a policy — but it fails
  // with §6.1's own sentence rather than with a TypeError.
  if (reader === null || extension === null || source === null) {
    throw new Error(SOURCE_READ_FAILED);
  }
  const column = table.lods.find((l) => l.label === lod);
  if (column === undefined) throw new Error(SOURCE_READ_FAILED);

  // A name per RUN. `registerBuffer` detaches what it is given and a name read
  // after `dropBuffer` still RESOLVES, to garbage (`duckdb.ts`'s own doc), so a
  // run never addresses a name another read may have dropped.
  const name = `${table.table}_${runId}.${extension}`;

  let bytes: Uint8Array;
  try {
    // `raced` against the run's signal: a Cancel pressed during a 300 MB fetch
    // rejects with `CancelledError`, which is what makes the card read
    // "cancelled" rather than "failed".
    bytes = await raced(source(), signal);
  } catch (error) {
    // A cancellation and a death come back from the classifier UNCHANGED, so
    // the queue's catch still reads them as "cancelled" and §6.1's "Analytics
    // engine stopped". Everything a PROVIDER can raise is a read failure by
    // definition — it only fetches and decompresses — so the `null` case
    // (an error the classifier does not recognise) falls back to §6.1's read
    // sentence here rather than travelling raw.
    throw classifySourceFailure(error) ?? new Error(SOURCE_READ_FAILED);
  }

  // RACED, like every other engine await. `registerBuffer` posts to the worker
  // and waits, and duckdb-wasm's `onError` clears its pending requests WITHOUT
  // rejecting them — so an unraced hand-off inside the run's FIFO slot strands
  // the shared queue for the life of the page. Task 25 puts the same race
  // inside the primitive; this is the one call that cannot wait for it,
  // because Task 8 switches a tool that goes through here ON before then.
  const registration = registerBuffer(name, bytes);
  let registered: boolean;
  try {
    registered = await raced(registration, signal);
  } catch (error) {
    // The hand-off may still SUCCEED after the race was lost — a cancel does
    // not reach the worker. Drop what lands, or a multi-megabyte buffer sits
    // in the wasm heap under a name nobody holds. Fire-and-forget and
    // swallowed: the caller is already leaving with the real error.
    void registration.then(
      (ok) => {
        if (ok) void racedWithDeath(dropBuffer(name)).catch(() => {});
      },
      () => {},
    );
    throw classifySourceFailure(error) ?? new Error(SOURCE_READ_FAILED);
  }
  if (!registered) {
    // The hand-off was REFUSED (not lost), and `false` means two different
    // things: `registerBuffer` returns it for a DEAD engine as well as for a
    // refused allocation (`duckdb.ts` — `if (!db || status.state !== "ready")
    // return false;`, and its `catch` returns the same `false`), and
    // `raced(…, signal)` above races the ABORT signal only, so a death does not
    // reject it. Telling the user the source was too large when the engine had
    // stopped is the wrong sentence, so the status decides.
    if (getDuckDBStatus().state !== "ready") throw new EngineDeadError();
    throw new Error(SOURCE_OUT_OF_MEMORY);
  }

  let released = false;
  return {
    from: `${reader}(${quoteLiteral(name)}, lod => ${quoteLiteral(column.label)})`,
    geometryColumn: `geometry_lod${column.suffix}`,
    propertiesColumn: `geometry_properties_lod${column.suffix}`,
    async release() {
      if (released) return;
      released = true;
      // RACED, and swallowed. `dropBuffer`'s body swallows a REJECTION but
      // says nothing about a promise that never settles, and duckdb-wasm's
      // `onError` clears its pending requests WITHOUT rejecting them. This is
      // awaited from a `finally` inside the run's FIFO slot, so a death here
      // would strand the shared queue for the life of the page.
      await racedWithDeath(dropBuffer(name)).catch(() => {});
    },
  };
}
