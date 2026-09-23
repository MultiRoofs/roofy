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
  columnsFromDescribe,
  countTableRows,
  dropLayerTable,
  dropLayerTables,
  getLayerTable,
  layerTableKey,
  nextTableName,
  runOnTableQueue,
  type LayerTable,
  type LayerTableOutcome,
} from "./layerTables";
import { quoteIdent, quoteLiteral } from "./sql";

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
 * The registered VFS names, per LAYER and per FAMILY — one registration per
 * view, never one shared by whatever resolves to the same source.
 *
 * PER LAYER, not global, and that is not an optimisation: a registration is
 * released when the layer that made it goes away (`retire` drops the view's
 * `sourceName`), and a dropped name still RESOLVES — to nothing, forever. A
 * global cache would survive that drop, so a re-add under the same URL would
 * skip the registration and build a view over an empty file, with no error
 * anywhere. Two layers over one URL therefore hold two registrations on
 * purpose.
 *
 * PER FAMILY for the same reason one step down. Keyed by source IDENTITY, two
 * families of one layer whose hrefs resolve to the same URL (a manifest that
 * lists one href twice) shared a single registration — and the first
 * `dropFamilyView` released the VFS name under the OTHER family's live view,
 * which then read nothing with no error anywhere. `layerTables.retire` releases
 * a view's `sourceName` unconditionally and knows nothing about families, so a
 * reference count would need a second owner of that release across a module
 * boundary `insights/` cannot cross; a duplicate registration, by contrast,
 * costs nothing — `registerFileURL` stores a URL and `registerFileHandle` a
 * `File` reference, neither of them bytes.
 *
 * The IDENTITY is still remembered per family, because a family whose SOURCE
 * changed (a re-picked `File`) must register the new one rather than go on
 * reading the old file under its cached name.
 */
const registrations = new Map<
  string,
  Map<string, { readonly identity: string; readonly name: string }>
>();

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

/**
 * How many times each family — and each LAYER — has been DROPPED.
 *
 * The cancellation the queue alone cannot give. An `ensureFamilyView` that is
 * queued, or awaiting its DESCRIBE, has touched nothing a drop can see: the
 * registry, the parked sources and the enqueues are all still empty for it, so
 * `dropFamilyView` finds no `sourceName` to forget and `dropLayerTables`'
 * key scan cannot find the family at all. Left unguarded the ensure then
 * publishes a live view and a live registration for a family (or a layer) that
 * is gone, and its cached name makes the NEXT ensure build a view over a dropped
 * VFS name — which resolves to nothing and fails at query time.
 *
 * TWO counters because a removal has to cover families nobody has named yet: a
 * drop of one family bumps its slot, a drop of the layer bumps the layer, and an
 * ensure is superseded when EITHER has moved since it started.
 */
const familyDrops = new Map<string, number>();
const layerDrops = new Map<string, number>();

function dropsOf(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

function bumpDrops(map: Map<string, number>, key: string): void {
  map.set(key, dropsOf(map, key) + 1);
}

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
  familyDrops.clear();
  layerDrops.clear();
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
  // The SAME reader a materialised build uses (`layerTables.columnsFromDescribe`),
  // so a view and a table cannot disagree about what a DESCRIBE row means — the
  // classification decides how every cell travels from Arrow to the grid.
  return columnsFromDescribe(rows).filter((c) => !isDroppedColumn(c.name));
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

/** Forget one family's registration, and say which name it was — the caller
 *  releases what nothing else will. */
function forget(layerId: string, family: string): string | null {
  const byFamily = registrations.get(layerId);
  if (!byFamily) return null;
  const entry = byFamily.get(family);
  byFamily.delete(family);
  if (byFamily.size === 0) registrations.delete(layerId);
  return entry?.name ?? null;
}

function remember(
  layerId: string,
  family: string,
  identity: string,
  name: string,
): void {
  const byFamily =
    registrations.get(layerId) ??
    new Map<string, { readonly identity: string; readonly name: string }>();
  byFamily.set(family, { identity, name });
  registrations.set(layerId, byFamily);
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
  // Captured SYNCHRONOUSLY, before the queue: a drop that lands while this call
  // is still waiting for its slot has to count.
  const slot = layerTableKey(layerId, family);
  const dropsAtStart = dropsOf(familyDrops, slot);
  const layerDropsAtStart = dropsOf(layerDrops, layerId);
  /** Has this family — or its whole layer — been dropped since we began? */
  const superseded = () =>
    dropsOf(familyDrops, slot) !== dropsAtStart ||
    dropsOf(layerDrops, layerId) !== layerDropsAtStart;
  const SUPERSEDED: LayerTableOutcome = {
    ok: false,
    message: "This family's table was dropped before its view was created.",
  };
  return runOnTableQueue(async () => {
    try {
      // The engine takes ~5 s to come up and the first CityParquet layer of a
      // session lands inside that window. `initDuckDB` is memoised and never
      // rejects, so this is one await for the first family and free after.
      await initDuckDB();
      // Cheapest possible answer for a family that was dropped while this call
      // sat in the queue: nothing has been registered, so there is nothing to
      // release and no reason to touch the engine at all.
      if (superseded()) return SUPERSEDED;
      if (getDuckDBStatus().state !== "ready") {
        return { ok: false, message: ENGINE_NOT_RUNNING };
      }

      const identity = identityOf(source);
      const cached = registrations.get(layerId)?.get(family);
      // The cached name only counts for the source it was made for. A family
      // whose source CHANGED (a re-picked `File`) registers the new one, and the
      // name it replaces is released after the new view lands — nothing else
      // will, since `adoptLayerTable` replaces the entry rather than retiring
      // it. Unreachable today: a re-pick goes through a fresh layer id.
      const stale = cached !== undefined && cached.identity !== identity;
      let name = stale ? undefined : cached?.name;
      if (name === undefined) {
        const fresh = `family_${++nameCounter}.parquet`;
        const registered =
          "url" in source
            ? await registerUrl(fresh, source.url)
            : await registerFile(fresh, source.file);
        if (!registered.ok) return { ok: false, message: registered.message };
        remember(layerId, family, identity, fresh);
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
        rowCount: await countTableRows(view),
        fileBacked: true,
        familyKey: family,
        sourceCrs,
      };
      // THE last word, immediately before publication. A drop that landed while
      // this was working is queued BEHIND us, so publishing here would hand it a
      // view to retire and a file to release — and would leave the cached name
      // behind for the next ensure to build a dead view over.
      if (superseded()) {
        // Undo our own work rather than leave it for a drop that cannot see it:
        // the view goes, the registration goes, and the cache forgets the name
        // so the next ensure registers a fresh one.
        await ddl(`DROP VIEW IF EXISTS ${quoteIdent(view)}`);
        forget(layerId, name);
        await dropRegisteredFile(name);
        return SUPERSEDED;
      }
      adoptLayerTable(layerId, info);
      // The view the new registration replaced is gone, so the old file can go
      // too (see `stale` above).
      if (stale && cached !== undefined) await dropRegisteredFile(cached.name);
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
  // FIRST, and synchronously: an `ensureFamilyView` still in flight has nothing
  // in the registry for this to find, and the counter is the only way to tell it
  // that what it is about to publish is not wanted.
  bumpDrops(familyDrops, layerTableKey(layerId, family));
  const cached = forget(layerId, family);
  // `dropLayerTable` retires the view AND releases the name the view was built
  // over, which is this family's own — never a sibling's, since every family
  // holds its own registration.
  const retired = getLayerTable(layerId, family)?.sourceName ?? null;
  await dropLayerTable(layerId, family);
  // A registration with no view over it — an ensure that failed after it had
  // registered — has nothing else to release it.
  if (cached !== null && cached !== retired) await dropRegisteredFile(cached);
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
  // Per LAYER, so it also cancels an ensure for a family that has not reached
  // the registry — which is every family whose view is still being built.
  bumpDrops(layerDrops, layerId);
  const names = [...(registrations.get(layerId)?.values() ?? [])].map(
    (entry) => entry.name,
  );
  registrations.delete(layerId);
  await dropLayerTables(layerId);
  for (const name of names) await dropRegisteredFile(name);
}
