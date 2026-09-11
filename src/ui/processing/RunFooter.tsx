/**
 * Spec §6's footer: one region that is the Run button, the progress block, the
 * result card or the failure, depending on the run the form is watching.
 *
 * It is a footer and not four components because the states REPLACE each other
 * in the same place — the user's eye stays where it was when they pressed Run.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import { runQuery, type QueryOutcome } from "../../insights/duckdb";
import { quoteIdent } from "../../insights/sql";
import { NEW_RULE_COLOR_HEX } from "../../scene/cityColors";

/** §6.2's reason for a Style-by-result button with nothing to style. */
const ALL_VALUES_EMPTY = "All values are empty";
/** §7's reason: the layer's table was rebuilt after the run, so the run no
 *  longer describes what a median would be read from. Same string the card
 *  already prints for a stale run. */
const STALE_LAYER_RELOADED = "stale: layer reloaded";

/**
 * The median read behind Style by result, or `null` when there is no table to
 * read it from.
 *
 * `null` is not a failure to report: the button is only offered on a DONE run
 * whose own writes went into that table, and a table that has since gone
 * takes the layer out of the tool's target list altogether
 * (`useToolForm.ts:83`). There is no true sentence to show the user about it,
 * so the caller abandons silently rather than invent one.
 */
async function readMedian(
  layerId: string,
  column: string,
): Promise<QueryOutcome | null> {
  const entry = useLayerTableStore.getState().tables[layerId];
  if (entry?.state !== "ready") return null;
  return await runQuery(
    `SELECT median(${quoteIdent(column)}) AS m FROM ${quoteIdent(entry.info.table)}`,
  );
}

/**
 * §6.2's "Style by result": open the target's STYLE section with Color by =
 * Rules and the rule editor on a DRAFT — never a saved rule, because "the map
 * does NOT change until the user presses Save in the editor".
 *
 * The value is read from the data at click time (§7.4: "rule on
 * `extent_height_m` > median"), which is why this is async: the median is one
 * DuckDB round trip, and the navigation waits for it.
 *
 * A read that does not produce a number opens NOTHING and says why in the
 * toast (§6.2's own failure surface). The rejected alternative was a `> 0`
 * fallback: it looks exactly like a real answer, and DuckDB had already
 * handed us the reason it failed.
 *
 * `pending` and `token` are the two guards the awaited gap needs: the button
 * is disabled while its read is in flight, so two overlapping reads cannot
 * each replace the whole draft on arrival, and the token invalidates a read
 * whose CONTEXT has gone — a newer click, an unmount, or the card being
 * dismissed by Run again, which swaps `run` for null without unmounting the
 * footer (`ToolView.tsx:209-215`). That last one is why the invalidation is
 * keyed on the run's identity and not on the unmount alone.
 */
function useStyleByResult(runId: string | null): {
  readonly pending: boolean;
  readonly start: (run: RunRecord, column: string) => void;
} {
  const [pending, setPending] = useState(false);
  const tokenRef = useRef(0);
  useEffect(
    () => () => {
      // Leaving this run's card: whatever it started is no longer wanted, and
      // the card that replaces it starts with a button of its own.
      tokenRef.current += 1;
      setPending(false);
    },
    [runId],
  );

  const start = useCallback((run: RunRecord, column: string) => {
    // The run's own target is the frozen truth (§6.1), as for Open table.
    const layerId = run.targetLayerId;
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setPending(true);
    void (async () => {
      try {
        const outcome = await readMedian(layerId, column);
        if (tokenRef.current !== token) return;
        // No table to read: an impossible state for a done run, and one with
        // nothing true to say about it. See `readMedian`.
        if (outcome === null) return;
        // The layer can be removed while the read is in flight, and
        // `requestSection` activates whatever id it is handed
        // (shellStore.ts:173) — which would resurrect it. Abandon silently:
        // the user removed the layer, they are not waiting for news about it.
        const alive = useLayerStore
          .getState()
          .layers.some((l) => l.id === layerId);
        if (!alive) return;
        if (!outcome.ok) {
          // Verbatim: `runQuery` has already put the error through
          // `formatDuckDBError` (duckdb.ts:396), which IS §6.3's "first error
          // line, as the export dialog shows DuckDB errors".
          useProcessingStore.getState().pushNotice(outcome.message);
          return;
        }
        const value = outcome.rows[0]?.["m"];
        // NULL, or no row at all: the column has no value to style by.
        if (typeof value !== "number" || !Number.isFinite(value)) {
          useProcessingStore.getState().pushNotice(ALL_VALUES_EMPTY);
          return;
        }
        useRuleDraftStore.getState().setDraft(layerId, {
          editingId: null,
          open: true,
          form: {
            // Unnamed, exactly as "+ Add rule" starts: the user names it.
            name: "",
            color: NEW_RULE_COLOR_HEX,
            logic: "AND",
            conditions: [{ field: column, operator: ">", value }],
          },
        });
        useLayerStore.getState().updateLayer(layerId, { colorBy: "rules" });
        // Last, so the panel opens on a draft that is already written.
        useShellStore.getState().requestSection(layerId, "style");
      } finally {
        if (tokenRef.current === token) setPending(false);
      }
    })();
  }, []);

  return { pending, start };
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
  const style = useStyleByResult(run?.id ?? null);
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
          {/* §6.1's button is "Cancel". The label is what tells a screen
              reader WHICH Cancel this is — the idle footer's Cancel leaves the
              tool, this one stops the run — and it is the name every test
              reaches the button by. */}
          <button
            type="button"
            aria-label="Cancel run"
            disabled={status === "cancelling"}
            onClick={() => cancelRun(run.id)}
          >
            Cancel
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
          <button
            type="button"
            aria-label="Cancel run"
            onClick={() => cancelRun(run.id)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (run !== null && status === "done") {
    // §6.2/§7: the draft styles the FIRST column the run wrote, in the tool's
    // own order (`extent_height_m` for Height from extent, §7.4).
    const styleColumn = run.columns[0];
    // Why the button is off, as a reason the user can READ — not only a
    // tooltip on a disabled control, which no keyboard or screen-reader user
    // reaches — in the same muted note Run's own reason gets.
    //
    // §6.2: "disabled with 'All values are empty' when the chosen column is
    // NULL for every object in the run". A STALE run is disabled too, and
    // OUTRANKS empty: its table was rebuilt under it, which is why no median
    // can be trusted at all, so "All values are empty" would be a claim about
    // data this run no longer describes. The card already prints the stale
    // reason above the actions, so that one is not repeated below them.
    const styleReason = run.stale
      ? STALE_LAYER_RELOADED
      : run.summary?.measured === 0
        ? ALL_VALUES_EMPTY
        : null;
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
                disabled={styleReason !== null || style.pending}
                title={styleReason ?? undefined}
                onClick={() => style.start(run, styleColumn)}
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
          {styleColumn !== undefined &&
            styleReason !== null &&
            styleReason !== STALE_LAYER_RELOADED && (
              <p className="processing-note">{styleReason}</p>
            )}
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
