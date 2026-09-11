/**
 * Pure formatting for a run's card, its row in the history and its log. Kept
 * out of the components so the strings can be asserted without rendering.
 */
import { toolById } from "../../features/processing/toolRegistry";
import type { RunPhase, RunRecord } from "../../features/processing/types";

export const PHASES: ReadonlyArray<{
  readonly key: RunPhase;
  readonly label: string;
}> = [
  { key: "extension", label: "Loading extension" },
  { key: "source", label: "Reading source" },
  { key: "compute", label: "Computing" },
  { key: "write", label: "Writing results" },
];

/** "1.7 s" — the card's and the history's one duration format. */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/**
 * Spec §6.1's phase line: the phases before the current one are ticked (a run
 * that needs no extension and no source SKIPS them, and a skipped phase reads
 * as done), the current one trails an ellipsis, the rest are plain.
 */
export function phaseLine(phase: RunPhase | null): string {
  const at = PHASES.findIndex((p) => p.key === phase);
  return PHASES.map((p, i) =>
    at < 0
      ? p.label
      : i < at
        ? `${p.label} ✓`
        : i === at
          ? `${p.label} …`
          : p.label,
  ).join(" · ");
}

/** Local wall clock as HH:MM:SS. Hand-formatted: `toLocaleTimeString` would
 *  make the log's text depend on the host's locale. */
export function clockTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const SCOPE_WORD: Readonly<Record<RunRecord["scope"], string>> = {
  all: "All",
  matching: "Matching",
  selected: "Selected",
};

export const STATUS_WORD: Readonly<Record<RunRecord["status"], string>> = {
  queued: "queued",
  running: "running",
  cancelling: "cancelling",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

/** Spec §6.4's Copy: the whole log as plain text. */
export function formatRunLog(run: RunRecord): string {
  const lines: string[] = [];
  lines.push(`Tool: ${toolById(run.toolId).name}`);
  lines.push(`Target layer: ${run.targetName}`);
  lines.push(`Source layer: ${run.sourceName ?? "—"}`);
  lines.push(
    `Scope: ${SCOPE_WORD[run.scope]} · ${plural(run.scopeCount, "building", "buildings")} (frozen at ${clockTime(run.startedAt)})`,
  );
  lines.push(`LoD: ${run.lod ?? "—"}`);
  lines.push("Building geometry: —");
  const params = Object.entries(run.params);
  lines.push(
    `Parameters: ${params.length === 0 ? "—" : params.map(([k, v]) => `${k} = ${String(v)}`).join(", ")}`,
  );
  lines.push(`Output columns: ${run.columns.join(", ") || "—"}`);
  lines.push(`Started: ${clockTime(run.startedAt)}`);
  lines.push(`Elapsed: ${seconds(run.elapsedMs)}`);
  lines.push(`Status: ${STATUS_WORD[run.status]}`);
  lines.push("");
  for (const entry of run.log) {
    lines.push(entry.label);
    if (entry.sql !== null) lines.push(entry.sql);
    lines.push(
      `${seconds(entry.ms)}${entry.rows === null ? "" : ` · ${plural(entry.rows, "row", "rows")}`}`,
    );
    lines.push("");
  }
  for (const warning of run.warnings) lines.push(`Warning: ${warning}`);
  if (run.error !== null) lines.push(`Error: ${run.error}`);
  return lines.join("\n");
}
