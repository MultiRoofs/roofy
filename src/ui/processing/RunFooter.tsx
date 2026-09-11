/**
 * Spec §6's footer: one region that is the Run button, the progress block, the
 * result card or the failure, depending on the run the form is watching.
 *
 * It is a footer and not four components because the states REPLACE each other
 * in the same place — the user's eye stays where it was when they pressed Run.
 */
import { useEffect, useState } from "react";
import { useProcessingStore } from "../../features/processing/processingStore";
import { cancelRun, undoRun } from "../../features/processing/runQueue";
import type { RunRecord } from "../../features/processing/types";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { useShellStore } from "../shell/shellStore";
import { openRunLog } from "./revealTools";
import { phaseLine, plural, seconds } from "./runFormat";

interface Props {
  /** The latest run of this tool on this target, or null. */
  readonly run: RunRecord | null;
  readonly canRun: boolean;
  /** Why Run is disabled, or the queue note — rendered under the button. */
  readonly reason: string | null;
  readonly onRun: () => void;
  readonly targetLayerId: string | null;
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

export function RunFooter({
  run,
  canRun,
  reason,
  onRun,
  targetLayerId,
}: Props) {
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
        <p className="processing-phases">{phaseLine(run.phase)}</p>
        <div className="processing-footer__row">
          <span className="processing-elapsed">{seconds(elapsed)}</span>
          <button type="button" onClick={() => cancelRun(run.id)}>
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
                if (targetLayerId !== null) activateLayer(targetLayerId);
                useShellStore.getState().openDrawer();
              }}
            >
              Open table
            </button>
            <button
              type="button"
              onClick={() => {
                if (targetLayerId === null) return;
                useShellStore.getState().requestSection(targetLayerId, "style");
              }}
            >
              Style by result
            </button>
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
          <button type="submit" className="processing-run" disabled={!canRun}>
            Run again
          </button>
        </div>
        {reason !== null && <p className="processing-note">{reason}</p>}
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
            <button type="button" onClick={onRun}>
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
