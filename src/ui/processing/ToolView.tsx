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
  // §6.2's "Run again unlocks the form with the same values": it DISMISSES the
  // card for that run rather than submitting anything. The dismissal lives in
  // the store, so it survives leaving the tool view and Recent runs' "Edit &
  // run" can clear the card of the run it opens the form on.
  //
  // A dismissal only ever hides a DONE card. A queued, running or cancelling
  // run keeps its footer and its lock whatever is in the dismissed list: §6.1's
  // progress block and Cancel are the only way to reach a run in flight, and
  // Run must not come back while one is still going.
  const dismissed = useProcessingStore((s) => s.dismissedRunIds);
  const latestRun =
    f.latestRun !== null &&
    f.latestRun.status === "done" &&
    dismissed.includes(f.latestRun.id)
      ? null
      : f.latestRun;
  // The form locks while the run is in flight (§6.1) AND while its result card
  // stands in for the footer (§6.2). A FAILED card does not lock: §6.3 offers
  // Retry and Log only, and Retry repeats the FROZEN request, so the user is
  // free to edit the draft and run it afresh.
  const locked =
    latestRun !== null &&
    (latestRun.status === "running" ||
      latestRun.status === "queued" ||
      latestRun.status === "cancelling" ||
      latestRun.status === "done");
  // Spec §6 puts Run's reason under the button; the prefix error is the one
  // reason that is ALREADY on screen, inline under the field it belongs to, and
  // printing the same sentence twice reads as two problems.
  const footerReason =
    f.runReason !== null && f.runReason === f.prefixError ? null : f.runReason;
  // Precedence, explicit: while THIS form's run waits in the queue, the queue
  // note is the only thing the footer says — a reason left over from the draft
  // would read as "and it will fail too". The note never appears before the run
  // is queued: another tool executing leaves Run enabled and silent (§6.1).
  const queueNote =
    latestRun?.status === "queued" && f.queuedBehind !== null
      ? `Queued behind ${f.queuedBehind}`
      : null;
  // A ternary, not `??`: a run can be queued with nothing running yet (the
  // hand-off between one run finishing and the next starting), and that footer
  // must still say "Queued" rather than fall through to the draft's reason.
  const footerNote = latestRun?.status === "queued" ? queueNote : footerReason;
  // §5: "A disabled row still opens the tool view", so a target the user has
  // already chosen stays in the select even when the tool cannot run on it —
  // a blank select would hide which layer the reason under Run is about.
  const chosen = f.target;
  const targetOptions =
    chosen !== null && !f.eligibleTargets.some((l) => l.id === chosen.id)
      ? [...f.eligibleTargets, chosen]
      : f.eligibleTargets;
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
            {targetOptions.map((l) => (
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
        {/* §6: OUTPUT "starts with the destination, Write to". Its second
            radio, New layer, is a later milestone — so the one destination
            there is shows as a checked, disabled radio rather than as nothing
            at all: where the columns land is part of reading the form, and an
            invisible answer is one the user has to assume. */}
        <div className="processing-field">
          <span>Write to</span>
          <div
            className="processing-radios"
            role="radiogroup"
            aria-label="Write to"
          >
            <label>
              {/* `readOnly` beside `checked`: the radio can never change (it is
                  the only destination), and React asks for one or the other. */}
              <input type="radio" name="writeTo" checked readOnly disabled />
              This layer{f.target === null ? "" : ` (${f.target.name})`}
            </label>
          </div>
        </div>
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
        run={latestRun}
        canRun={f.canRun}
        reason={footerNote}
        onRunAgain={() => {
          if (latestRun !== null) {
            useProcessingStore.getState().dismissRun(latestRun.id);
          }
        }}
      />
    </form>
  );
}
