### Task 11: Tool view, run footer, recent runs, log view (spec §6)

**Files:**

- Replace placeholders: `src/ui/processing/ToolView.tsx`, `src/ui/processing/LogView.tsx`, `src/ui/processing/RecentRuns.tsx`
- Create: `src/ui/processing/RunFooter.tsx`, `src/ui/processing/useToolForm.ts`
- Modify: `src/ui/processing/processing.css`
- Test: `tests/unit/ui/processing/ToolView.test.tsx`, `tests/unit/ui/processing/RecentRuns.test.tsx`, `tests/unit/ui/processing/LogView.test.tsx`

**Interfaces:**

- Consumes: `useProcessingStore`, `toolById`, `toolEligibility` + `useEligibilityContext`, `useLayerCounts(layerId)`, `useLayerStore`, `getLayerTable`/`useLayerTableStore`, `submitRun`, `cancelRun`, `undoRun`, `resolveActiveLayer`, `useShellStore.openDrawer`/`requestSection`, `activateLayer`.
- Produces: `useToolForm(toolId)` returning `{ draft, setDraft, eligibleTargets: Layer[], target: Layer | null, counts, columns: string[], existing: string[], sourceCollisions: string[], prefixError: string | null, canRun: boolean, runReason: string | null, latestRun: RunRecord | null }`.

- [ ] **Step 1: `useToolForm`**

```ts
import { useMemo } from "react";
import { useLayerStore, type Layer } from "../../features/layers/layerStore";
import { useLayerTableStore } from "../../insights/layerTables";
import { useLayerCounts } from "../table/useLayerCounts";
import {
  computedColumnsOf,
  useComputedColumnStore,
} from "../../insights/computedColumns";
import {
  useProcessingStore,
  type ToolDraft,
} from "../../features/processing/processingStore";
import { toolById } from "../../features/processing/toolRegistry";
import { toolEligibility } from "../../features/processing/eligibility";
import type { ToolId } from "../../features/processing/types";
import { useEligibilityContext } from "./useEligibilityContext";
import { useActiveLayer } from "../../features/workspace/activeLayer";

/** Output column names per tool; M1 knows one tool, later milestones extend this map. */
export const OUTPUT_COLUMNS: Readonly<
  Partial<
    Record<
      ToolId,
      (prefix: string, params: Readonly<Record<string, unknown>>) => string[]
    >
  >
> = {
  "height-from-extent": (p) => [`${p}height_m`, `${p}zmin_m`, `${p}zmax_m`],
};

const PREFIX_RE = /^[a-z][a-z0-9_]*$/i;

export function useToolForm(toolId: ToolId) {
  const tool = toolById(toolId);
  const active = useActiveLayer();
  const layers = useLayerStore((s) => s.layers);
  const tables = useLayerTableStore((s) => s.tables);
  const drafts = useProcessingStore((s) => s.drafts);
  const runs = useProcessingStore((s) => s.runs);
  useComputedColumnStore((s) => s.byLayer); // subscribe: the replace warning depends on it
  const eligibleTargets = useMemo(
    () => layers.filter((l) => tables[l.id]?.state === "ready"),
    [layers, tables],
  );
  const stored = drafts[toolId];
  const defaultTarget =
    active?.kind === "city" &&
    eligibleTargets.some((l) => l.id === active.layer.id)
      ? active.layer.id
      : (eligibleTargets[0]?.id ?? null);
  const draft: ToolDraft = stored ?? {
    targetLayerId: defaultTarget,
    scope: "all",
    lod: null,
    prefix: tool.defaultPrefix,
    params: {},
  };
  const target = layers.find((l) => l.id === draft.targetLayerId) ?? null;
  const counts = useLayerCounts(target?.id ?? null);
  const targetCtx = useEligibilityContext(
    target ? { kind: "city", layer: target } : null,
  );
  const eligibility = toolEligibility(tool, targetCtx);
  const columns = (OUTPUT_COLUMNS[toolId] ?? (() => []))(
    draft.prefix,
    draft.params,
  );
  const tableInfo =
    target && tables[target.id]?.state === "ready" ? tables[target.id] : null;
  const tableColumns =
    tableInfo && tableInfo.state === "ready"
      ? tableInfo.info.columns.map((c) => c.name)
      : [];
  const computed = target ? computedColumnsOf(target.id) : new Set<string>();
  const existing = columns.filter((c) => tableColumns.includes(c));
  const sourceCollisions = existing.filter((c) => !computed.has(c));
  const prefixError = !PREFIX_RE.test(draft.prefix)
    ? "Use letters, digits and underscores, starting with a letter"
    : sourceCollisions.length > 0
      ? `'${sourceCollisions[0]}' belongs to the source data; choose another prefix`
      : null;
  const scopeReason =
    draft.scope === "matching" && counts.matching === null
      ? "No filter applied"
      : draft.scope === "selected" && !(counts.selected && counts.selected > 0)
        ? "Nothing selected on this layer"
        : null;
  const runReason = !eligibility.ok
    ? eligibility.reason
    : (prefixError ?? scopeReason);
  const latestRun =
    runs.find((r) => r.toolId === toolId && r.targetLayerId === target?.id) ??
    null;
  const busy = runs.some(
    (r) => r.status === "running" || r.status === "cancelling",
  );
  return {
    tool,
    draft,
    eligibleTargets,
    target,
    counts,
    columns,
    existing,
    prefixError,
    eligibility,
    canRun: runReason === null && target !== null,
    runReason,
    latestRun,
    busy,
    setDraft: (patch: Partial<ToolDraft>) =>
      useProcessingStore.getState().setDraft(toolId, { ...draft, ...patch }),
  };
}
```

`useLayerCounts` returns `matching: null` when no filter is applied? Check `useLayerCounts.ts`: if it returns the `all` count when no filter is applied, derive `noFilter` from `layerQuery(state, id).applied === null` instead (import `useQueryStore` and `layerQuery`).

- [ ] **Step 2: Failing ToolView test** (duckdb mocked; `runQueue` mocked with `vi.mock("../../../../src/features/processing/runQueue", () => ({ submitRun: vi.fn(() => "run_1"), cancelRun: vi.fn(), undoRun: vi.fn(async () => {}) }))`; `useLayerCounts` mocked to return `{ all: 2, matching: null, selected: 0, loading: false, message: null }`; a layer + ready table seeded as in the catalogue test)

```tsx
it("renders TARGET, scope counts, OUTPUT columns and runs with the draft", () => {
  render(<ToolView toolId="height-from-extent" />);
  expect(
    screen.getByRole("heading", { name: "Height from extent" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Layer" })).toHaveValue(layerId);
  expect(screen.getByRole("radio", { name: "All 2 buildings" })).toBeChecked();
  expect(screen.getByRole("radio", { name: /Matching/ })).toBeDisabled();
  expect(screen.getByRole("radio", { name: /Selected/ })).toBeDisabled();
  expect(
    screen.getByText("extent_height_m, extent_zmin_m, extent_zmax_m"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(submitRun).toHaveBeenCalledWith(
    expect.objectContaining({
      toolId: "height-from-extent",
      targetLayerId: layerId,
      scope: "all",
      prefix: "extent_",
      columns: [
        { name: "extent_height_m", type: "DOUBLE" },
        { name: "extent_zmin_m", type: "DOUBLE" },
        { name: "extent_zmax_m", type: "DOUBLE" },
      ],
    }),
  );
});

it("rejects a prefix that collides with a source attribute", () => {
  // seed the table columns with "height_m"
  render(<ToolView toolId="height-from-extent" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
    target: { value: "" },
  });
  // empty prefix → "height_m" collides with the source column
  expect(
    screen.getByText(
      "'height_m' belongs to the source data; choose another prefix",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
});

it("shows the replace warning for computed columns and the running / done / failed footers", () => {
  // seed computed column "extent_height_m" in useComputedColumnStore and the table columns
  render(<ToolView toolId="height-from-extent" />);
  expect(
    screen.getByText("1 of these columns exist; they will be replaced."),
  ).toBeInTheDocument();
  useProcessingStore.getState().upsertRun(
    runFixture({
      status: "running",
      phase: "compute",
      targetLayerId: layerId,
    }),
  );
  expect(screen.getByText(/Computing/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Cancel run" }),
  ).toBeInTheDocument();
  useProcessingStore.getState().patchRun("r1", {
    status: "done",
    summary: {
      line: "2 buildings measured · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
    },
    undoable: true,
  });
  expect(screen.getByText("2 buildings measured · 0.3 s")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  useProcessingStore
    .getState()
    .patchRun("r1", { status: "failed", error: "Binder Error: x" });
  expect(screen.getByText("Binder Error: x")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Implement `ToolView`**

```tsx
import { useProcessingStore } from "../../features/processing/processingStore";
import { submitRun } from "../../features/processing/runQueue";
import type { ToolId } from "../../features/processing/types";
import { useToolForm } from "./useToolForm";
import { RunFooter } from "./RunFooter";

const fmt = (n: number | null) =>
  n === null ? "?" : n.toLocaleString("en-US");

export function ToolView({ toolId }: { readonly toolId: ToolId }) {
  const f = useToolForm(toolId);
  const locked =
    f.latestRun !== null &&
    (f.latestRun.status === "running" ||
      f.latestRun.status === "queued" ||
      f.latestRun.status === "cancelling");
  const run = () => {
    if (!f.target || !f.canRun) return;
    submitRun({
      toolId,
      targetLayerId: f.target.id,
      scope: f.draft.scope,
      lod: f.draft.lod,
      params: f.draft.params,
      prefix: f.draft.prefix,
      columns: f.columns.map((name) => ({ name, type: "DOUBLE" as const })),
    });
  };
  return (
    <form
      className="processing-tool"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <div className="processing-tool__head">
        <button
          type="button"
          className="processing-back"
          aria-label="Back to tools"
          onClick={() => useProcessingStore.getState().back()}
        >
          ‹
        </button>
        <h2 className="processing-tool__title">{f.tool.name}</h2>
        {f.tool.extension && (
          <span className="processing-chip">
            {f.tool.extension === "spatial" ? "Spatial" : "3D"}
          </span>
        )}
      </div>
      <p className="processing-tool__desc">{f.tool.longDescription}</p>
      <fieldset className="processing-section" disabled={locked}>
        <legend className="processing-group__label">TARGET</legend>
        <label className="processing-field">
          <span>Layer</span>
          <select
            aria-label="Layer"
            value={f.target?.id ?? ""}
            onChange={(e) => f.setDraft({ targetLayerId: e.target.value })}
          >
            {f.eligibleTargets.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="processing-field">
          <span>Scope</span>
          <div
            className="processing-radios"
            role="radiogroup"
            aria-label="Scope"
          >
            <label>
              <input
                type="radio"
                name="scope"
                checked={f.draft.scope === "all"}
                onChange={() => f.setDraft({ scope: "all" })}
              />
              All {fmt(f.counts.all)} buildings
            </label>
            <label
              title={
                f.counts.matching === null ? "No filter applied" : undefined
              }
            >
              <input
                type="radio"
                name="scope"
                disabled={f.counts.matching === null}
                checked={f.draft.scope === "matching"}
                onChange={() => f.setDraft({ scope: "matching" })}
              />
              Matching {fmt(f.counts.matching)}
            </label>
            <label
              title={
                !f.counts.selected
                  ? "Nothing selected on this layer"
                  : undefined
              }
            >
              <input
                type="radio"
                name="scope"
                disabled={!f.counts.selected}
                checked={f.draft.scope === "selected"}
                onChange={() => f.setDraft({ scope: "selected" })}
              />
              Selected {fmt(f.counts.selected)}
            </label>
          </div>
          {f.target?.isStreaming && (
            <p className="processing-note">
              Runs over the {fmt(f.counts.all)} currently loaded buildings, not
              the whole dataset.
            </p>
          )}
        </div>
      </fieldset>
      <fieldset className="processing-section" disabled={locked}>
        <legend className="processing-group__label">OUTPUT</legend>
        <label className="processing-field">
          <span>Prefix</span>
          <input
            type="text"
            aria-label="Prefix"
            value={f.draft.prefix}
            onChange={(e) => f.setDraft({ prefix: e.target.value })}
            aria-invalid={f.prefixError !== null}
          />
        </label>
        {f.prefixError && (
          <p className="processing-error" role="alert">
            {f.prefixError}
          </p>
        )}
        <p className="processing-note">Columns:</p>
        <p className="processing-columns">{f.columns.join(", ")}</p>
        {f.existing.length > 0 && f.prefixError === null && (
          <p className="processing-warning">
            ⚠ {f.existing.length} of these columns exist; they will be replaced.
          </p>
        )}
      </fieldset>
      <RunFooter
        run={f.latestRun}
        canRun={f.canRun && !f.busy}
        reason={
          f.runReason ?? (f.busy ? "Queued behind the running tool" : null)
        }
        onRun={run}
        targetLayerId={f.target?.id ?? null}
      />
    </form>
  );
}
```

`RunFooter.tsx` renders by `run?.status`: none/cancelled/undone → Cancel (ghost, `back()`) + Run (filled, `disabled={!canRun}`, reason under it); `queued` → "Queued behind …" + Cancel; `running`/`cancelling` → indeterminate bar (`<div className="processing-progress" role="progressbar" aria-busy="true">`), phase line "Loading extension ✓ · Reading source ✓ · Computing … · Writing results" with ticks for phases before the current one (M1 runs skip `extension` and `source`, show them ticked as "skipped"), elapsed timer (`useEffect` + `setInterval` 250 ms from `run.startedAt`), button "Cancel run" → `cancelRun(run.id)`; `done` → the card (§6.2): line, detail, "Wrote N columns to <target>.", buttons **Open table** (`activateLayer(targetLayerId)` then `useShellStore.getState().openDrawer()`), **Style by result** (`useShellStore.getState().requestSection(targetLayerId, "style")`; the rule draft prefill is Task 13), **Undo** (`undoRun(run.id)`, only when `run.undoable`), **Log** (`openLog(run.id)`), and **Run again** (filled; calls `onRun`); `failed` → "✕ Failed after X s", the error line, **Retry** (`onRun`) and **Log**. The `note` field renders as a muted line when set.

`RecentRuns.tsx` lists `runs` (newest first) with the dot (`data-status`), tool name, target (and "← source"), elapsed, status word, second line (summary or error), and buttons **Log**, **Undo** (undoable only), **Retry** (failed) or **Cancel** (queued/running), **Edit & run** (`openTool(toolId)` — the draft is already the last one). Stale runs read "stale: layer reloaded" with a Re-run.

`LogView.tsx`: header definition list (tool, target layer, source layer "—", scope "All · 1,115 buildings (frozen at 14:02:11)", LoD, building geometry "—", parameters, output columns with units, started, elapsed, status), then each `LogEntry` as label + `<pre>` SQL + "0.412 s · 1,116 rows", warnings, error, **Copy** (`navigator.clipboard.writeText(text)`; the text is assembled by a pure `formatRunLog(run): string` exported for the test), back chevron.

- [ ] **Step 4: CSS** — append rules for `.processing-tool`, `.processing-tool__head` (flex, gap 8), `.processing-tool__title` (Outfit 500 16px), `.processing-back` (30×30 ghost), `.processing-section` (border 0, padding 0, margin 0 0 14px), `.processing-field` (grid `64px 1fr`, gap 8, align-items center, margin-bottom 8; `select`/`input` full width at `--control-height-compact`), `.processing-radios` (column, gap 6, `label` flex gap 6, 12px), `.processing-note`/`.processing-columns` (11px muted; columns in `var(--font-mono)`), `.processing-error` (`--brand-accent`), `.processing-warning` (`--brand-secondary` text), `.processing-footer` (sticky bottom, border-top hairline, padding 10px 0, flex end, gap 8; Run = `min-height: var(--control-height)`, `background: var(--lime-500) !important; color: #1a2200 !important`), `.processing-progress` (3px bar with an animated 30% segment; `@media (prefers-reduced-motion: reduce)` static), `.processing-card` (lime hairline, 8px radius, padding 10), `.processing-run` rows for RecentRuns with `.processing-run__dot[data-status]` colours (done lime-500, failed brand-secondary, cancelled fg-dim, running pulsing lime, queued hollow).

- [ ] **Step 5: Run tests, tsc, browser** — `npx vitest run tests/unit/ui/processing && npx tsc -b --noEmit`; then `npm run dev`, Delft sample: Tools → Height from extent → Run: the footer shows the phases, then the card; Recent runs lists it; Undo works; the drawer (Open table) shows three new columns.

- [ ] **Step 6: Commit** — `git add src/ui/processing tests/unit/ui/processing && git commit -m "feat(processing): tool form, run footer, recent runs and log view"`.

---
