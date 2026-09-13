/**
 * Everything spec §6's form needs about ONE tool, gathered from the stores.
 *
 * It lives beside the view rather than under `features/` because it is a hook
 * over several UI-side stores (the layer tables, the geo layers, the counts
 * hook, the computed column registry and the query store) — the pure parts it
 * leans on (`toolEligibility`, `toolById`, `resolveCrossLayerParams`) are
 * already engine-free and tested there.
 *
 * The draft is stored per tool for the session (spec §6), so the form is
 * restored on the way back from the catalogue; a stored draft naming a layer
 * that has since gone falls back to the default target rather than rendering an
 * empty select.
 *
 * TWO LAYERS, NOT ONE. A cross-layer tool reads a SOURCE as well as writing a
 * TARGET (spec §3), and for §7.6 the two swap stores: the target is the vector
 * layer and the buildings come from a city one. Everything that is really a
 * question about the CITY layer — the table, the proxies, the LoD ladder, the
 * scope counts, §6's workload note — is asked of `cityLayer` below, which is
 * the same layer the queue calls `computeLayerId`.
 */
import { useMemo } from "react";
import { useLayerStore, type Layer } from "../../features/layers/layerStore";
import {
  useGeoLayerStore,
  type GeoJsonLayer,
} from "../../features/geoLayers/geoLayerStore";
import { geoRecords } from "../../features/geoLayers/geoRecords";
import { useLayerCounts } from "../table/useLayerCounts";
import {
  computedColumnsOf,
  useComputedColumnStore,
} from "../../insights/computedColumns";
import {
  useProcessingStore,
  type ToolDraft,
} from "../../features/processing/processingStore";
import { toolById } from "../../features/processing/toolRegistry";
import {
  derivedLayerName,
  nameTaken,
  STREAMING_NO_NEW_LAYER,
} from "../../features/processing/deriveLayer";
import { toolEligibility } from "../../features/processing/eligibility";
import { proxyOptions } from "../../features/processing/buildingProxy";
import {
  crossLayerParamsError,
  numericColumnsOf,
  resolveCrossLayerParams,
  slugifyField,
  POLYGONAL_KINDS,
  SOURCE_NEEDS_AREAS,
  TARGET_NEEDS_AREAS,
  type CrossLayerContext,
} from "../../features/processing/crossLayerParams";
import {
  documentGeometryKinds,
  documentHasFeatureIds,
  documentHasFeatures,
  geoPropertyTypes,
} from "../../features/processing/vectorSource";
import { sourceWorkloadNote } from "../../features/processing/sourceRead";
import type { ToolDefinition, ToolId } from "../../features/processing/types";
import type { LayerTable } from "../../insights/layerTables";
import {
  eligibilityContextFor,
  useEligibilityInputs,
} from "./useEligibilityContext";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { NO_LOD, useLodOptions } from "./useLodOptions";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";

/** An EMPTY prefix is a legal prefix — it is how the bare column names are
 *  asked for, and the collision check below is what refuses it when they are
 *  already the source's. */
const PREFIX_RE = /^(?:[a-z][a-z0-9_]*)?$/i;

/** §6: "an empty or duplicate name is flagged inline at Run". The spec gives
 *  no sentence for either; both are **[adapted copy A13, A14]**, written to
 *  §6's own terse pattern and approved at the plan gate. */
const NAME_EMPTY = "Name the new layer";
const NAME_TAKEN = "A layer is already called that";

/**
 * Spec §6: "a workload note when the target's source is large".
 *
 * Only for a run that RE-READS the source — a run computing from the table or
 * the model pays none of this cost, and a warning about a read that will not
 * happen is a false alarm — and only for an IMPLEMENTED tool: §6's rule is that
 * a tool whose executor has not shipped claims no fact about the user's data,
 * and "this can take a minute" is a fact about a read the app cannot perform.
 *
 * THE RE-READ IS A QUESTION ABOUT THE PARAMETERS TOO, not only about the tool.
 * The three cross-layer tools declare `needsReader: false` because their source
 * read is OPTIONAL: only §7.5's "Footprint (LoD 0)" proxy opens the reader, and
 * the two bbox proxies answer out of the browsing table. So the resolved bag is
 * asked as well, and a run on the extent rectangle or the extent centre shows
 * no note at all.
 *
 * A function of a tool DEFINITION rather than an expression inside the hook, so
 * every conjunct can be stated on a definition that declares itself: the rule
 * outlives whichever registry entry has not shipped yet.
 */
export function toolWorkloadNote(
  tool: ToolDefinition,
  table: LayerTable | null,
  params: Readonly<Record<string, unknown>> = {},
): string | null {
  if (!tool.implemented || table === null) return null;
  if (!tool.needsReader && params["proxy"] !== "footprint") return null;
  return sourceWorkloadNote(table);
}

/** One row of the TARGET or SOURCE select. */
export interface LayerOption {
  readonly id: string;
  readonly name: string;
  readonly disabled: boolean;
  /** §5's reason, as the row's tooltip and as Run's reason. */
  readonly reason: string | null;
}

/** Does the document carry at least one area (§7.5, §7.6)? */
function hasAreas(layer: GeoJsonLayer): boolean {
  return [...documentGeometryKinds(layer.config.preparedData)].some((kind) =>
    POLYGONAL_KINDS.has(kind),
  );
}

/**
 * Why a vector layer cannot be this tool's SOURCE, or null.
 *
 * IN THE SPEC'S OWN ORDER, and the order is the whole of it: a layer that is
 * still loading, or that failed, has no document to ask about geometry — and
 * asking anyway answers "no polygons", which would put "Needs areas
 * (polygons)" on a layer that is full of them. So preparation first
 * (**[adapted copy A4]**, the same two sentences `eligibility.ts` says about a
 * vector TARGET), then §7.5/§7.7's empty-source sentence, and only then the
 * geometry kind §7.5 needs.
 */
function vectorSourceReason(
  layer: GeoJsonLayer,
  toolId: ToolId,
): string | null {
  const preparation = layer.config.preparation;
  if (preparation === "loading") return "This vector layer is still loading";
  if (preparation === "failed") return "This vector layer could not be loaded";
  if (!documentHasFeatures(layer.config.preparedData)) {
    return "The source layer has no features";
  }
  if (SOURCE_NEEDS_AREAS.has(toolId) && !hasAreas(layer)) {
    return "Needs areas (polygons)";
  }
  return null;
}

export function useToolForm(toolId: ToolId) {
  const tool = toolById(toolId);
  const active = useActiveLayer();
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const inputs = useEligibilityInputs();
  const { tables } = inputs;
  const drafts = useProcessingStore((s) => s.drafts);
  const runs = useProcessingStore((s) => s.runs);
  useComputedColumnStore((s) => s.byLayer); // subscribe: the replace warning depends on it

  const vectorCandidates = useMemo(
    () => geoLayers.filter((l): l is GeoJsonLayer => l.kind === "geojson"),
    [geoLayers],
  );
  // Spec §6: the select lists "only layers the tool can target", which is the
  // tool's whole eligibility, not just "the table is ready". `candidates` keeps
  // the wider list so an UNIMPLEMENTED tool (every eligibility fails) still
  // opens on a layer rather than on a blank select — §5's "a disabled row still
  // opens the tool view".
  const candidates = useMemo(
    () => layers.filter((l) => tables[l.id]?.state === "ready"),
    [layers, tables],
  );
  const eligibleTargets = useMemo(
    () =>
      candidates.filter(
        (l) =>
          toolEligibility(
            tool,
            eligibilityContextFor({ kind: "city", layer: l }, inputs),
          ).ok,
      ),
    // `inputs` is a fresh object each render, so the memo recomputes per render
    // — the filter is a handful of pure calls over at most a few layers, and
    // the alternative is five dependencies that drift.
    [candidates, inputs, tool],
  );
  const eligibleVectorTargets = useMemo(
    () =>
      vectorCandidates.filter(
        (l) =>
          toolEligibility(
            tool,
            eligibilityContextFor({ kind: "geo", layer: l }, inputs),
          ).ok,
      ),
    [vectorCandidates, inputs, tool],
  );

  const stored = drafts[toolId];
  const vectorTargeted = tool.target === "vector";
  // §7.6's TARGET must be AREAS, so a point layer is not something the form may
  // OPEN on — its row stays in the select, disabled, for the explanation (§5),
  // but the default falls through to a layer the tool can actually run on. The
  // pools are tried in order and the first non-empty one wins, so a workspace
  // with nothing but point layers still opens on one rather than on a blank
  // select.
  const usable = (list: ReadonlyArray<GeoJsonLayer>) =>
    TARGET_NEEDS_AREAS.has(toolId) ? list.filter(hasAreas) : list;
  const preferred: ReadonlyArray<{ readonly id: string }> = vectorTargeted
    ? usable(eligibleVectorTargets).length > 0
      ? usable(eligibleVectorTargets)
      : eligibleVectorTargets.length > 0
        ? eligibleVectorTargets
        : usable(vectorCandidates).length > 0
          ? usable(vectorCandidates)
          : vectorCandidates
    : eligibleTargets.length > 0
      ? eligibleTargets
      : candidates;
  const activeIsTargetKind =
    active !== null &&
    (vectorTargeted ? active.kind === "geo" : active.kind === "city");
  const defaultTarget =
    activeIsTargetKind && preferred.some((l) => l.id === active.layer.id)
      ? active.layer.id
      : (preferred[0]?.id ?? null);
  const allIds = useMemo(
    () => new Set([...layers.map((l) => l.id), ...geoLayers.map((l) => l.id)]),
    [layers, geoLayers],
  );
  const storedTargetExists =
    stored !== undefined &&
    stored.targetLayerId !== null &&
    allIds.has(stored.targetLayerId);
  const base: ToolDraft =
    stored === undefined
      ? {
          targetLayerId: defaultTarget,
          sourceLayerId: null,
          scope: "all",
          lod: null,
          prefix: tool.defaultPrefix,
          params: {},
          destination: "layer",
          newLayerName: null,
        }
      : storedTargetExists
        ? stored
        : // The stored target is gone, so the form retargets itself — and the
          // LoD it carried was a statement about THAT layer. Dropped here for
          // the same reason `setDraft` drops it on an explicit target change.
          { ...stored, targetLayerId: defaultTarget, lod: null };

  // The TARGET, in whichever store it lives.
  const target: Layer | null = vectorTargeted
    ? null
    : (layers.find((l) => l.id === base.targetLayerId) ?? null);
  const vectorTarget: GeoJsonLayer | null = vectorTargeted
    ? (vectorCandidates.find((l) => l.id === base.targetLayerId) ?? null)
    : null;
  const targetLayerId = vectorTargeted
    ? (vectorTarget?.id ?? null)
    : (target?.id ?? null);
  const targetName = vectorTargeted
    ? (vectorTarget?.name ?? null)
    : (target?.name ?? null);
  const targetOptions: ReadonlyArray<LayerOption> = useMemo(() => {
    // §7.6: a point or line TARGET is listed DISABLED with this reason. The
    // question is only ever asked of a vector layer, so the row builder takes
    // the narrowed one.
    const rowFor = (l: GeoJsonLayer): LayerOption => {
      const refused = TARGET_NEEDS_AREAS.has(toolId) && !hasAreas(l);
      return {
        id: l.id,
        name: l.name,
        disabled: refused,
        reason: refused ? "Needs areas (polygons)" : null,
      };
    };
    const rows: ReadonlyArray<LayerOption> = vectorTargeted
      ? eligibleVectorTargets.map(rowFor)
      : eligibleTargets.map((l) => ({
          id: l.id,
          name: l.name,
          disabled: false,
          reason: null,
        }));
    // §5: "a disabled row still opens the tool view", so a target the user has
    // already chosen stays in the select even when the tool cannot run on it —
    // and it carries the SAME reason its eligible siblings would.
    if (vectorTargeted) {
      return vectorTarget !== null &&
        !rows.some((r) => r.id === vectorTarget.id)
        ? [...rows, rowFor(vectorTarget)]
        : rows;
    }
    return target !== null && !rows.some((r) => r.id === target.id)
      ? [
          ...rows,
          { id: target.id, name: target.name, disabled: false, reason: null },
        ]
      : rows;
  }, [
    vectorTargeted,
    eligibleVectorTargets,
    eligibleTargets,
    toolId,
    vectorTarget,
    target,
  ]);

  // The SOURCE: §7.5/§7.7 want a vector layer, §7.6 a city layer.
  const sourceOptions: ReadonlyArray<LayerOption> = useMemo(() => {
    if (tool.sourceKind === "vector") {
      return vectorCandidates.map((l) => {
        const reason = vectorSourceReason(l, toolId);
        return { id: l.id, name: l.name, disabled: reason !== null, reason };
      });
    }
    if (tool.sourceKind === "city") {
      return candidates.map((l) => ({
        id: l.id,
        name: l.name,
        disabled: false,
        reason: null,
      }));
    }
    return [];
  }, [tool.sourceKind, toolId, vectorCandidates, candidates]);
  const storedSourceValid =
    base.sourceLayerId !== null &&
    sourceOptions.some((o) => o.id === base.sourceLayerId);
  // Residual B6: when EVERY row is disabled the form still opens on one of
  // them, because the row's reason is the only true thing there is to say and
  // a null source would leave Run blocked by an unrelated sentence — or, for
  // §7.7, by nothing at all. `canRun` below refuses a null source outright.
  const sourceLayerId = storedSourceValid
    ? base.sourceLayerId
    : (sourceOptions.find((o) => !o.disabled)?.id ??
      sourceOptions[0]?.id ??
      null);
  const sourceGeo =
    tool.sourceKind === "vector"
      ? (vectorCandidates.find((l) => l.id === sourceLayerId) ?? null)
      : null;
  const sourceDocument = sourceGeo?.config.preparedData;
  const sourceRecords = useMemo(
    () => (sourceDocument === undefined ? [] : geoRecords(sourceDocument)),
    [sourceDocument],
  );
  const sourcePropertyTypes = useMemo(
    () => geoPropertyTypes(sourceRecords),
    [sourceRecords],
  );
  const sourcePropertyKeys = useMemo(
    () => [...sourcePropertyTypes.keys()],
    [sourcePropertyTypes],
  );
  const sourceHasFeatureIds = useMemo(
    () => documentHasFeatureIds(sourceDocument),
    [sourceDocument],
  );

  // The layer whose TABLE, LoD ladder and scope counts the form reads — the
  // same thing the queue calls `computeLayerId`. §7.6: "Scope applies to the
  // SOURCE buildings", so Aggregate's radios count the CITY layer.
  const cityLayer: Layer | null = vectorTargeted
    ? (layers.find((l) => l.id === sourceLayerId) ?? null)
    : target;
  const cityTableState = cityLayer ? tables[cityLayer.id] : undefined;
  const cityTable =
    cityTableState !== undefined && cityTableState.state === "ready"
      ? cityTableState.info
      : null;

  const targetCtx = eligibilityContextFor(
    vectorTargeted
      ? vectorTarget
        ? { kind: "geo", layer: vectorTarget }
        : null
      : target
        ? { kind: "city", layer: target }
        : null,
    inputs,
  );
  const eligibility = toolEligibility(tool, targetCtx);
  // §6, the same rule that keeps an UNIMPLEMENTED tool silent: a tool that is
  // refused on this target (no reader, a streaming or CityParquet source, a
  // failed engine) has no source of truthful counts either, and a select
  // reading "No solid geometry in this layer" beside "this layer was loaded
  // from a streaming FlatCityBuf" is a verdict on data the app never inspected.
  // §5's row reason is the only true sentence there is, so the form shows no
  // LoD control at all.
  //
  // The hook is called unconditionally, as a hook must be, and its answer is
  // dropped here rather than inside it: eligibility is the FORM's question, not
  // the geometry source's.
  const lodAnswer = useLodOptions(tool, target);
  const lods = eligibility.ok ? lodAnswer : NO_LOD;
  // Spec §6: "Default: the layer's selected LoD when it qualifies, else the
  // highest qualifying one." Computed, never written: a `setDraft` from a
  // render is a side effect, and the stored draft is the USER's choice — one
  // that stops qualifying (a streaming commit took the rung away) must not be
  // overwritten in the store, only overridden here.
  const qualifies = (lod: string | null): boolean =>
    lod !== null && lods.options.some((o) => o.lod === lod);
  const defaultLod = qualifies(target?.selectedLod ?? null)
    ? (target?.selectedLod ?? null)
    : (lods.options[0]?.lod ?? null);
  const lod = qualifies(base.lod) ? base.lod : defaultLod;
  // §7.5 and §7.7: "OUTPUT prefix defaults to the source layer name slugified
  // (`zones_`)" — `roads_distance_m`, `zones_matches_n`. It depends on the
  // SOURCE, which is resolved just above, so it is derived here rather than
  // stored: a stored default would freeze against a later source change, and
  // `setDraft` below keeps the RAW prefix for that reason. A slug §6's own
  // prefix rule would reject (one starting with a digit) falls back to the
  // tool's default rather than opening the form on an invalid value.
  const sourceName =
    sourceOptions.find((o) => o.id === sourceLayerId)?.name ?? null;
  const slug = sourceName === null ? null : `${slugifyField(sourceName)}_`;
  const sourcePrefix =
    tool.sourceKind === "vector" && slug !== null && PREFIX_RE.test(slug)
      ? slug
      : tool.defaultPrefix;
  // Applied only to a draft still on the tool's own default, never over a
  // prefix the user typed. (Clearing the field therefore re-offers the source's
  // prefix, which is what the form opened with.)
  const prefix =
    base.prefix === tool.defaultPrefix ? sourcePrefix : base.prefix;
  const draft: ToolDraft = { ...base, sourceLayerId, lod, prefix };

  const counts = useLayerCounts(cityLayer?.id ?? null);
  // `useLayerCounts` answers the ALL count for `matching` when nothing is
  // filtered (its SQL has no WHERE), so "no filter applied" has to come from
  // the query store itself rather than from a null count.
  const noFilter = useQueryStore((s) =>
    cityLayer === null ? true : layerQuery(s, cityLayer.id).applied === null,
  );

  // §7.5's defaults need the SOURCE's keys and the TARGET's table, so they are
  // resolved here rather than written into the store from a render.
  const crossCtx: CrossLayerContext = {
    table: cityTable,
    sourcePropertyKeys,
    sourcePropertyTypes,
    sourceHasFeatureIds,
    numericColumns: numericColumnsOf(cityTable),
  };
  const crossLayer = tool.group === "cross-layer";
  const params = crossLayer
    ? resolveCrossLayerParams(toolId, draft.params, crossCtx)
    : draft.params;
  // The registry's own builder (spec §6 prints the resolved column list before
  // Run); a tool whose executor has not shipped promises NOTHING — the global
  // constraint, and the reason the guard is here rather than on the definition:
  // the three cross-layer entries carry their column builders from Task 15 so
  // Tasks 16/17/19 have nothing to wire, and an unshipped one must not print a
  // list of columns no run can write. TWO arguments (Decisions item 6 (iii)):
  // for Join the copied fields' types are already inside `params`, put there by
  // `resolveCrossLayerParams`.
  const columns = tool.implemented
    ? (tool.outputColumns?.(draft.prefix, params) ?? [])
    : [];

  // §6's "belongs to the source data" is about the TARGET's own attributes: a
  // city layer's table columns, a vector layer's public property keys.
  const targetDocument = vectorTarget?.config.preparedData;
  const existingNames = useMemo(
    () =>
      targetDocument === undefined
        ? []
        : [
            ...new Set(
              geoRecords(targetDocument).flatMap((r) => Object.keys(r)),
            ),
          ],
    [targetDocument],
  );
  const targetColumns = vectorTargeted
    ? existingNames
    : cityTable !== null && target !== null
      ? cityTable.columns.map((c) => c.name)
      : [];
  const computed =
    targetLayerId === null
      ? new Set<string>()
      : computedColumnsOf(targetLayerId);
  // DuckDB identifiers are CASE-INSENSITIVE, so "EXTENT_height_m" and
  // "extent_height_m" are one column: a case-sensitive check here would let a
  // prefix the user typed in capitals overwrite the file's own data. The map
  // keeps the target's spelling, which is the one the error names — it is the
  // column that belongs to the source data.
  const onTable = new Map(
    targetColumns.map((name) => [name.toLowerCase(), name]),
  );
  const computedLower = new Set([...computed].map((c) => c.toLowerCase()));
  const existing = columns.filter((c) => onTable.has(c.name.toLowerCase()));
  const sourceCollisions = existing
    .filter((c) => !computedLower.has(c.name.toLowerCase()))
    .map((c) => onTable.get(c.name.toLowerCase()) ?? c.name);
  const prefixError = !PREFIX_RE.test(draft.prefix)
    ? "Use letters, digits and underscores, starting with a letter"
    : sourceCollisions.length > 0
      ? `'${sourceCollisions[0]}' belongs to the source data; choose another prefix`
      : null;
  // Spec §6: "Validation is inline and blocks Run" — the message comes from the
  // tool's own definition, so the rule and the columns it governs live together.
  // A cross-layer tool re-asks with the real SOURCE, which is the only context
  // that can decide §7.7's "Choose the property to copy"; the registry's own
  // `validateParams` answers the same question from the bag alone.
  const paramsError = crossLayer
    ? crossLayerParamsError(toolId, params, crossCtx)
    : (tool.validateParams?.(draft.params) ?? null);
  // §6's prefill, "<target> · <tool noun>". It reads `targetName`, not
  // `target.name`: a VECTOR-target tool has `target === null` by construction
  // (§7.6 writes to the geo layer), and Aggregate must still prefill
  // "Zones · buildings". Two of the seven names contain the SOURCE layer's
  // name; `sourceName` above is already the chosen row's, from whichever store
  // holds it.
  const prefilledName =
    targetName === null ? "" : derivedLayerName(targetName, toolId, sourceName);
  const newLayerName = draft.newLayerName ?? prefilledName;
  // Only for the destination it is about: a name left invalid under "This
  // layer" must not disable Run for a run that creates no layer at all.
  const nameError =
    draft.destination !== "new"
      ? null
      : newLayerName.trim() === ""
        ? NAME_EMPTY
        : nameTaken(newLayerName, layers, geoLayers)
          ? NAME_TAKEN
          : null;
  // §6's A2 case, as a REFUSAL and not only a disabled radio: the draft keeps
  // `destination: "new"` across a retarget, so a form that only greyed the
  // control would still offer Run for a destination it has just declared
  // impossible. Same constant as the radio's title and the head's pre-flight.
  // Only a CITY target can be streaming, and `target` is exactly that layer.
  const newLayerBlocked =
    tool.destinations.includes("new") && target?.isStreaming === true;
  const destinationReason =
    draft.destination === "new" && newLayerBlocked
      ? STREAMING_NO_NEW_LAYER
      : null;
  // §6: the replace warning is SCOPED TO THE COPY for a New-layer run — "2
  // inherited computed columns will be replaced in the new layer". The
  // non-computed collisions are already the prefix error (`sourceCollisions`),
  // so what is left of `existing` is exactly the inherited computed columns.
  const inherited = existing.filter((c) =>
    computedLower.has(c.name.toLowerCase()),
  );
  // §6: "Extension note when the tool's extension is not yet loaded."
  const ext = tool.extension;
  const extensionNote =
    ext !== null && targetCtx.extensionState[ext] !== "loaded"
      ? `Loads the ${ext} extension on first run (about ${ext === "spatial" ? "24 MB" : "1 MB"}, once per session).`
      : null;
  // §6's workload note, decided by `toolWorkloadNote` above. The table is the
  // CITY one: the note is about the layer whose SOURCE the run re-reads, which
  // for §7.6 is the city SOURCE and not the vector target.
  const workloadNote = toolWorkloadNote(tool, cityTable, params);
  // §7.6: an empty TARGET disables Run with its own sentence; §7.5/§7.7: an
  // empty SOURCE with theirs.
  const targetReason =
    vectorTargeted && vectorTarget !== null && !hasAreas(vectorTarget)
      ? "The layer has no areas"
      : null;
  // §5's rule is that Run repeats the chosen row's own reason, and
  // `vectorSourceReason` has already asked the questions in the spec's order
  // (still loading / could not be loaded / no features / needs areas), so there
  // is exactly one producer of each sentence.
  const sourceReason =
    sourceOptions.find((o) => o.id === sourceLayerId)?.reason ?? null;

  const scopeCount =
    draft.scope === "all"
      ? counts.all
      : draft.scope === "matching"
        ? counts.matching
        : counts.selected;
  const scopeReason =
    draft.scope === "matching" && noFilter
      ? "No filter applied"
      : draft.scope === "selected" && !(counts.selected && counts.selected > 0)
        ? "Nothing selected on this layer"
        : scopeCount === 0
          ? "Nothing to run on (0 buildings)"
          : null;
  // Precedence, top to bottom: what the TOOL cannot do here (eligibility), what
  // the TARGET and the SOURCE cannot offer, then the things the user can fix in
  // the form — the prefix, the parameters, OUTPUT's destination and name, the
  // scope. `destinationReason` comes before `nameError`: when the destination
  // itself is impossible, what the user typed in Name is not the thing to
  // complain about.
  const runReason = !eligibility.ok
    ? eligibility.reason
    : (lods.emptyReason ??
      targetReason ??
      sourceReason ??
      prefixError ??
      paramsError ??
      destinationReason ??
      nameError ??
      scopeReason);
  const latestRun =
    runs.find(
      (r) => r.toolId === toolId && r.targetLayerId === targetLayerId,
    ) ?? null;
  // At most one run executes at a time (spec §6.1), so "the running one" is a
  // single record — and the footer names its TOOL, not the run.
  const running =
    runs.find((r) => r.status === "running" || r.status === "cancelling") ??
    null;
  const queuedBehind =
    running !== null && running.id !== latestRun?.id
      ? toolById(running.toolId).name
      : null;
  return {
    tool,
    draft,
    params,
    eligibleTargets,
    target,
    vectorTarget,
    targetLayerId,
    targetName,
    targetOptions,
    sourceOptions,
    sourceLayerId,
    sourceReason,
    sourcePropertyKeys,
    sourcePropertyTypes,
    sourceHasFeatureIds,
    cityLayer,
    cityTable,
    proxies: cityTable === null ? [] : proxyOptions(cityTable),
    numericColumns: crossCtx.numericColumns,
    lodOptions: lods.options,
    lodNoun: lods.noun,
    lodReason: lods.emptyReason,
    counts,
    noFilter,
    columns,
    existing,
    inherited,
    newLayerName,
    nameError,
    // §6's A2 case: the tool offers the destination, this target cannot take
    // it (Design decision (f) — a streaming parent has no geometry to copy).
    // Computed above, because `runReason` needs it too.
    newLayerBlocked,
    destinationReason,
    prefixError,
    paramsError,
    extensionNote,
    workloadNote,
    eligibility,
    // Residual B6: a cross-layer run with no source is not runnable, whatever
    // else the form says — §7.7 would otherwise expose Run with nothing to
    // measure against.
    canRun:
      runReason === null &&
      targetLayerId !== null &&
      (tool.sourceKind === null || sourceLayerId !== null),
    runReason,
    latestRun,
    queuedBehind,
    setDraft: (patch: Partial<ToolDraft>) => {
      // A LoD is a statement about ONE layer (§6's default is read off the
      // target), so changing the target drops it and the default rule above
      // re-applies on the next render. The patch is spread LAST, so a caller
      // that changes both at once still gets what it asked for.
      //
      // A CROSS-LAYER bag is a statement about the two layers as well — which
      // of the SOURCE's fields to copy, which of its properties to write, which
      // proxy the TARGET can offer — so changing either drops it. A one-layer
      // tool's parameters name neither: Roof metrics' measures and threshold
      // and Measure solids' measures are what the user wants WRITTEN, and they
      // survived a retarget before the form learned about a second layer.
      const retarget =
        patch.targetLayerId !== undefined &&
        patch.targetLayerId !== draft.targetLayerId;
      const resource =
        patch.sourceLayerId !== undefined &&
        patch.sourceLayerId !== draft.sourceLayerId;
      const dropParams = crossLayer && (retarget || resource);
      // THE DRAFT KEEPS THE USER'S OWN PROXY; only the RESOLVED bag carries the
      // one `centre within` forced (§7.5). The section renders the resolved bag
      // and writes it back WHOLE, so a change to anything else — the predicate,
      // a field — would otherwise carry the forced centre into the draft and
      // overwrite the footprint the user picked: switching the predicate back
      // to `within` would then run on a centre nobody chose. The preference is
      // restored whenever the write-back did not change the proxy itself, which
      // is exactly "the user changed something else".
      const keepsProxy =
        crossLayer &&
        !dropParams &&
        patch.params !== undefined &&
        patch.params["proxy"] === params["proxy"] &&
        draft.params["proxy"] !== undefined;
      const patched: Partial<ToolDraft> = keepsProxy
        ? {
            ...patch,
            params: { ...patch.params, proxy: draft.params["proxy"] },
          }
        : patch;
      useProcessingStore.getState().setDraft(toolId, {
        ...draft,
        // The DERIVED prefix is never stored: it is a function of the source,
        // and storing it would freeze it against the next source change. What
        // is stored is the RAW prefix — the tool's default until the user types
        // one.
        prefix: base.prefix,
        ...(retarget ? { lod: null } : {}),
        ...(dropParams ? { params: {} } : {}),
        ...patched,
      });
    },
  };
}
