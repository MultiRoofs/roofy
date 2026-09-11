/**
 * Spec §6's footer: one region that is the Run button, the progress block, the
 * result card or the failure, depending on the run the form is watching.
 *
 * It is a footer and not four components because the states REPLACE each other
 * in the same place — the user's eye stays where it was when they pressed Run.
 */
import { useEffect, useState } from "react";
import { useProcessingStore } from "../../features/processing/processingStore";
import {
  cancelRun,
  submitRun,
  undoRun,
} from "../../features/processing/runQueue";
import { requestFromRun } from "./useToolForm";
import type { RunRecord } from "../../features/processing/types";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { useShellStore } from "../shell/shellStore";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { appendColumns } from "../drawer/columnPolicy";
import { openRunLog } from "./revealTools";
import { phaseLine, plural, seconds } from "./runFormat";
import { useLayerStore } from "../../features/layers/layerStore";
import { useRuleDraftStore } from "../../features/rules/ruleDraftStore";
import { useLayerTableStore } from "../../insights/layerTables";
import { runQuery } from "../../insights/duckdb";
import { quoteIdent } from "../../insights/sql";
import { NEW_RULE_COLOR_HEX } from "../../scene/cityColors";

/** §6.2's reason for a Style-by-result button with nothing to style. */
const ALL_VALUES_EMPTY = "All values are empty";

/**
 * §6.2's "Style by result": open the target's STYLE section with Color by =
 * Rules and the rule editor on a DRAFT — never a saved rule, because "the map
 * does NOT change until the user presses Save in the editor".
 *
 * The value is read from the data at click time (§7.4: "rule on
 * `extent_height_m` > median"), which is why this is async: the median is one
 * DuckDB round trip, and the navigation waits for it so the editor never
 * opens on a value that is about to be replaced.
 */
async function styleByResult(run: RunRecord, column: string): Promise<void> {
  // The run's own target is the frozen truth (§6.1), as for Open table.
  const layerId = run.targetLayerId;
  const entry = useLayerTableStore.getState().tables[layerId];
  const table = entry?.state === "ready" ? entry.info.table : null;
  let median = 0;
  if (table !== null) {
    const outcome = await runQuery(
      `SELECT median(${quoteIdent(column)}) AS m FROM ${quoteIdent(table)}`,
    );
    const value = outcome.ok ? outcome.rows[0]?.["m"] : undefined;
    // A failed query, an empty table or an all-NULL column all read as 0: the
    // draft is a starting point the user edits, so a number they can see beats
    // an editor that refuses to open.
    if (typeof value === "number" && Number.isFinite(value)) median = value;
  }
  useRuleDraftStore.getState().setDraft(layerId, {
    editingId: null,
    open: true,
    form: {
      // Unnamed, exactly as "+ Add rule" starts: the user names their rule.
      name: "",
      color: NEW_RULE_COLOR_HEX,
      logic: "AND",
      conditions: [{ field: column, operator: ">", value: median }],
    },
  });
  useLayerStore.getState().updateLayer(layerId, { colorBy: "rules" });
  // Last, so the panel opens on a draft that is already written.
  useShellStore.getState().requestSection(layerId, "style");
}

interface Props {
  /** The latest run of this tool on this target, or null. */
  readonly run: RunRecord | null;
  readonly canRun: boolean;
  /** Why Run is disabled, or the queue note — rendered under the button. */
  readonly reason: string | null;
  /** §6.2: dismiss the result card and hand the form back, unlocked. */
  readonly onRunAgain: () => void;
}

/** Ticks while the run is in flight; the finished run's own `elapsedMs` after. */
function useElapsed(run: RunRecord | null): number {
  const live =
    run !== null && (run.status === "running" || run.status === "cancelling");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [live, run?.id]);
  if (run === null) return 0;
  return live ? Math.max(0, now - run.startedAt) : run.elapsedMs;
}

export function RunFooter({ run, canRun, reason, onRunAgain }: Props) {
  const elapsed = useElapsed(run);
  const status = run?.status ?? null;

  if (run !== null && (status === "running" || status === "cancelling")) {
    return (
      <div className="processing-footer processing-footer--progress">
        <div
          className="processing-progress"
          role="progressbar"
          aria-busy="true"
          aria-label={status === "cancelling" ? "Cancelling" : "Running"}
        />
        {/* The phase is the only thing that CHANGES under a screen reader here;
            the elapsed ticker beside it is deliberately NOT a live region — at
            250 ms it would talk over every other announcement. */}
        <p className="processing-phases" aria-live="polite">
          {phaseLine(run.phase)}
        </p>
        <div className="processing-footer__row">
          <span className="processing-elapsed">{seconds(elapsed)}</span>
          <button
            type="button"
            disabled={status === "cancelling"}
            onClick={() => cancelRun(run.id)}
          >
            Cancel run
          </button>
        </div>
      </div>
    );
  }

  if (run !== null && status === "queued") {
    return (
      <div className="processing-footer processing-footer--progress">
        <p className="processing-phases">{reason ?? "Queued"}</p>
        <div className="processing-footer__row">
          <button type="button" onClick={() => cancelRun(run.id)}>
            Cancel run
          </button>
        </div>
      </div>
    );
  }

  if (run !== null && status === "done") {
    // §6.2/§7: the draft styles the FIRST column the run wrote, in the tool's
    // own order (`extent_height_m` for Height from extent, §7.4).
    const styleColumn = run.columns[0];
    return (
      <div className="processing-footer processing-footer--card">
        <div className="processing-card">
          <p className="processing-card__line">
            <span aria-hidden="true">✓ </span>
            <span>{run.summary?.line ?? "Done"}</span>
          </p>
          {run.summary?.detail && (
            <p className="processing-note">{run.summary.detail}</p>
          )}
          <p className="processing-note">
            Wrote {plural(run.columns.length, "column", "columns")} to{" "}
            {run.targetName}.
          </p>
          {run.note !== null && <p className="processing-note">{run.note}</p>}
          {run.stale && (
            <p className="processing-note">stale: layer reloaded</p>
          )}
          <div className="processing-card__actions">
            <button
              type="button"
              onClick={() => {
                // The run's own target is the frozen truth (§6.1); the form's
                // select may have moved on since it finished.
                activateLayer(run.targetLayerId);
                useShellStore.getState().openDrawer();
                // §6.2: "the new columns appended after the existing ones".
                // Only for a list the user has customised — a default list
                // picks the run's columns up on its own, and re-appending to
                // it would freeze the default.
                const columns = layerQuery(
                  useQueryStore.getState(),
                  run.targetLayerId,
                ).columns;
                const next = appendColumns(columns, run.columns);
                if (next !== null && next !== columns)
                  useQueryStore.getState().setColumns(run.targetLayerId, next);
              }}
            >
              Open table
            </button>
            {/* §6.2: "absent when the run wrote no styleable column". Every
                M1 tool writes one, so this is the empty-columns guard
                `noUncheckedIndexedAccess` asks for, spelled as the spec's
                behaviour rather than as a non-null assertion. */}
            {styleColumn !== undefined && (
              <button
                type="button"
                disabled={run.summary?.measured === 0}
                title={
                  run.summary?.measured === 0 ? ALL_VALUES_EMPTY : undefined
                }
                onClick={() => void styleByResult(run, styleColumn)}
              >
                Style by result
              </button>
            )}
            {run.undoable && (
              <button type="button" onClick={() => void undoRun(run.id)}>
                Undo
              </button>
            )}
            <button type="button" onClick={() => openRunLog(run.id)}>
              Log
            </button>
          </div>
        </div>
        <div className="processing-footer__row">
          {/* Not a submit: it unlocks the form, it does not re-run. Never
              disabled — a draft that Run would refuse is exactly the draft the
              user has come back to fix. */}
          <button type="button" className="processing-run" onClick={onRunAgain}>
            Run again
          </button>
        </div>
      </div>
    );
  }

  if (run !== null && status === "failed") {
    return (
      <div className="processing-footer processing-footer--card">
        <div className="processing-card processing-card--failed">
          <p className="processing-card__line">
            <span aria-hidden="true">✕ </span>
            <span>Failed after {seconds(run.elapsedMs)}</span>
          </p>
          <p className="processing-error">{run.error}</p>
          <div className="processing-card__actions">
            {/* §6.3: "Retry re-runs with the same parameters" — the run's own
                frozen request, never the form's draft, which the user is free
                to edit (or invalidate) while a failure is on screen. */}
            <button
              type="button"
              onClick={() => submitRun(requestFromRun(run))}
            >
              Retry
            </button>
            <button type="button" onClick={() => openRunLog(run.id)}>
              Log
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="processing-footer">
      {run !== null && run.note !== null && (
        <p className="processing-note">{run.note}</p>
      )}
      <div className="processing-footer__row">
        <button
          type="button"
          onClick={() => useProcessingStore.getState().back()}
        >
          Cancel
        </button>
        <button type="submit" className="processing-run" disabled={!canRun}>
          Run
        </button>
      </div>
      {reason !== null && <p className="processing-note">{reason}</p>}
    </div>
  );
}
