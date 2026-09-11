/**
 * Spec §5's history: this session's runs, newest first, at most 20 (the store's
 * cap). Each row is a whole run in one glance — the dot's colour is the status,
 * the head line is what ran on what and how long it took, the second line is
 * the result or the first error line, and the buttons are only the ones that
 * mean something in that state.
 */
import { useProcessingStore } from "../../features/processing/processingStore";
import {
  cancelRun,
  submitRun,
  undoRun,
} from "../../features/processing/runQueue";
import { toolById } from "../../features/processing/toolRegistry";
import type { RunRecord } from "../../features/processing/types";
import { openRunLog, openToolView } from "./revealTools";
import { STATUS_WORD, seconds } from "./runFormat";
import { requestFromRun } from "./useToolForm";

export function RecentRuns() {
  const runs = useProcessingStore((s) => s.runs);
  return (
    <section className="processing-group">
      <h3 className="processing-group__label">RECENT RUNS</h3>
      {runs.length === 0 ? (
        <p className="processing-empty">Runs you start appear here</p>
      ) : (
        <ul className="processing-run-list">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The second line: the result, the first error line, or why it is not usable. */
function secondLine(run: RunRecord): string | null {
  if (run.stale) return "stale: layer reloaded";
  if (run.status === "failed") return run.error;
  if (run.status === "done") return run.summary?.line ?? run.note;
  return run.note;
}

function RunRow({ run }: { readonly run: RunRecord }) {
  const inFlight = run.status === "queued" || run.status === "running";
  const target =
    run.sourceName === null
      ? run.targetName
      : `${run.targetName} ← ${run.sourceName}`;
  const line = secondLine(run);
  const again = () => submitRun(requestFromRun(run));
  return (
    <li className="processing-run-row">
      <div className="processing-run-row__head">
        <span
          className="processing-run-row__dot"
          data-status={run.status}
          aria-hidden="true"
        />
        <span>
          {toolById(run.toolId).name} · {target} · {seconds(run.elapsedMs)} ·{" "}
          {STATUS_WORD[run.status]}
        </span>
      </div>
      {line !== null && <p className="processing-note">{line}</p>}
      <div className="processing-run-row__actions">
        <button type="button" onClick={() => openRunLog(run.id)}>
          Log
        </button>
        {run.status === "done" && run.undoable && !run.stale && (
          <button type="button" onClick={() => void undoRun(run.id)}>
            Undo
          </button>
        )}
        {run.stale && (
          <button type="button" onClick={again}>
            Re-run
          </button>
        )}
        {run.status === "failed" && (
          <button type="button" onClick={again}>
            Retry
          </button>
        )}
        {inFlight && (
          <button type="button" onClick={() => cancelRun(run.id)}>
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            // "Prefilled" is the draft: the tool view reads it on mount, so the
            // form opens on exactly the run the user is editing.
            useProcessingStore.getState().setDraft(run.toolId, {
              targetLayerId: run.targetLayerId,
              scope: run.scope,
              lod: run.lod,
              prefix: run.prefix,
              params: run.params,
            });
            openToolView(run.toolId);
          }}
        >
          Edit &amp; run
        </button>
      </div>
    </li>
  );
}
