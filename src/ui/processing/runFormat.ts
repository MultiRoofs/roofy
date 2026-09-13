/**
 * Pure formatting for a run's card, its row in the history and its log. Kept
 * out of the components so the strings can be asserted without rendering.
 */
import {
  proxyLogLabel,
  type BuildingProxy,
} from "../../features/processing/buildingProxy";
import type { DerivedFrom } from "../../features/layers/layerStore";
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

/**
 * Why an Undo is offered but cannot be taken, once the analytics engine has
 * stopped (spec §6.1): every backup table lived in the database that died.
 *
 * §6.1's own sentence is "Unavailable after an engine restart", which assumes
 * the restart this milestone does not perform — saying "after a restart" when
 * nothing restarted would describe an event the user never saw. Here rather
 * than in either component, so the card and the history cannot drift apart.
 */
export const UNDO_ENGINE_STOPPED = "Unavailable: the analytics engine stopped";

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

/**
 * Spec §6.4's "building geometry proxy actually used".
 *
 * Read off the FROZEN parameters, which are exactly what was used: the form
 * resolves the target's own default into the draft before Run (Task 15), and
 * the executor reads the same bag. A tool with no proxy — every one-layer tool
 * — keeps the em dash, and so does a value that is not one of the three.
 */
export function buildingGeometryLine(run: RunRecord): string {
  const proxy = run.params["proxy"];
  const known: ReadonlyArray<BuildingProxy> = [
    "footprint",
    "rectangle",
    "centre",
  ];
  return known.includes(proxy as BuildingProxy)
    ? proxyLogLabel(proxy as BuildingProxy)
    : "—";
}

/** One frozen parameter's value, as §6.4's record. A primitive as itself, a
 *  list or an object as JSON — `String([{op:"count"}])` is `[object Object]`,
 *  which records nothing. */
export function paramValue(value: unknown): string {
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
}

/**
 * §6.4's `Target layer` row.
 *
 * A DERIVED layer's name says nothing about where its rows came from, and
 * §6.4's header is "the reproducible record of the run: a planner can read it
 * back and rerun by hand" — so the parent travels with it. [adapted copy A7].
 *
 * `derivedFrom` is passed IN rather than read from the layer store: this
 * module is pure, and the record it carries is the copy made at publication,
 * so the line stays right after the parent is renamed or removed.
 */
export function targetLayerLine(
  run: RunRecord,
  derivedFrom: DerivedFrom | null,
): string {
  return derivedFrom === null
    ? run.targetName
    : `${run.targetName} · Derived from ${derivedFrom.layerName}`;
}

/** Spec §6.4's Copy: the whole log as plain text. */
export function formatRunLog(
  run: RunRecord,
  derivedFrom: DerivedFrom | null,
): string {
  const lines: string[] = [];
  lines.push(`Tool: ${toolById(run.toolId).name}`);
  lines.push(`Target layer: ${targetLayerLine(run, derivedFrom)}`);
  lines.push(`Source layer: ${run.sourceName ?? "—"}`);
  lines.push(
    `Scope: ${SCOPE_WORD[run.scope]} · ${plural(run.scopeCount, "building", "buildings")} (frozen at ${clockTime(run.startedAt)})`,
  );
  lines.push(`LoD: ${run.lod ?? "—"}`);
  lines.push(`Building geometry: ${buildingGeometryLine(run)}`);
  const params = Object.entries(run.params);
  lines.push(
    `Parameters: ${params.length === 0 ? "—" : params.map(([k, v]) => `${k} = ${paramValue(v)}`).join(", ")}`,
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
