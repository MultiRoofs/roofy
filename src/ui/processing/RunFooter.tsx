/** Processing form actions, progress, and run results. */
import { useEffect, useState } from "react";
import { useProcessingStore } from "../../features/processing/processingStore";
import {
  cancelRun,
  newLayerUndoBlock,
  retryRun,
  undoRun,
} from "../../features/processing/runQueue";
import type { RunRecord } from "../../features/processing/types";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { useShellStore } from "../shell/shellStore";
import { openRunLog } from "./revealTools";
import { UNDO_ENGINE_STOPPED, phaseLine, plural, seconds } from "./runFormat";
import { useLayerStore } from "../../features/layers/layerStore";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { ActionIcon } from "../ActionIcon";

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
  // §6.1: the engine died, so every backup table died with it. The button stays
  // where it was, disabled and explaining itself, rather than vanishing — a
  // card that quietly loses its Undo reads as a card that was never undoable.
  const engineStopped = useProcessingStore((s) => s.engineStopped);
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
    const cardLayerId = run.newLayerId ?? run.targetLayerId;
    const created = run.newLayerId !== null;
    const undoBlock = newLayerUndoBlock(run);
    // An undone or deleted derived layer must not be reactivated.
    const cardLayerAlive = (): boolean =>
      useLayerStore.getState().layers.some((l) => l.id === cardLayerId) ||
      useGeoLayerStore.getState().layers.some((l) => l.id === cardLayerId);
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
          {/* §6.2's This-layer card names what it wrote and where. A
              New-layer run wrote nothing to the target: its own "Created …"
              line already names the layer, and repeating a target that did not
              change would be the one sentence on the card that is false. */}
          {!created && (
            <p className="processing-note">
              Wrote {plural(run.columns.length, "column", "columns")} to{" "}
              {run.targetName}.
            </p>
          )}
          {run.note !== null && <p className="processing-note">{run.note}</p>}
          {run.stale && (
            <p className="processing-note">stale: layer reloaded</p>
          )}
          {created && (
            <div className="processing-card__actions">
              {/* §6.2 lists it FIRST for a New-layer run: the copy is somewhere
                on the globe and the user has not seen it yet. */}
              <button
                type="button"
                onClick={() => {
                  if (!cardLayerAlive()) return;
                  activateLayer(cardLayerId);
                  useShellStore.getState().requestZoom(cardLayerId);
                }}
              >
                Zoom to layer
              </button>
            </div>
          )}
        </div>
        <div className="processing-footer__row processing-footer__row--result">
          {run.undoable && (
            <button
              type="button"
              disabled={engineStopped || undoBlock !== null}
              title={
                engineStopped ? UNDO_ENGINE_STOPPED : (undoBlock ?? undefined)
              }
              onClick={() => void undoRun(run.id)}
            >
              <ActionIcon name="undo" />
              Undo
            </button>
          )}
          <button type="button" onClick={() => openRunLog(run.id)}>
            <ActionIcon name="log" />
            Log
          </button>
          {/* Not a submit: it unlocks the form, it does not re-run. Never
              disabled — a draft that Run would refuse is exactly the draft the
              user has come back to fix. */}
          <button type="button" className="processing-run" onClick={onRunAgain}>
            <ActionIcon name="rerun" />
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
                to edit (or invalidate) while a failure is on screen. The
                queue keeps that request, ids and all: a Retry rebuilt from
                the card would re-resolve "Selected" against whatever is
                selected NOW. */}
            <button type="button" onClick={() => retryRun(run.id)}>
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
