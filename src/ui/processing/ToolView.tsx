/**
 * Spec §6's parameter form for one tool.
 *
 * A `<form>`, so Enter in a field runs it when valid, and two `<fieldset>`s, so
 * "the form locks while the run executes" is one attribute rather than a
 * `disabled` on every control. The footer is a separate component because its
 * four states replace each other in the same place (§6.1–§6.3).
 */
import { useProcessingStore } from "../../features/processing/processingStore";
import { submitRun } from "../../features/processing/runQueue";
import type { ToolId } from "../../features/processing/types";
import { useToolForm } from "./useToolForm";
import { RunFooter } from "./RunFooter";
import { plural } from "./runFormat";

/** An unknown count is still loading, so it reads as pending, never as zero. */
const fmt = (n: number | null) =>
  n === null ? "…" : n.toLocaleString("en-US");

export function ToolView({ toolId }: { readonly toolId: ToolId }) {
  const f = useToolForm(toolId);
  const locked =
    f.latestRun !== null &&
    (f.latestRun.status === "running" ||
      f.latestRun.status === "queued" ||
      f.latestRun.status === "cancelling");
  // Spec §6 puts Run's reason under the button; the prefix error is the one
  // reason that is ALREADY on screen, inline under the field it belongs to, and
  // printing the same sentence twice reads as two problems.
  const footerReason =
    f.runReason !== null && f.runReason === f.prefixError ? null : f.runReason;
  const run = () => {
    if (!f.target || !f.canRun) return;
    submitRun({
      toolId,
      targetLayerId: f.target.id,
      scope: f.draft.scope,
      lod: f.draft.lod,
      params: f.draft.params,
      prefix: f.draft.prefix,
      columns: f.columns.map((name) => ({ name, type: "DOUBLE" as const })),
    });
  };
  return (
    <form
      className="processing-tool"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <div className="processing-tool__head">
        <button
          type="button"
          className="processing-back"
          aria-label="Back to tools"
          onClick={() => useProcessingStore.getState().back()}
        >
          ‹
        </button>
        <h2 className="processing-tool__title">{f.tool.name}</h2>
        {f.tool.extension !== null && (
          <span className="processing-chip">
            {f.tool.extension === "spatial" ? "Spatial" : "3D"}
          </span>
        )}
      </div>
      <p className="processing-tool__desc">{f.tool.longDescription}</p>
      <fieldset className="processing-section" disabled={locked}>
        <legend className="processing-group__label">TARGET</legend>
        <label className="processing-field">
          <span>Layer</span>
          <select
            aria-label="Layer"
            value={f.target?.id ?? ""}
            onChange={(e) => f.setDraft({ targetLayerId: e.target.value })}
          >
            {f.eligibleTargets.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="processing-field">
          <span>Scope</span>
          <div
            className="processing-radios"
            role="radiogroup"
            aria-label="Scope"
          >
            <label>
              <input
                type="radio"
                name="scope"
                checked={f.draft.scope === "all"}
                onChange={() => f.setDraft({ scope: "all" })}
              />
              {f.counts.all === null
                ? "All … buildings"
                : `All ${plural(f.counts.all, "building", "buildings")}`}
            </label>
            <label title={f.noFilter ? "No filter applied" : undefined}>
              <input
                type="radio"
                name="scope"
                disabled={f.noFilter}
                checked={f.draft.scope === "matching"}
                onChange={() => f.setDraft({ scope: "matching" })}
              />
              {/* With no filter the count would be the ALL count, which means
                  nothing here — so the disabled radio carries no number. */}
              {f.noFilter ? "Matching" : `Matching ${fmt(f.counts.matching)}`}
            </label>
            <label
              title={
                !f.counts.selected
                  ? "Nothing selected on this layer"
                  : undefined
              }
            >
              <input
                type="radio"
                name="scope"
                disabled={!f.counts.selected}
                checked={f.draft.scope === "selected"}
                onChange={() => f.setDraft({ scope: "selected" })}
              />
              Selected {fmt(f.counts.selected)}
            </label>
          </div>
          {f.target?.isStreaming === true && (
            <p className="processing-note">
              Runs over the {fmt(f.counts.all)} currently loaded buildings, not
              the whole dataset.
            </p>
          )}
        </div>
      </fieldset>
      <fieldset className="processing-section" disabled={locked}>
        <legend className="processing-group__label">OUTPUT</legend>
        <label className="processing-field">
          <span>Prefix</span>
          <input
            type="text"
            aria-label="Prefix"
            value={f.draft.prefix}
            onChange={(e) => f.setDraft({ prefix: e.target.value })}
            aria-invalid={f.prefixError !== null}
          />
        </label>
        {f.prefixError !== null && (
          <p className="processing-error" role="alert">
            {f.prefixError}
          </p>
        )}
        <p className="processing-note">Columns:</p>
        <p className="processing-columns">{f.columns.join(", ")}</p>
        {f.existing.length > 0 && f.prefixError === null && (
          <p className="processing-warning">
            <span aria-hidden="true">⚠ </span>
            <span>
              {f.existing.length} of these columns exist; they will be replaced.
            </span>
          </p>
        )}
      </fieldset>
      <RunFooter
        run={f.latestRun}
        canRun={f.canRun}
        reason={
          footerReason ??
          (f.queuedBehind === null ? null : `Queued behind ${f.queuedBehind}`)
        }
        onRun={run}
      />
    </form>
  );
}
