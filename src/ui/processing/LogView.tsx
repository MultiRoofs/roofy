/**
 * Spec §6.4: the reproducible record of one run. The header is the frozen
 * parameters (§6.1) written out, so a planner can read it back and rerun by
 * hand; the statements follow in the order they were issued, with their timings.
 *
 * The text Copy puts on the clipboard comes from the pure `formatRunLog`, not
 * from the DOM, so it can be asserted without rendering.
 */
import { useProcessingStore } from "../../features/processing/processingStore";
import { toolById } from "../../features/processing/toolRegistry";
import {
  SCOPE_WORD,
  STATUS_WORD,
  buildingGeometryLine,
  clockTime,
  formatRunLog,
  paramValue,
  plural,
  seconds,
} from "./runFormat";

export function LogView({ runId }: { readonly runId: string }) {
  const run = useProcessingStore((s) => s.runs.find((r) => r.id === runId));
  const back = () => useProcessingStore.getState().back();
  if (run === undefined) {
    return (
      <section className="processing-log">
        <div className="processing-tool__head">
          <button
            type="button"
            className="processing-back"
            aria-label="Back"
            onClick={back}
          >
            ‹
          </button>
          <h2 className="processing-tool__title">Run log</h2>
        </div>
        <p className="processing-empty">This run is no longer in the history</p>
      </section>
    );
  }
  const params = Object.entries(run.params);
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Tool", toolById(run.toolId).name],
    ["Target layer", run.targetName],
    ["Source layer", run.sourceName ?? "—"],
    [
      "Scope",
      `${SCOPE_WORD[run.scope]} · ${plural(run.scopeCount, "building", "buildings")} (frozen at ${clockTime(run.startedAt)})`,
    ],
    ["LoD", run.lod ?? "—"],
    ["Building geometry", buildingGeometryLine(run)],
    [
      "Parameters",
      params.length === 0
        ? "—"
        : params.map(([k, v]) => `${k} = ${paramValue(v)}`).join(", "),
    ],
    ["Output columns", run.columns.join(", ") || "—"],
    ["Started", clockTime(run.startedAt)],
    ["Elapsed", seconds(run.elapsedMs)],
    ["Status", STATUS_WORD[run.status]],
  ];
  return (
    <section className="processing-log">
      <div className="processing-tool__head">
        <button
          type="button"
          className="processing-back"
          aria-label="Back"
          onClick={back}
        >
          ‹
        </button>
        <h2 className="processing-tool__title">Run log</h2>
        <button
          type="button"
          className="processing-log__copy"
          onClick={() => void navigator.clipboard?.writeText(formatRunLog(run))}
        >
          Copy
        </button>
      </div>
      <dl className="processing-log__header">
        {rows.map(([label, value]) => (
          <div key={label} className="processing-log__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {/* Both lists are APPEND-ONLY records of a finished run and are never
          reordered or filtered, so the index is a stable part of the key; the
          label / text alone is not unique (a tool may warn the same thing
          twice, or issue the same labelled statement twice). */}
      {run.log.map((entry, i) => (
        <div key={`${entry.label}-${i}`} className="processing-log__entry">
          <p className="processing-log__label">{entry.label}</p>
          {entry.sql !== null && <pre>{entry.sql}</pre>}
          <p className="processing-note">
            {seconds(entry.ms)}
            {entry.rows !== null && ` · ${plural(entry.rows, "row", "rows")}`}
          </p>
        </div>
      ))}
      {run.warnings.map((warning, i) => (
        <p key={`${warning}-${i}`} className="processing-warning">
          {warning}
        </p>
      ))}
      {run.error !== null && <p className="processing-error">{run.error}</p>}
    </section>
  );
}
