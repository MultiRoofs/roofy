/**
 * Spec §6's parameter form for one tool.
 *
 * A `<form>`, so Enter in a field runs it when valid, and two `<fieldset>`s, so
 * "the form locks while the run executes" is one attribute rather than a
 * `disabled` on every control. The footer is a separate component because its
 * four states replace each other in the same place (§6.1–§6.3).
 */
import { useProcessingStore } from "../../features/processing/processingStore";
import { STREAMING_NO_NEW_LAYER } from "../../features/processing/deriveLayer";
import { submitRun } from "../../features/processing/runQueue";
import type { ToolId } from "../../features/processing/types";
import { useToolForm } from "./useToolForm";
import { CrossLayerParams } from "./CrossLayerParams";
import { RoofMetricsParams } from "./RoofMetricsParams";
import { SolidParams } from "./SolidParams";
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
  // A dismissal only ever hides a FINISHED card — done or failed (§6.3's
  // footer offers Retry and Log, so dismissing it is the only way back to Run).
  // A queued, running or cancelling run keeps its footer and its lock whatever
  // is in the dismissed list: §6.1's progress block and Cancel are the only way
  // to reach a run in flight, and Run must not come back while one is going.
  const dismissed = useProcessingStore((s) => s.dismissedRunIds);
  const latestRun =
    f.latestRun !== null &&
    (f.latestRun.status === "done" || f.latestRun.status === "failed") &&
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
  // Spec §6 puts Run's reason under the button; the prefix, parameter, name and
  // destination reasons are the ones that are ALREADY on screen — §6's
  // "validation is inline", each under the field it belongs to (the name error
  // in the Name field's own `role="alert"`, the destination reason in the note
  // under the radios) — and printing the same sentence twice reads as two
  // problems. Run is still disabled; only the echo is dropped.
  const footerReason =
    f.runReason !== null &&
    (f.runReason === f.prefixError ||
      f.runReason === f.paramsError ||
      f.runReason === f.nameError ||
      f.runReason === f.destinationReason)
      ? null
      : f.runReason;
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
  const run = () => {
    if (f.targetLayerId === null || !f.canRun) return;
    submitRun({
      toolId,
      targetLayerId: f.targetLayerId,
      sourceLayerId: f.sourceLayerId,
      scope: f.draft.scope,
      lod: f.draft.lod,
      // §6.1 freezes "everything the run needs" and §6.4 makes the log the
      // reproducible record of it, so what is frozen is the RESOLVED bag — an
      // untouched draft is `{}`, and a log reading "Parameters: —" for a run
      // that used six measures and a 5° threshold records nothing. For a
      // cross-layer tool that includes the building-geometry proxy the form
      // SHOWED: `normaliseParams` re-resolves an already-resolved bag and is
      // idempotent over it by construction.
      params: f.tool.normaliseParams?.(f.params) ?? f.params,
      prefix: f.draft.prefix,
      destination: f.draft.destination,
      // NULL for "This layer", never the prefill: the frozen request is the
      // reproducible record (§6.4), and a name on a run that created no layer
      // would read as one that did.
      newLayerName: f.draft.destination === "new" ? f.newLayerName : null,
      // The registry's own answer, types and all — §7 puts a column's type
      // beside its name, and the write path reads `col.type` straight out of
      // this list. There is no second place that decides a type.
      columns: f.columns,
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
            value={f.targetLayerId ?? ""}
            onChange={(e) => f.setDraft({ targetLayerId: e.target.value })}
          >
            {f.targetOptions.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={option.disabled}
                title={option.reason ?? undefined}
              >
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {/* §6's TARGET section carries the SOURCE select for a cross-layer
            tool; a disabled row keeps §5's reason as its tooltip, and Run
            repeats it under the button. */}
        {f.tool.sourceKind !== null && (
          <label className="processing-field">
            <span>Source</span>
            <select
              aria-label="Source"
              value={f.sourceLayerId ?? ""}
              onChange={(e) => f.setDraft({ sourceLayerId: e.target.value })}
            >
              {f.sourceOptions.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={option.disabled}
                  title={option.reason ?? undefined}
                >
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* §6's LoD select — and `f.eligibility.ok`, because a tool this layer
            refuses states nothing about the layer's geometry: the empty select
            would read "No solid geometry in this layer" beside a footer saying
            the source cannot be read at all. `useToolForm` empties the answer
            for the same reason; this is what keeps the CONTROL off the form. */}
        {f.tool.needsLod && f.tool.implemented && f.eligibility.ok && (
          <label className="processing-field">
            <span>LoD</span>
            {f.lodOptions.length === 0 ? (
              // §6: "When no LoD qualifies the select shows [the empty text]
              // and Run is disabled with that reason." A disabled select with
              // one unselectable option, not a hidden field: the user has to
              // see WHICH requirement this layer fails.
              <select aria-label="LoD" disabled value="">
                <option value="">{f.lodReason}</option>
              </select>
            ) : (
              <select
                aria-label="LoD"
                value={f.draft.lod ?? ""}
                onChange={(e) => f.setDraft({ lod: e.target.value })}
              >
                {f.lodOptions.map((option) => (
                  <option key={option.lod} value={option.lod}>
                    {`${option.lod} (${plural(option.features, "building", "buildings")} ${f.lodNoun})`}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
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
          {f.cityLayer?.isStreaming === true && (
            <p className="processing-note">
              Runs over the {fmt(f.counts.all)} currently loaded buildings, not
              the whole dataset.
            </p>
          )}
          {f.tool.target === "vector" && (
            // **[adapted copy A12]** — Decisions recorded item 4: the radios
            // stay under TARGET and say which layer they count (§7.6: "Scope
            // applies to the SOURCE buildings").
            <p className="processing-note">
              Scope applies to the source layer&apos;s buildings.
            </p>
          )}
        </div>
      </fieldset>
      {/* §6's "PARAMETERS: tool-specific" — one conditional per parameterised
          tool, each one a component of its own, so the form does not grow a
          branch per tool. */}
      {toolId === "roof-metrics" && (
        <fieldset className="processing-section" disabled={locked}>
          <legend className="processing-group__label">PARAMETERS</legend>
          <RoofMetricsParams
            params={f.draft.params}
            onChange={(params) => f.setDraft({ params })}
          />
          {f.paramsError !== null && (
            <p className="processing-error" role="alert">
              {f.paramsError}
            </p>
          )}
        </fieldset>
      )}
      {toolId === "measure-solids" && (
        <fieldset className="processing-section" disabled={locked}>
          <legend className="processing-group__label">PARAMETERS</legend>
          <SolidParams
            params={f.draft.params}
            onChange={(params) => f.setDraft({ params })}
          />
          {f.paramsError !== null && (
            <p className="processing-error" role="alert">
              {f.paramsError}
            </p>
          )}
        </fieldset>
      )}
      {/* `f.tool.implemented`, for the reason the LoD select carries the same
          guard: the proxy radio is a VERDICT on the target's geometry ("LoD 0
          footprints are not in this layer"), and a tool whose executor has not
          shipped states nothing about the user's data. The column list above is
          empty for the same reason — `useToolForm` returns none. */}
      {f.tool.group === "cross-layer" && f.tool.implemented && (
        <fieldset className="processing-section" disabled={locked}>
          <legend className="processing-group__label">PARAMETERS</legend>
          {/* The section renders §6's inline validation itself: §7.6's
              offences belong to ONE aggregate row (residual B11), so the
              sentence has to sit beside that row rather than under the whole
              section — and printing it in both places reads as two problems. */}
          <CrossLayerParams
            toolId={toolId}
            params={f.params}
            onChange={(params) => f.setDraft({ params })}
            proxies={f.proxies}
            sourcePropertyKeys={f.sourcePropertyKeys}
            sourcePropertyTypes={f.sourcePropertyTypes}
            sourceHasFeatureIds={f.sourceHasFeatureIds}
            numericColumns={f.numericColumns}
          />
        </fieldset>
      )}
      {toolId === "validate-solids" && (
        <fieldset className="processing-section" disabled={locked}>
          <legend className="processing-group__label">PARAMETERS</legend>
          {/* §7.3 has no parameters. The section is still here, with the one
              thing a user would otherwise look for: §6.2's Style by result
              opens a rule on this column, so its name is worth stating. */}
          <p className="processing-note">
            Validity is always written as &lt;prefix&gt;valid.
          </p>
        </fieldset>
      )}
      <fieldset className="processing-section" disabled={locked}>
        <legend className="processing-group__label">OUTPUT</legend>
        {/* §6: OUTPUT "starts with the destination, Write to". BOTH radios are
            rendered whatever the tool offers — the spec draws two, and a
            destination the user cannot see is one they have to assume. */}
        <div className="processing-field">
          <span>Write to</span>
          <div
            className="processing-radios"
            role="radiogroup"
            aria-label="Write to"
          >
            <label>
              <input
                type="radio"
                name="writeTo"
                checked={f.draft.destination === "layer"}
                onChange={() => f.setDraft({ destination: "layer" })}
              />
              This layer{f.targetName === null ? "" : ` (${f.targetName})`}
            </label>
            {/* Disabled when the tool has no such destination yet, and then
                with NO reason line: nothing is wrong with the user's form, the
                tool simply cannot write one — and Run's own reason is not
                about this. **[adapted copy A2]** is the other case, where the
                tool does offer it and this TARGET cannot take it. */}
            <label
              title={f.newLayerBlocked ? STREAMING_NO_NEW_LAYER : undefined}
            >
              <input
                type="radio"
                name="writeTo"
                disabled={
                  !f.tool.destinations.includes("new") || f.newLayerBlocked
                }
                checked={f.draft.destination === "new"}
                onChange={() => f.setDraft({ destination: "new" })}
              />
              New layer
            </label>
          </div>
          {f.newLayerBlocked && (
            <p className="processing-note">{STREAMING_NO_NEW_LAYER}</p>
          )}
        </div>
        {f.draft.destination === "new" && (
          <>
            <label className="processing-field">
              <span>Name</span>
              <input
                type="text"
                aria-label="Name"
                value={f.newLayerName}
                onChange={(e) => f.setDraft({ newLayerName: e.target.value })}
                aria-invalid={f.nameError !== null}
              />
            </label>
            {f.nameError !== null && (
              <p className="processing-error" role="alert">
                {f.nameError}
              </p>
            )}
          </>
        )}
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
        <p className="processing-columns">
          {f.columns.map((c) => c.name).join(", ")}
        </p>
        {/* §6: for This layer the warning lists what is on the TARGET; for New
            layer it is scoped to the copy, and only the INHERITED computed
            columns are replaceable — a collision with a source attribute is
            still the prefix error above. */}
        {f.draft.destination === "new"
          ? f.inherited.length > 0 &&
            f.prefixError === null && (
              <p className="processing-warning">
                <span aria-hidden="true">⚠ </span>
                <span>
                  {plural(
                    f.inherited.length,
                    "inherited computed column",
                    "inherited computed columns",
                  )}{" "}
                  will be replaced in the new layer
                </span>
              </p>
            )
          : f.existing.length > 0 &&
            f.prefixError === null && (
              <p className="processing-warning">
                <span aria-hidden="true">⚠ </span>
                <span>
                  {f.existing.length} of these columns exist; they will be
                  replaced.
                </span>
              </p>
            )}
        {/* §6: "Extension note when the tool's extension is not yet loaded" —
            the same sentence the catalogue's chip shows as its tooltip, here as
            a line the user does not have to hover to read. */}
        {f.extensionNote !== null && (
          <p className="processing-note">{f.extensionNote}</p>
        )}
        {/* §6: "a workload note when the target's source is large" — beside the
            extension note, because both say what this Run is about to cost. */}
        {f.workloadNote !== null && (
          <p className="processing-note">{f.workloadNote}</p>
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
