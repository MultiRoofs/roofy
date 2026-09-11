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
import type { ToolId } from "../../features/processing/types";
import {
  eligibilityContextFor,
  useEligibilityInputs,
} from "./useEligibilityContext";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import type { RunRecord } from "../../features/processing/types";
import type { RunRequest } from "../../features/processing/runQueue";

/** An EMPTY prefix is a legal prefix — it is how the bare column names are
 *  asked for, and the collision check below is what refuses it when they are
 *  already the source's. */
const PREFIX_RE = /^(?:[a-z][a-z0-9_]*)?$/i;

/** Every output column of every M1 tool is DOUBLE (spec §7). */
function asColumns(names: ReadonlyArray<string>): RunRequest["columns"] {
  return names.map((name) => ({ name, type: "DOUBLE" as const }));
}

/**
 * The request a Retry / Re-run repeats (spec §6.3: "the same parameters").
 *
 * The columns are re-derived from the tool's own map rather than read off the
 * record, so a record written by an older session still gets the names this
 * build would write; `run.columns` is the fallback for a tool the map does not
 * know.
 */
export function requestFromRun(run: RunRecord): RunRequest {
  const names =
    toolById(run.toolId).outputColumns?.(run.prefix, run.params) ?? run.columns;
  return {
    toolId: run.toolId,
    targetLayerId: run.targetLayerId,
    scope: run.scope,
    lod: run.lod,
    params: run.params,
    prefix: run.prefix,
    columns: asColumns(names),
  };
}

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
  const draft: ToolDraft =
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
        : { ...stored, targetLayerId: defaultTarget };
  const target = layers.find((l) => l.id === draft.targetLayerId) ?? null;
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
  const existing = columns.filter((c) => tableColumns.includes(c));
  const sourceCollisions = existing.filter((c) => !computed.has(c));
  const prefixError = !PREFIX_RE.test(draft.prefix)
    ? "Use letters, digits and underscores, starting with a letter"
    : sourceCollisions.length > 0
      ? `'${sourceCollisions[0]}' belongs to the source data; choose another prefix`
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
  const runReason = !eligibility.ok
    ? eligibility.reason
    : (prefixError ?? scopeReason);
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
    counts,
    noFilter,
    columns,
    existing,
    prefixError,
    eligibility,
    canRun: runReason === null && target !== null,
    runReason,
    latestRun,
    queuedBehind,
    setDraft: (patch: Partial<ToolDraft>) =>
      useProcessingStore.getState().setDraft(toolId, { ...draft, ...patch }),
  };
}
