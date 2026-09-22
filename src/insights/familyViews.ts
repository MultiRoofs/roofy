/**
 * A CityParquet object family's table, as a VIEW over the FILE.
 *
 * Ruling R-B′: DuckDB reads the Parquet itself. The family's source is
 * registered once — a URL over ranged HTTP, a local `File` through
 * `FileReader` — and its "table" is
 * `CREATE OR REPLACE VIEW <name> AS SELECT <kept columns> FROM read_parquet('<registered>')`.
 * Measured on the real 884 106-row Yokohama building table in THIS build
 * (`docs/performance/cityparquet-2026-09-21/duckdb-read-parquet-spike.json`):
 * the view costs 26 ms to publish and no JS heap, a filtered count 34 ms and a
 * 100-row page 793 ms, against 961 ms and 247 MB of DuckDB memory to
 * materialise the same 15 columns. A view also cannot DRIFT from the file,
 * which is the whole point of the milestone: the table answers for objects the
 * camera never delivered.
 *
 * The escape hatch, if paging ever proves too slow: the same code can say
 * `CREATE TABLE … AS SELECT` instead — 0.1 s a page, at those two costs.
 *
 * What this module deliberately does NOT do: decide which families exist or
 * which one is active (that is the family store), and park a failed view for a
 * retry (a family's own state carries its Retry). It publishes through
 * `adoptLayerTable`, so a family's table is `ready` in the registry exactly
 * like any other, under the composite key `${layerId}::${family}`.
 */

import {
  classifyColumnType,
  isDroppedColumn,
  lodsFromColumnNames,
  type ColumnInfo,
} from "./columnKind";
import {
  ddl as sendDdl,
  dropRegisteredFile as sendDropRegisteredFile,
  getDuckDBStatus,
  initDuckDB as bootEngine,
  onEngineDeath,
  registerParquetFile as sendRegisterParquetFile,
  registerParquetUrl as sendRegisterParquetUrl,
  runQuery as sendQuery,
  type RegisterOutcome,
} from "./duckdb";
import { EngineDeadError, racedWithDeath } from "./engineAwait";
import {
  adoptLayerTable,
  dropLayerTable,
  dropLayerTables,
  getLayerTable,
  nextTableName,
  runOnTableQueue,
  type LayerTable,
  type LayerTableOutcome,
} from "./layerTables";
import { buildCountSql, quoteIdent, quoteLiteral } from "./sql";

/**
 * Every engine await here, raced against the engine's DEATH — the same wrapper
 * discipline `layerTables` opens with, and for the same reason: this work runs
 * inside the ONE table FIFO, and duckdb-wasm drops the promises of requests
 * that were in flight when its worker died WITHOUT rejecting them. An unraced
 * DESCRIBE or CREATE caught by a death would never settle, and would hold that
 * queue — every later table build and every processing run — for the life of
 * the page.
 */
function runQuery(sql: string) {
  return racedWithDeath(sendQuery(sql));
}

function ddl(sql: string) {
  return racedWithDeath(sendDdl(sql));
}

function registerUrl(name: string, url: string): Promise<RegisterOutcome> {
  return racedWithDeath(sendRegisterParquetUrl(name, url));
}

function registerFile(name: string, file: File): Promise<RegisterOutcome> {
  return racedWithDeath(sendRegisterParquetFile(name, file));
}

function dropRegisteredFile(name: string): Promise<void> {
  return racedWithDeath(sendDropRegisteredFile(name));
}

function initDuckDB(): Promise<void> {
  return racedWithDeath(bootEngine());
}

/** The message the engine uses for work it cannot run — repeated rather than
 *  imported (`duckdb.ts` keeps it private), but it must READ the same. */
const ENGINE_NOT_RUNNING = "The analytics engine is not running.";
/** The sentence for a table whose database stopped existing. */
const ENGINE_STOPPED = "Analytics engine stopped";

/** Where one family's rows come from. */
export type FamilySource = { readonly url: string } | { readonly file: File };

/**
 * The registered VFS names, per LAYER and per source identity.
 *
 * PER LAYER, not global, and that is not an optimisation: a registration is
 * released when the layer that made it goes away (`retire` drops the view's
 * `sourceName`), and a dropped name still RESOLVES — to nothing, forever. A
 * global cache would survive that drop, so a re-add under the same URL would
 * skip the registration and build a view over an empty file, with no error
 * anywhere. Two layers over one URL therefore hold two registrations on
 * purpose.
 */
const registrations = new Map<string, Map<string, string>>();

/**
 * A `File`'s identity, by OBJECT.
 *
 * `name`+`size`+`lastModified` would collide across two directories and, worse,
 * would treat a RE-PICKED file as the one already registered — but a new handle
 * is exactly what makes a stale one readable again, so the object is the honest
 * identity. A `WeakMap`, so nothing here pins a file the app has let go of.
 */
const fileIdentities = new WeakMap<File, string>();
let fileCounter = 0;
/** The counter the registered NAMES come from. Never reused, never derived from
 *  user text — the name is interpolated into `read_parquet('…')`. */
let nameCounter = 0;

function identityOf(source: FamilySource): string {
  if ("url" in source) return `url:${source.url}`;
  const existing = fileIdentities.get(source.file);
  if (existing !== undefined) return existing;
  const identity = `file:${++fileCounter}`;
  fileIdentities.set(source.file, identity);
  return identity;
}

let disposeEngineDeathWatch: (() => void) | null = null;

/**
 * A new engine has an EMPTY virtual file system.
 *
 * Every name this module remembers belonged to the database that just died, so
 * keeping one would make the next `ensureFamilyView` skip its registration and
 * publish a view over a file that resolves to nothing — an empty table with no
 * error. The views themselves are the registry's problem, and
 * `layerTables.invalidateTablesOnEngineDeath` has already condemned them.
 *
 * The re-arming shape is `layerTables`'s: `onEngineDeath` drops each listener
 * as it fires, one notification per engine, so the next death has to be
 * subscribed to again.
 */
export function installFamilyViewEngineDeathWatch(): () => void {
  disposeEngineDeathWatch?.();
  let unsubscribe = (): void => {};
  const arm = () => {
    unsubscribe = onEngineDeath(() => {
      arm();
      registrations.clear();
    });
  };
  arm();
  const dispose = () => {
    unsubscribe();
    if (disposeEngineDeathWatch === dispose) disposeEngineDeathWatch = null;
  };
  disposeEngineDeathWatch = dispose;
  return dispose;
}

const stopEngineDeathWatch = installFamilyViewEngineDeathWatch();
// A module RE-EVALUATION cannot see the subscription the previous copy left on
// `duckdb.ts`'s listener set; only the old copy can, and this is where it is
// told to. (See the same note in `layerTables`.)
import.meta.hot?.dispose(() => {
  stopEngineDeathWatch();
});

export function resetFamilyViewsForTest(): void {
  installFamilyViewEngineDeathWatch();
  registrations.clear();
  fileCounter = 0;
  nameCounter = 0;
}

// ---------------------------------------------------------------------------
// The pure half — what the integration suite runs against a real DuckDB
// ---------------------------------------------------------------------------

/** `DESCRIBE` of the file itself, which is how the column list is learnt: the
 *  view does not exist yet, and the file is the only authority on its schema. */
export function describeParquetSql(sourceName: string): string {
  return `DESCRIBE SELECT * FROM read_parquet(${quoteLiteral(sourceName)})`;
}

/**
 * The columns a family's view publishes, in the file's own order.
 *
 * The same rule as a materialised table's (`isDroppedColumn`): identity and
 * attributes in, geometry WKB and its sidecars, per-LoD material/texture and
 * the geometry template out. On the real Yokohama building table that is 15 of
 * 37 columns; the dropped ones are the whole reason a view over the file is
 * cheap to read at all.
 */
export function keptFamilyColumns(
  rows: ReadonlyArray<Record<string, unknown>>,
): ColumnInfo[] {
  const kept: ColumnInfo[] = [];
  for (const row of rows) {
    const name = row.column_name;
    const type = row.column_type;
    if (typeof name !== "string" || typeof type !== "string") continue;
    if (isDroppedColumn(name)) continue;
    kept.push({ name, type, kind: classifyColumnType(type) });
  }
  return kept;
}

/**
 * The view, projected column by column.
 *
 * `CREATE OR REPLACE`, so re-ensuring a family is one statement and leaves no
 * second view behind. Every identifier is quoted — real PLATEAU files carry
 * attribute names with spaces and non-ASCII characters — and the registered
 * name travels as a LITERAL, which is why it must be a name this module
 * generated rather than anything a third party chose.
 */
export function buildFamilyViewSql(
  view: string,
  sourceName: string,
  columns: ReadonlyArray<ColumnInfo>,
): string {
  const select = columns.map((c) => quoteIdent(c.name)).join(", ");
  return `CREATE OR REPLACE VIEW ${quoteIdent(view)} AS SELECT ${select} FROM read_parquet(${quoteLiteral(sourceName)})`;
}

// ---------------------------------------------------------------------------
// The engine half
// ---------------------------------------------------------------------------

async function countRows(view: string): Promise<number | null> {
  const result = await runQuery(buildCountSql(view, null));
  // NOT 0: a count that could not run says nothing about the file's size, and a
  // view that exists with an unknown row count is a real, browsable state.
  if (!result.ok) return null;
  const n = result.rows[0]?.n;
  if (typeof n === "number") return n;
  const coerced = Number(n);
  return Number.isFinite(coerced) ? coerced : null;
}

function remember(layerId: string, identity: string, name: string): void {
  const byIdentity = registrations.get(layerId) ?? new Map<string, string>();
  byIdentity.set(identity, name);
  registrations.set(layerId, byIdentity);
}

/**
 * Make sure `layerId`'s `family` has a queryable table, and publish it.
 *
 * Idempotent per (layer, family): the source is registered once per identity,
 * and re-ensuring replaces the view IN PLACE under the name it already has — a
 * fresh name would leave the previous view in the database under a name nothing
 * will ever use again.
 *
 * On the ONE table queue (`runOnTableQueue`), because it mints a table name from
 * the shared counter and must not interleave with a build that is using it.
 *
 * Never throws. A failure comes back as an outcome for the family's own state
 * to show, and nothing is published — a half-made family must not look ready.
 */
export function ensureFamilyView(input: {
  readonly layerId: string;
  readonly family: string;
  readonly source: FamilySource;
  /** The CRS of the FILE's own `bbox` column (R-G), recorded and never
   *  converted: `"EPSG:6697"` for PLATEAU, whose bbox is in degrees. */
  readonly sourceCrs: string | null;
}): Promise<LayerTableOutcome> {
  const { layerId, family, source, sourceCrs } = input;
  return runOnTableQueue(async () => {
    try {
      // The engine takes ~5 s to come up and the first CityParquet layer of a
      // session lands inside that window. `initDuckDB` is memoised and never
      // rejects, so this is one await for the first family and free after.
      await initDuckDB();
      if (getDuckDBStatus().state !== "ready") {
        return { ok: false, message: ENGINE_NOT_RUNNING };
      }

      const identity = identityOf(source);
      let name = registrations.get(layerId)?.get(identity);
      if (name === undefined) {
        const fresh = `family_${++nameCounter}.parquet`;
        const registered =
          "url" in source
            ? await registerUrl(fresh, source.url)
            : await registerFile(fresh, source.file);
        if (!registered.ok) return { ok: false, message: registered.message };
        remember(layerId, identity, fresh);
        name = fresh;
      }

      const described = await runQuery(describeParquetSql(name));
      if (!described.ok) return { ok: false, message: described.message };
      const all = described.rows
        .map((row) => row.column_name)
        .filter((n): n is string => typeof n === "string");
      const kept = keptFamilyColumns(described.rows);
      if (kept.length === 0) {
        return {
          ok: false,
          message: "This family's file has no attribute columns to browse.",
        };
      }

      // The SAME name when this family already has a view, so the statement
      // below replaces it rather than orphaning it.
      const existing = getLayerTable(layerId, family);
      const view =
        existing?.fileBacked === true ? existing.table : nextTableName();
      const created = await ddl(buildFamilyViewSql(view, name, kept));
      if (!created.ok) return { ok: false, message: created.message };

      const info: LayerTable = {
        table: view,
        // The REGISTRATION, which every query re-reads through and which
        // `retire` releases when the view goes. Not a buffer this app holds.
        sourceName: name,
        // No provider and no reader: an export of a file-backed family re-reads
        // the file by its own route rather than replaying bytes from here.
        source: null,
        reader: null,
        extension: null,
        sourceBytes: null,
        columns: kept,
        // From ALL the described names, never the kept ones: the `geometry_lod*`
        // columns the ladder is read from are exactly the dropped ones.
        lods: lodsFromColumnNames(all),
        sourceFeatureIds: null,
        rowCount: await countRows(view),
        fileBacked: true,
        familyKey: family,
        sourceCrs,
      };
      adoptLayerTable(layerId, info);
      return { ok: true };
    } catch (error) {
      // The death released an await that would never have settled. The database
      // is gone, the view went with it, and nothing may be said about this
      // module's own SQL. Anything else is a bug here and must not be reported
      // to the user as a dead engine.
      if (error instanceof EngineDeadError) {
        return { ok: false, message: ENGINE_STOPPED };
      }
      throw error;
    }
  });
}

/**
 * Give up ONE family's view and the registration behind it.
 *
 * What disabling a family calls. Both halves matter: `dropLayerTable` retires
 * the view AND releases its `sourceName`, and forgetting the cache entry is what
 * makes RE-enabling the family work — a dropped VFS name still resolves, to
 * nothing, so a cached name would build a view over an empty file with no error
 * anywhere. Which is also why a file-backed table must never be dropped through
 * `layerTables` directly.
 */
export async function dropFamilyView(
  layerId: string,
  family: string,
): Promise<void> {
  const name = getLayerTable(layerId, family)?.sourceName ?? null;
  const byIdentity = registrations.get(layerId);
  if (byIdentity && name !== null) {
    for (const [identity, registered] of byIdentity) {
      if (registered === name) byIdentity.delete(identity);
    }
    if (byIdentity.size === 0) registrations.delete(layerId);
  }
  await dropLayerTable(layerId, family);
}

/**
 * Give up every table and every registration `layerId` holds.
 *
 * What layer removal calls. The views go first — through `dropLayerTables`,
 * which releases each view's `sourceName` with it — and then anything this
 * module registered but never got a view over (a DESCRIBE that failed) is
 * released too, so the VFS is empty of this layer either way.
 *
 * The cache is FORGOTTEN last and unconditionally: a re-add under the same
 * layer id has to register again, because a dropped name still resolves — to
 * zero bytes, forever.
 */
export async function dropFamilyViews(layerId: string): Promise<void> {
  const names = [...(registrations.get(layerId)?.values() ?? [])];
  registrations.delete(layerId);
  await dropLayerTables(layerId);
  for (const name of names) await dropRegisteredFile(name);
}
