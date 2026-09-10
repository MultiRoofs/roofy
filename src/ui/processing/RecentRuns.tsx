import { useProcessingStore } from "../../features/processing/processingStore";

/**
 * Spec §5's history. Only its empty state exists in this milestone — the run
 * rows and their Log / Undo / Retry / Cancel actions arrive with the executor.
 */
export function RecentRuns() {
  const runs = useProcessingStore((s) => s.runs);
  return (
    <section className="processing-group">
      <h3 className="processing-group__label">RECENT RUNS</h3>
      {runs.length === 0 ? (
        <p className="processing-empty">Runs you start appear here</p>
      ) : null}
    </section>
  );
}
