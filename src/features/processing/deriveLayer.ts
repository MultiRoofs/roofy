/**
 * A derived layer: its NAME (spec §6, OUTPUT) and its PREPARATION (§6.1).
 *
 * The name rules live in their own module — the one a later task then extends
 * with the functions that BUILD a derived layer — because three callers need
 * the same answer at three different times and only one of them is a run: the
 * FORM prefills the Name field and validates what the user typed, `submitRun`
 * freezes it (§6.1's frozen parameters include "the destination and new-layer
 * name"), and the PUBLICATION re-checks it, because "a queued run or a rename
 * in between can take it" (§6). A second copy of the comparison rule is how Run
 * and publication come to disagree about what is unique.
 *
 * The NAME rules are pure: no store, no DuckDB, no React. The PREPARATION
 * below is not — it issues the copy's `CREATE TABLE`, writes the run's columns
 * into it and, in one synchronous `publish()`, seeds the table registry and the
 * layer stores. It is called from INSIDE the run's own FIFO slot.
 */
import { runQuery, type QueryOutcome } from "../../insights/duckdb";
import { CancelledError, raced } from "../../insights/engineAwait";
import {
  typeMigrations,
  useComputedColumnStore,
  writeComputedColumns,
  type OutputColumn,
} from "../../insights/computedColumns";
import {
  adoptLayerTable,
  nextTableName,
  type LayerTable,
} from "../../insights/layerTables";
import { quoteIdent, quoteLiteral } from "../../insights/sql";
import { activateLayer } from "../workspace/layerCoordination";
import { selectedObjectBounds } from "../../scene/selectedObjectBounds";
import type { CityModel, CityObject } from "../../domain/citymodel/types";
import {
  mergeGeoDocumentProperties,
  useGeoLayerStore,
  type GeoLayer,
} from "../geoLayers/geoLayerStore";
import { publicGeoDocument } from "../geoLayers/geoJsonRecords";
import { useLayerStore, type Layer } from "../layers/layerStore";
import type { ToolId } from "./types";

/**
 * Why §6's New-layer destination is refused on a streaming target
 * (**[adapted copy A2]**, Decisions recorded item 1).
 *
 * THREE places say it and all three import this: the radio's `title` and the
 * note under it, the form's `runReason` (a draft that already chose "new"
 * survives a retarget onto a streaming layer, and the disabled radio does not
 * unchoose it), and `execute`'s head pre-flight. `ToolView.tsx` would be the
 * obvious home and is the wrong one — `runQueue.ts` may not import a UI module,
 * and a second copy of a sentence is a second sentence.
 */
export const STREAMING_NO_NEW_LAYER =
  "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.";

/**
 * Why "This layer" is refused when the target's table is a VIEW over a file.
 *
 * A CityParquet family's table reads its Parquet file directly (ruling R-B′), so
 * `writeComputedColumns`' `ALTER TABLE` is refused by DuckDB — deep inside the
 * run, where the message means nothing to the user. It is a statement about the
 * WRITE TARGET only: a vector-target tool writes to feature properties, which
 * have no schema to alter, and its city SOURCE being a view costs it nothing.
 *
 * The second sentence is the honest part. Every family table belongs to a
 * STREAMED layer, whose New-layer destination is refused too
 * ({@link STREAMING_NO_NEW_LAYER}), so there is no other route to offer — and
 * pointing at one that is also unavailable would send the user round a loop.
 *
 * Said in the same three places as its neighbour above: the radio, the note
 * under it, the form's `runReason`, and `execute`'s head pre-flight.
 */
export const FILE_BACKED_NO_LAYER_COLUMNS =
  "This layer's table is read straight from the file, so columns cannot be added to it. A streamed layer cannot take a New layer either, so this tool has nowhere to write its results yet.";

/**
 * Spec §6's prefilled name for a tool: "<target> · <tool noun>".
 *
 * The seven the spec spells out are "Delft · solids", "Delft · roof metrics",
 * "Delft · validation", "Delft · extent", "Delft + Zones", "Zones · buildings"
 * and "Delft · nearest Roads" — so two of them name the SOURCE layer as well,
 * which is why this takes three arguments and not two. `sourceName` is null
 * whenever the form has no source yet (the select is empty, or the tool has no
 * `sourceKind`); those two names then drop the source segment rather than
 * printing a placeholder, because Run is refused for the missing source anyway
 * and a name the user can read is worth more than one they have to decode.
 *
 * Exhaustive over `ToolId` with no `default`: a tool added without a noun is a
 * compile error here, which is where it should be.
 */
export function derivedLayerName(
  targetName: string,
  toolId: ToolId,
  sourceName: string | null,
): string {
  switch (toolId) {
    case "roof-metrics":
      return `${targetName} · roof metrics`;
    case "measure-solids":
      return `${targetName} · solids`;
    case "validate-solids":
      return `${targetName} · validation`;
    case "height-from-extent":
      return `${targetName} · extent`;
    case "aggregate-per-area":
      // The TARGET is the vector layer here (§7.6's reversed direction), so
      // this reads "Zones · buildings" and not "Delft · …".
      return `${targetName} · buildings`;
    case "join-by-location":
      return sourceName === null ? targetName : `${targetName} + ${sourceName}`;
    case "distance-to-nearest":
      return sourceName === null
        ? `${targetName} · nearest`
        : `${targetName} · nearest ${sourceName}`;
  }
}

/**
 * §6's comparison rule, in one place: "unique among all layers of the
 * workspace, compared trimmed and case-insensitively".
 *
 * An EMPTY name is never "taken", whatever the layer list holds: the form has
 * two different messages for an empty name and a duplicate one, and folding
 * them together would report the wrong cause for a cleared field.
 */
const fold = (name: string): string => name.trim().toLowerCase();

export function nameTaken(
  name: string,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): boolean {
  const wanted = fold(name);
  if (wanted === "") return false;
  return (
    layers.some((l) => fold(l.name) === wanted) ||
    geoLayers.some((l) => fold(l.name) === wanted)
  );
}

/**
 * §6's publication rule: "a conflict then gets ' (2)' appended and the result
 * card says so, rather than failing a finished run" (and §10 scenario 12).
 *
 * The suffix counts UP past names that are themselves taken, so publishing
 * twice gives " (2)" and " (3)" rather than two layers called " (2)". The loop
 * has no bound because the candidate set is infinite and the layer list is
 * finite — it cannot run more times than there are layers plus one.
 *
 * A name that is FREE is returned exactly as it was given, untrimmed: the form
 * prints what the user typed and `submitRun` freezes the same string.
 */
export function disambiguate(
  name: string,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): { readonly name: string; readonly renamed: boolean } {
  if (!nameTaken(name, layers, geoLayers)) return { name, renamed: false };
  // Trimmed before the suffix: "Zones · buildings  (2)" would be the one name
  // the user did not ask for.
  const base = name.trim();
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!nameTaken(candidate, layers, geoLayers)) {
      return { name: candidate, renamed: true };
    }
  }
}

/**
 * A derived layer that EXISTS but is not yet visible (spec §6.1).
 *
 * "For New layer, the results, the model copy, its table and the layer row are
 * all prepared first and published together as the last step. A cancel (or a
 * failure) that lands BEFORE publication discards every partial resource … and
 * the run reads cancelled with nothing changed."
 *
 * So the preparation returns a plan rather than a layer id: everything costly
 * has happened, nothing anyone can see has.
 */
export interface DerivedPlan {
  readonly name: string;
  /** Publishes model + table + layer row as ONE step; returns the new layer id. */
  publish(): string;
  /** Every partial resource, discarded when a cancel or a failure lands first. */
  discard(): Promise<void>;
}

/**
 * Build a derived CITY layer's table, model copy and row — without publishing
 * any of them (Design decision (f)).
 *
 * THE COPY IS CUT FROM THE PARENT'S TABLE, NOT FROM ITS SOURCE. Re-reading a
 * 300 MB CityJSON to produce rows the engine already holds is a minute of
 * parsing for nothing, and it would need a reader — which a CityGML or
 * CityParquet parent does not have, forcing a second code path for them. One
 * `CREATE TABLE … AS SELECT * FROM <parent> WHERE …` works for every parent
 * kind, brings the parent's own computed columns across WITH their values, and
 * needs no geometry-column filtering because the browsing table never had
 * geometry columns (`isDroppedColumn`).
 *
 * READER-BACKEDNESS IS THEN METADATA PLUS A FILTER: the new `LayerTable` copies
 * the parent's `source`, `reader`, `extension` and `lods` verbatim and sets
 * `sourceFeatureIds` to the root ids it was cut with.
 *
 * CALLED FROM INSIDE THE RUN'S OWN FIFO SLOT. `enqueueLayerTable` must not
 * appear in this module: it goes through the same queue, and enqueueing from
 * inside the queue is a deadlock.
 */
export async function prepareDerivedCityLayer(input: {
  readonly runId: string;
  readonly parent: Layer;
  readonly parentTable: LayerTable;
  readonly name: string;
  readonly rowIds: ReadonlyArray<string> | null;
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly signal: AbortSignal;
  /** The run's own `ctx.query`, so the copy's statements reach §6.4's log. */
  readonly query: (label: string, sql: string) => Promise<QueryOutcome>;
  /**
   * Hand the run's log the statements this preparation's WRITE issued (§6.4).
   *
   * Optional, because the preparation is testable without a log; supplied by
   * `execute`, which is its only production caller and which passes the SAME
   * recorder its own This-layer write uses — so the two destinations cannot
   * drift. Called on failure as well as on success: the statements a failed
   * write got through are what §6.4's record is for.
   */
  readonly recordWrite?: (
    statements: ReadonlyArray<string>,
    ms: number,
    rows: number,
  ) => void;
}): Promise<DerivedPlan> {
  const parentTableName = input.parentTable.table;
  const table = nextTableName();

  // THE FILTER IS OVER FEATURE ROOTS, NOT ROWS. §6's copy holds "the SCOPED
  // features … with their geometry at every LoD", and a feature is its root
  // plus its parts. The same list becomes `sourceFeatureIds`, which is what
  // makes the reader re-read the parent filtered to exactly these.
  let roots: ReadonlyArray<string> | null = null;
  if (input.rowIds !== null) {
    const out = await input.query(
      "Selecting the copy's features",
      `SELECT DISTINCT COALESCE("feature_id", "id") AS f FROM ${quoteIdent(
        parentTableName,
      )} WHERE "id" IN (${input.rowIds.map((id) => quoteLiteral(id)).join(", ")})`,
    );
    if (!out.ok) throw new Error(out.message);
    roots = out.rows.map((r) => String(r.f));
    // `IN ()` is a SYNTAX error in DuckDB, not an empty result. The scope
    // resolution already refuses an empty scope ("Nothing to run on"), so
    // reaching here means the parent's rows moved under the run.
    if (roots.length === 0) {
      throw new Error("Layer changed while running; run again");
    }
  }

  const where =
    roots === null
      ? null
      : `COALESCE("feature_id", "id") IN (${roots
          .map((id) => quoteLiteral(id))
          .join(", ")})`;
  const create = `CREATE TABLE ${quoteIdent(table)} AS SELECT * FROM ${quoteIdent(
    parentTableName,
  )}${where === null ? "" : ` WHERE ${where}`}`;

  // The copy is `SELECT *` off the parent, so it INHERITS every one of the
  // parent's columns — a run whose output collides with one of them has to
  // re-type it (S2), even though `existing` is empty because a New-layer Undo
  // removes the layer rather than restoring values.
  const inheritedTypes = new Map(
    input.parentTable.columns.map((c) => [c.name.toLowerCase(), c.type]),
  );
  /** The inherited columns this run's write DROPS and re-adds — and therefore
   *  empties for every row the run wrote no value for. */
  const migratedNames = typeMigrations(input.columns, inheritedTypes).map(
    (c) => c.name,
  );

  /** Everything this function made, for {@link DerivedPlan.discard}. */
  const drop = async (): Promise<void> => {
    // RACED, and swallowed: the DROP is housekeeping inside a FIFO slot, and a
    // statement caught by the engine's death never answers — an unraced one
    // would hold the shared queue for the life of the page.
    await raced(
      runQuery(`DROP TABLE IF EXISTS ${quoteIdent(table)}`),
      null,
    ).catch(() => undefined);
  };

  try {
    const created = await input.query("Creating the new layer's table", create);
    if (!created.ok) throw new Error(created.message);

    // The run's own columns, written into the COPY. `existing` is empty, so
    // `writeComputedColumns` makes no backup table — Undo of a New-layer run
    // removes the layer (§6.2), it does not restore values.
    //
    // RACED against the engine's death for the reason `execute`'s own write is
    // (`runQueue.ts`'s `raced(writing, null)`): a transaction caught by the
    // death never answers, and this await is inside the shared FIFO slot.
    if (input.rows.size > 0) {
      const t0 = performance.now();
      // Mirrored as they are ISSUED: the race below can reject with the write
      // still in flight (duckdb-wasm strands the statement its worker died
      // under), and there is then no outcome to read the record off. Identical
      // to `written.statements` on every path that resolves.
      const issuedByWrite: string[] = [];
      const written = await raced(
        writeComputedColumns({
          runId: input.runId,
          table,
          columns: input.columns,
          rows: input.rows,
          existing: new Set<string>(),
          // The copy is `SELECT *` off the parent, so it INHERITS every one of
          // the parent's columns — a run whose output collides with one of them
          // has to re-type it (S2), even though `existing` is empty because a
          // New-layer Undo removes the layer rather than restoring values.
          existingTypes: inheritedTypes,
          onStatement: (sql) => issuedByWrite.push(sql),
          signal: input.signal,
        }),
        null,
      ).catch((error: unknown) => {
        // The engine died under the copy's write. §6.4 still has to say what
        // was attempted, so the statements go into the run's log on the way
        // past — the same promise the resolved paths keep below.
        input.recordWrite?.(
          issuedByWrite,
          Math.round(performance.now() - t0),
          input.rows.size,
        );
        throw error;
      });
      // BEFORE the throw below: §6.4's record is of what was ATTEMPTED, so a
      // failed or cancelled write reports its statements exactly as a
      // successful one does.
      input.recordWrite?.(
        written.statements,
        Math.round(performance.now() - t0),
        input.rows.size,
      );
      // A cancelled write is the user's Cancel arriving during the
      // transaction, not a failure — the same translation `execute`'s own
      // write does (`runQueue.ts`: `throw written.cancelled ? new
      // CancelledError() : new Error(written.message)`). Its catch keys on the
      // CLASS, so a generic `Error` here would land a cancelled New-layer run
      // on the card as "failed: Cancelled".
      if (!written.ok) {
        throw written.cancelled
          ? new CancelledError()
          : new Error(written.message);
      }
    }
  } catch (error) {
    await drop();
    throw error;
  }

  // The MODEL copy. `rowIds` is already the row set the new table holds
  // (`resolveScope` expanded the scope to whole features), so the objects to
  // keep need no graph walk — and the run's values are merged in here, which
  // is what makes §6.1's "computed columns live in the model too" true on a
  // derived layer as on an ordinary one.
  const keep =
    input.rowIds === null
      ? Object.keys(input.parent.model.objects)
      : input.rowIds;
  const objects: Record<string, CityObject> = {};
  // §7's "in a new column they are NULL", for the columns the write re-typed:
  // the DROP took every INHERITED value with it, so an object the run wrote
  // nothing for must not go on showing the parent's number in the copy's model
  // while the copy's table holds NULL. Empty for the ordinary case, where the
  // object is carried across untouched.
  const nulls: Record<string, unknown> = Object.fromEntries(
    migratedNames.map((name) => [name, null]),
  );
  for (const id of keep) {
    const object = input.parent.model.objects[id];
    if (object === undefined) continue;
    const values =
      input.rows.get(id) ?? (migratedNames.length > 0 ? nulls : undefined);
    objects[id] =
      values === undefined
        ? object
        : { ...object, attributes: { ...object.attributes, ...values } };
  }
  const model: CityModel = {
    ...input.parent.model,
    objects,
    // THE COPY'S OWN ENVELOPE. `CityModelMesh.getBoundsGeodetic()` reads
    // `model.bbox` and that is what `fitLayer` — §6.2's "Zoom to layer" —
    // frames, so a copy that inherited the parent's bbox would fly the camera
    // to the PARENT's extent: for 312 buildings cut out of 1,115, a view of the
    // whole city with the layer somewhere inside it. `selectedObjectBounds`
    // walks the kept objects and their parts, which is exactly the set the copy
    // holds.
    //
    // Scope "all" keeps every object, so the parent's own envelope IS the
    // copy's and the walk is skipped; a subset whose objects carry no bbox at
    // all (nothing to union) falls back to the parent's rather than to the
    // null island `[0,0,0,0,0,0]` the mesh would otherwise frame.
    bbox:
      input.rowIds === null
        ? input.parent.model.bbox
        : (selectedObjectBounds({ objects }, Object.keys(objects)) ??
          input.parent.model.bbox),
  };

  // Minted HERE, not by `addLayer`, so the table can be adopted BEFORE the row
  // exists: a layer row that is visible for even one render without its table
  // is a layer the catalogue would offer tools against and the grid would find
  // nothing for.
  const layerId = crypto.randomUUID();
  const parent = input.parent;
  const info: LayerTable = {
    table,
    // Verbatim from the parent: this is what makes §6's promise true — "the
    // reader re-reads the parent source filtered to those ids", so every tool,
    // proxy and export format the parent supports works on the copy. A CityGML
    // or CityParquet parent carries nulls here and the copy inherits its
    // limitations, which is exactly what §6 asks for.
    sourceName: input.parentTable.sourceName,
    source: input.parentTable.source,
    reader: input.parentTable.reader,
    extension: input.parentTable.extension,
    sourceBytes: input.parentTable.sourceBytes,
    lods: input.parentTable.lods,
    // The parent's columns PLUS the ones just written into the copy. Copying
    // the parent's list alone would leave the adopted table describing a
    // shape the `ALTER`s above have already changed: the grid would not show
    // the new columns, and the NEXT run's "did this column already exist?"
    // check (`onTable` in `execute`) would classify them as new and let its
    // Undo drop them. Built here rather than DESCRIBEd, because `publish()`
    // is synchronous and the shape is known exactly.
    columns: [
      ...input.parentTable.columns.filter(
        (c) =>
          !input.columns.some(
            (out) => out.name.toLowerCase() === c.name.toLowerCase(),
          ),
      ),
      ...input.columns.map((c) => ({
        name: c.name,
        type: c.type,
        kind: "scalar" as const,
      })),
    ],
    rowCount:
      input.rowIds === null ? input.parentTable.rowCount : input.rowIds.length,
    sourceFeatureIds: roots,
  };

  return {
    name: input.name,
    publish(): string {
      adoptLayerTable(layerId, info);
      // §6: "inherited computed columns keep their provenance". The values came
      // across with the `SELECT *`; the registry entries have to be copied,
      // because it is keyed by layer id.
      const registry = useComputedColumnStore.getState();
      for (const [column, provenance] of Object.entries(
        registry.byLayer[parent.id] ?? {},
      )) {
        registry.setProvenance(layerId, column, provenance);
      }
      // The run's OWN columns get their provenance from `execute` (Task 22),
      // which is the only caller of `publish()` and the only place that knows
      // `tool.name` and the scope sentence. Nothing is written for them here.
      const store = useLayerStore.getState();
      // §6: "The name is re-checked at publication (a queued run or a rename in
      // between can take it): a conflict then gets ' (2)' appended". HERE and
      // nowhere else, because `publish()` is SYNCHRONOUS and inside the run's
      // own FIFO slot — nothing can take the name between this check and the
      // `addLayer` below. The caller reads the published name back off the
      // store to find out whether it was renamed (§10 scenario 12's card).
      const final = disambiguate(
        input.name,
        store.layers,
        useGeoLayerStore.getState().layers,
      );
      store.addLayer({
        id: layerId,
        name: final.name,
        model,
        modelRef: parent.modelRef,
        visible: true,
        // §6.2: "an independent COPY of the target's LoD choice, colour mode,
        // rules and palette (later edits on either side do not affect the
        // other)". Arrays are copied, never shared.
        rules: [...parent.rules],
        colorBy: parent.colorBy,
        singleColor: parent.singleColor,
        unmatchedColor: parent.unmatchedColor,
        selectedAppearance: parent.selectedAppearance,
        insertAfterId: parent.id,
        derivedFrom: {
          layerId: parent.id,
          // The parent's name AS IT IS AT PUBLICATION, which is what §6.2's
          // state line quotes — a run that queued behind a rename says what the
          // layer is called now, and a parent that has been removed leaves the
          // name it was prepared with.
          layerName:
            store.layers.find((l) => l.id === parent.id)?.name ?? parent.name,
          runId: input.runId,
        },
      });
      // `addLayer` derives `selectedLod` from the model and hard-codes
      // `lodMode: "auto"`; §6.2 wants "an independent COPY of the target's LoD
      // choice", and a choice is the LoD AND the mode. `setLayerLod` does not
      // touch the mode, so both setters are needed or a manually chosen LoD
      // comes back as an auto-derived one.
      if (parent.selectedLods !== undefined) {
        store.setLayerLods(layerId, parent.selectedLods);
      } else if (parent.selectedLod !== null) {
        store.setLayerLod(layerId, parent.selectedLod);
      }
      if (parent.lodMode !== "auto") {
        store.setLodMode(layerId, parent.lodMode);
      }
      // §6.2: "it becomes the active layer through the ordinary activate rule
      // (which clears a selection belonging to another layer)".
      activateLayer(layerId);
      return layerId;
    },
    discard: drop,
  };
}

/**
 * Build a derived VECTOR layer: a plain GeoJSON layer whose document is the
 * target's `preparedData` with the run's properties merged in (§6, "A derived
 * vector layer is a plain GeoJSON layer").
 *
 * It holds EVERY area of the target, not only the ones the run wrote to: §6 is
 * explicit that "for Aggregate buildings per area the copy holds ALL target
 * areas (the scope selects the source buildings that are counted, §7.6)", and
 * §10 scenario 11 is exactly that case — 6 areas in, 6 areas out, with
 * `bld_buildings_n` counting only the 2 selected buildings.
 *
 * `async` with nothing to await, matching {@link prepareDerivedCityLayer}: a
 * vector copy touches no database (a geo layer has no table — §8's "nothing new
 * is saved" is what makes `preparedData` the right home), and the caller must
 * not have to know which of the two it is holding.
 */
export async function prepareDerivedVectorLayer(input: {
  readonly runId: string;
  readonly parent: GeoLayer;
  readonly name: string;
  /**
   * The run's declared output columns. Nothing here reads them — the copy's
   * document is the merge of {@link input.rows}, and §6.2's value rule gives an
   * area the run never evaluated no value at all, so there is no column list to
   * pre-declare on a document. Kept because the caller holds one plan type and
   * hands both preparations the same shape.
   */
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}): Promise<DerivedPlan> {
  const parent = input.parent;
  // NARROWED here rather than in the signature: `ToolTarget`'s vector arm is
  // already `GeoJsonLayer`, so a run cannot reach this — but the union is what
  // a caller holds, and a raster parent would otherwise publish a layer with no
  // document at all, which the layer list reads as "needs re-link".
  if (parent.kind !== "geojson") {
    throw new Error("A derived vector layer's parent must be a GeoJSON layer");
  }
  // The ENGINE's document, not `config.data`: `preparedData` is what the
  // engine, the records panel and the GeoJSON export all read, and it is the
  // one every feature's stable id has been stamped into.
  const source = parent.config.preparedData;
  // ONE merge for both destinations (Decisions item 6 (iv)): Task 18's exported
  // pure helper, not a second copy of it. `null` means no feature matched, and
  // the copy is then the parent's document as it stands — safe to share,
  // because the helper never mutates its input and every writer of
  // `preparedData` REPLACES the object rather than editing it
  // (`setPreparedGeoJson` / `replaceGeoPreparedData` in `geoLayerStore.ts`).
  const merged = mergeGeoDocumentProperties(source, input.rows) ?? source;
  // Stripped BEFORE it goes back in, and after the merge rather than before it:
  // the merge matches features on the stable id, which lives in exactly the
  // envelope this removes. `addGeoLayer` then mints the copy's OWN envelope
  // from the same feature ids, so the copy's stable ids are the parent's and
  // nothing private is left in view (see `publicGeoDocument`).
  const document = publicGeoDocument(merged);

  return {
    name: input.name,
    publish(): string {
      const geo = useGeoLayerStore.getState();
      // §6: re-checked HERE, synchronously, inside the run's own FIFO slot —
      // exactly as the city copy does it, so nothing can take the name between
      // the check and the add.
      const final = disambiguate(
        input.name,
        useLayerStore.getState().layers,
        geo.layers,
      );
      // `addGeoLayer` MINTS the id, so unlike the city path there is nothing to
      // pre-mint: no table is adopted here, so nothing needs the id before the
      // row exists. Everything that keys on it therefore comes after.
      const id = geo.addGeoLayer({
        kind: "geojson",
        name: final.name,
        // `data` and nothing else: the store derives `preparedData` and
        // `preparation` from it, and a geo layer with neither data nor a URL
        // reads as "needs re-link" (`isGeoLayerUnavailable`) — the copy is not
        // waiting for a file. It is never persisted — §8 omits a derived layer
        // from the snapshot entirely — so nothing reaches disk by carrying it.
        config: { data: document },
        // §6.2's "an independent COPY": `addGeoLayer` normalises the style into
        // a record of its own, so a later restyle of either side leaves the
        // other alone.
        style: parent.style,
        visible: true,
        opacity: parent.opacity,
        insertAfterId: parent.id,
        derivedFrom: {
          layerId: parent.id,
          // The parent's name AS IT IS AT PUBLICATION, which is what §6.2's
          // state line quotes — the same rule the city copy follows.
          layerName:
            geo.layers.find((l) => l.id === parent.id)?.name ?? parent.name,
          runId: input.runId,
        },
      });
      // §6: "inherited computed columns keep their provenance". The values came
      // across in the document; the registry entries have to be copied, because
      // it is keyed by layer id. The run's OWN columns are given theirs by
      // `execute`, which knows the tool name and the scope sentence.
      const registry = useComputedColumnStore.getState();
      for (const [column, provenance] of Object.entries(
        registry.byLayer[parent.id] ?? {},
      )) {
        registry.setProvenance(id, column, provenance);
      }
      // §6.2: "it becomes the active layer through the ordinary activate rule
      // (which clears a selection belonging to another layer)".
      activateLayer(id);
      return id;
    },
    // Nothing was created outside this closure — no table, no store write — so
    // there is nothing to undo. Present because the caller holds a
    // `DerivedPlan` and must not have to branch on which kind it is.
    async discard(): Promise<void> {},
  };
}
