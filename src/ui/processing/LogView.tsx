import { useProcessingStore } from "../../features/processing/processingStore";

/**
 * Spec §6.4's log. A placeholder until the executor produces entries: it names
 * the run and offers the way back to whichever view opened it.
 */
export function LogView({ runId }: { readonly runId: string }) {
  return (
    <section className="processing-group">
      <button
        type="button"
        className="processing-back"
        onClick={() => useProcessingStore.getState().back()}
      >
        ← Back
      </button>
      <p className="processing-empty">Log {runId}</p>
    </section>
  );
}
