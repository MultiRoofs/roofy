/**
 * Everything spec §6's form needs about ONE tool, gathered from the stores.
 *
 * It lives beside the view rather than under `features/` because it is a hook
 * over four UI-side stores (the layer tables, the counts hook, the computed
 * column registry and the query store) — the pure parts it leans on
 * (`toolEligibility`, `toolById`) are already engine-free and tested there.
 *
 * The draft is stored per tool for the session (spec §6), so the form is
 * restored on the way back from the catalogue; a stored draft naming a layer
 * that has since gone falls back to the default target rather than rendering an
 * empty select.
 */
import { useMemo } from "react";
import { useLayerStore } from "../../features/layers/layerStore";
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
import { toolEligibility } from "../../features/processing/eligibility";
import { sourceWorkloadNote } from "../../features/processing/sourceRead";
import type { ToolId } from "../../features/processing/types";
import {
  eligibilityContextFor,
  useEligibilityInputs,
} from "./useEligibilityContext";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { useLodOptions } from "./useLodOptions";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";

/** An EMPTY prefix is a legal prefix — it is how the bare column names are
 *  asked for, and the collision check below is what refuses it when they are
 *  already the source's. */
const PREFIX_RE = /^(?:[a-z][a-z0-9_]*)?$/i;

export function useToolForm(toolId: ToolId) {
  const tool = toolById(toolId);
  const active = useActiveLayer();
  const layers = useLayerStore((s) => s.layers);
  const { tables, hasVectorLayer, status } = useEligibilityInputs();
  const drafts = useProcessingStore((s) => s.drafts);
  const runs = useProcessingStore((s) => s.runs);
  useComputedColumnStore((s) => s.byLayer); // subscribe: the replace warning depends on it
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
            eligibilityContextFor(
              { kind: "city", layer: l },
              tables,
              hasVectorLayer,
              status,
            ),
          ).ok,
      ),
    [candidates, tables, hasVectorLayer, status, tool],
  );
  const stored = drafts[toolId];
  const preferred = eligibleTargets.length > 0 ? eligibleTargets : candidates;
  const defaultTarget =
    active?.kind === "city" && preferred.some((l) => l.id === active.layer.id)
      ? active.layer.id
      : (preferred[0]?.id ?? null);
  const storedTargetExists =
    stored !== undefined && layers.some((l) => l.id === stored.targetLayerId);
  const base: ToolDraft =
    stored === undefined
      ? {
          targetLayerId: defaultTarget,
          scope: "all",
          lod: null,
          prefix: tool.defaultPrefix,
          params: {},
        }
      : storedTargetExists
        ? stored
        : // The stored target is gone, so the form retargets itself — and the
          // LoD it carried was a statement about THAT layer. Dropped here for
          // the same reason `setDraft` drops it on an explicit target change.
          { ...stored, targetLayerId: defaultTarget, lod: null };
  const target = layers.find((l) => l.id === base.targetLayerId) ?? null;
  const lods = useLodOptions(tool, target);
  // Spec §6: "Default: the layer's selected LoD when it qualifies, else the
  // highest qualifying one." Computed, never written: a `setDraft` from a
  // render is a side effect, and the stored draft is the USER's choice — one
  // that stops qualifying (a streaming commit took the rung away) must not be
  // overwritten in the store, only overridden here.
  //
  // `base.lod`, not `stored.lod`: the draft whose target was just replaced has
  // already dropped its LoD above, and reading the raw stored value here would
  // hand it straight back.
  const qualifies = (lod: string | null): boolean =>
    lod !== null && lods.options.some((o) => o.lod === lod);
  const defaultLod = qualifies(target?.selectedLod ?? null)
    ? (target?.selectedLod ?? null)
    : (lods.options[0]?.lod ?? null);
  const lod = qualifies(base.lod) ? base.lod : defaultLod;
  const draft: ToolDraft = { ...base, lod };
  const counts = useLayerCounts(target?.id ?? null);
  // `useLayerCounts` answers the ALL count for `matching` when nothing is
  // filtered (its SQL has no WHERE), so "no filter applied" has to come from
  // the query store itself rather than from a null count.
  const noFilter = useQueryStore((s) =>
    target === null ? true : layerQuery(s, target.id).applied === null,
  );
  const targetCtx = eligibilityContextFor(
    target ? { kind: "city", layer: target } : null,
    tables,
    hasVectorLayer,
    status,
  );
  const eligibility = toolEligibility(tool, targetCtx);
  // The registry's own builder (spec §6 prints the resolved column list before
  // Run); a tool whose executor has not shipped promises nothing.
  const columns = tool.outputColumns?.(draft.prefix, draft.params) ?? [];
  const tableInfo =
    target && tables[target.id]?.state === "ready" ? tables[target.id] : null;
  const tableColumns =
    tableInfo && tableInfo.state === "ready"
      ? tableInfo.info.columns.map((c) => c.name)
      : [];
  const computed = target ? computedColumnsOf(target.id) : new Set<string>();
  // DuckDB identifiers are CASE-INSENSITIVE, so "EXTENT_height_m" and
  // "extent_height_m" are one column: a case-sensitive check here would let a
  // prefix the user typed in capitals overwrite the file's own data. The map
  // keeps the table's spelling, which is the one the error names — it is the
  // column that belongs to the source.
  const onTable = new Map(
    tableColumns.map((name) => [name.toLowerCase(), name]),
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
  const paramsError = tool.validateParams?.(draft.params) ?? null;
  // §6: "Extension note when the tool's extension is not yet loaded."
  const ext = tool.extension;
  const extensionNote =
    ext !== null && targetCtx.extensionState[ext] !== "loaded"
      ? `Loads the ${ext} extension on first run (about ${ext === "spatial" ? "24 MB" : "1 MB"}, once per session).`
      : null;
  // §6: "a workload note when the target's source is large". Only for a tool
  // that RE-READS the source — a tool computing from the table or the model
  // pays none of this cost, and a warning about a read that will not happen is
  // a false alarm.
  //
  // `tableInfo?.state`, not `tableInfo !== null`: `tableInfo` is
  // `tables[target.id]` under an indexed lookup, so its type carries
  // `undefined` as well as `null` and the line above it uses the same truthy
  // shape.
  const workloadNote =
    tool.needsReader && tableInfo?.state === "ready"
      ? sourceWorkloadNote(tableInfo.info)
      : null;
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
  // Precedence, top to bottom: what the TOOL cannot do here (eligibility),
  // what the TARGET cannot offer (no qualifying LoD), then the things the user
  // can fix in the form — the prefix, the parameters, the scope.
  const runReason = !eligibility.ok
    ? eligibility.reason
    : (lods.emptyReason ?? prefixError ?? paramsError ?? scopeReason);
  const latestRun =
    runs.find((r) => r.toolId === toolId && r.targetLayerId === target?.id) ??
    null;
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
    eligibleTargets,
    target,
    lodOptions: lods.options,
    lodNoun: lods.noun,
    lodReason: lods.emptyReason,
    counts,
    noFilter,
    columns,
    existing,
    prefixError,
    paramsError,
    extensionNote,
    workloadNote,
    eligibility,
    canRun: runReason === null && target !== null,
    runReason,
    latestRun,
    queuedBehind,
    setDraft: (patch: Partial<ToolDraft>) => {
      // A LoD is a statement about ONE layer (§6's default is read off the
      // target), so changing the target drops it and the default rule above
      // re-applies on the next render. The patch is spread LAST, so a caller
      // that changes both at once still gets the LoD it asked for.
      const retarget =
        patch.targetLayerId !== undefined &&
        patch.targetLayerId !== draft.targetLayerId;
      useProcessingStore.getState().setDraft(toolId, {
        ...draft,
        ...(retarget ? { lod: null } : {}),
        ...patch,
      });
    },
  };
}
