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
  /**
   * Does the form offer a LoD select (spec §6)?
   *
   * True for the tools that read GEOMETRY at one level of detail. False for
   * Height from extent (the bbox is unioned across every LoD in the file) and
   * for the cross-layer tools, whose building geometry is a PROXY radio rather
   * than a LoD. An UNIMPLEMENTED tool never renders the control whatever this
   * says — it has no source of truthful counts (see `useLodOptions`).
   */
  readonly needsLod: boolean;
  readonly defaultPrefix: string;
  /**
   * The names this tool's run will write, for a prefix and a parameter set.
   *
   * It lives on the DEFINITION, which is pure data, because two places need the
   * same answer at different times: the form prints it before any run exists,
   * and the executor writes it. Absent for a tool whose columns are not
   * settled yet — the form then promises nothing.
   */
  readonly outputColumns?: (
    prefix: string,
    params: Readonly<Record<string, unknown>>,
  ) => string[];

  /**
   * Spec §6: "Validation is inline and blocks Run". The message, or null when
   * the parameters are runnable. Absent for a tool with no parameters.
   */
  readonly validateParams?: (
    params: Readonly<Record<string, unknown>>,
  ) => string | null;

  /**
   * The draft's parameter bag with every default filled in, for FREEZING.
   *
   * Spec §6.1 freezes "everything the run needs", and §6.4 makes the log "the
   * reproducible record of the run: a planner can read it back and rerun by
   * hand". A draft the user never touched is `{}`, so without this the log
   * would print "Parameters: —" for a run that used six measures and a 5°
   * threshold. Absent for a tool with no parameters.
   */
  readonly normaliseParams?: (
    params: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
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
  /**
   * How many written rows have a value in the run's FIRST output column.
   *
   * Spec §6.2 disables Style by result "when the chosen column is NULL for
   * every object in the run", and the chosen column is `columns[0]`. It is not
   * the same as `measured === 0`: a run with only Dominant azimuth ticked over
   * flat roofs measures every building and writes NULL to all of them (§7,
   * "a feature with no remaining contributor for a measure gets NULL for it").
   */
  readonly firstColumnNonNull: number;
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
