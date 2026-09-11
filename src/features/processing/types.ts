/**
 * Processing toolbox vocabulary (spec §3). Engine-free: nothing here imports
 * DuckDB, Navara or React.
 */
export type ToolGroup = "roof" | "3d" | "cross-layer";

export type ToolId =
  | "roof-metrics"
  | "measure-solids"
  | "validate-solids"
  | "height-from-extent"
  | "join-by-location"
  | "aggregate-per-area"
  | "distance-to-nearest";

export type ToolExtension = "spatial" | "three_d";

export interface ToolDefinition {
  readonly id: ToolId;
  readonly name: string;
  readonly group: ToolGroup;
  /** One line under the name in the catalogue. */
  readonly description: string;
  /** Longer sentence at the top of the tool view. */
  readonly longDescription: string;
  /** Extension the run needs, or null. */
  readonly extension: ToolExtension | null;
  /** Needs a CityJSON / CityJSONSeq source to re-read geometry. */
  readonly needsReader: boolean;
  /** Which kind of layer the run WRITES to. */
  readonly target: "city" | "vector";
  /** Needs a second, vector layer as the source. */
  readonly needsVectorSource: boolean;
  readonly defaultPrefix: string;
  /**
   * The names this tool's run will write, for a prefix and a parameter set.
   *
   * It lives on the DEFINITION, which is pure data, because two places need the
   * same answer at different times: the form prints it before any run exists,
   * and the executor writes it. Absent for a tool whose executor has not
   * shipped — the form then promises nothing.
   */
  readonly outputColumns?: (
    prefix: string,
    params: Readonly<Record<string, unknown>>,
  ) => string[];
  /** False until a later milestone ships the executor. */
  readonly implemented: boolean;
}

export type Scope = "all" | "matching" | "selected";

export type RunPhase = "extension" | "source" | "compute" | "write";

export type RunStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "done"
  | "failed"
  | "cancelled";

export interface LogEntry {
  readonly label: string;
  readonly sql: string | null;
  readonly ms: number;
  readonly rows: number | null;
}

export interface SkipCount {
  readonly cause: string;
  readonly count: number;
}

export interface RunSummary {
  /** First line of the result card, e.g. "2 buildings measured · 2.4 s". */
  readonly line: string;
  /** Second muted line, or null. */
  readonly detail: string | null;
  readonly measured: number;
  readonly skipped: ReadonlyArray<SkipCount>;
}

export interface RunRecord {
  readonly id: string;
  readonly toolId: ToolId;
  readonly targetLayerId: string;
  readonly targetName: string;
  readonly sourceLayerId: string | null;
  readonly sourceName: string | null;
  readonly scope: Scope;
  /** Frozen at Run: the number of FEATURES the scope names. */
  readonly scopeCount: number;
  /** Frozen feature ids, or null for "all". */
  readonly featureIds: ReadonlyArray<string> | null;
  readonly lod: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly prefix: string;
  /** Resolved output column names, in the tool's order. */
  readonly columns: ReadonlyArray<string>;
  readonly status: RunStatus;
  readonly phase: RunPhase | null;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly summary: RunSummary | null;
  readonly error: string | null;
  readonly log: ReadonlyArray<LogEntry>;
  readonly warnings: ReadonlyArray<string>;
  /** Undo still restores the layer to its pre-run state. */
  readonly undoable: boolean;
  /** The layer's table was rebuilt after the run (spec §7). */
  readonly stale: boolean;
  /** Set when the run finished before the cancel arrived (spec §6.1). */
  readonly note: string | null;
}

export type Eligibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };
