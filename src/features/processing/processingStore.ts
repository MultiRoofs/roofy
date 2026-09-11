import { create } from "zustand";
import type { RunRecord, Scope, ToolId } from "./types";

export type ProcessingView =
  | { readonly kind: "catalogue" }
  | { readonly kind: "tool"; readonly toolId: ToolId }
  | {
      readonly kind: "log";
      readonly runId: string;
      readonly from: ProcessingView;
    };

/** The form's draft (spec §6: kept per tool for the session). */
export interface ToolDraft {
  readonly targetLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly prefix: string;
  readonly params: Readonly<Record<string, unknown>>;
}

const MAX_RUNS = 20;

interface ProcessingState {
  readonly open: boolean;
  /**
   * Spec §4.1/§4.2: which of the right panel's two tabs is up. It lives here,
   * not in `ProcessingPanel`, because the Tools button has to be able to SWITCH
   * to Tools — a click while Details is showing reveals the toolbox instead of
   * closing something the user cannot see.
   */
  readonly activeTab: "tools" | "details";
  readonly view: ProcessingView;
  readonly search: string;
  readonly drafts: Readonly<Partial<Record<ToolId, ToolDraft>>>;
  /** Newest first. */
  readonly runs: ReadonlyArray<RunRecord>;
  /**
   * Runs whose §6.2 result card the user has dismissed, newest first.
   *
   * It is store state, not view state, because two views act on it: "Run again"
   * puts the form back over the same draft, and Recent runs' "Edit & run" has to
   * clear the card of the run it is opening — §5 promises a form "so parameters
   * can be changed", not one locked under its own result. Capped with the
   * history it shadows.
   */
  readonly dismissedRunIds: ReadonlyArray<string>;
  /** A failed run the user has not looked at yet (spec §4.1 amber dot). */
  readonly unseenFailure: boolean;
  /** One-line toast text; `noticeSeq` increments so App can subscribe. */
  readonly notice: string | null;
  readonly noticeSeq: number;
}

interface ProcessingActions {
  setOpen(open: boolean): void;
  toggle(): void;
  setTab(tab: "tools" | "details"): void;
  openTool(toolId: ToolId): void;
  openLog(runId: string): void;
  back(): void;
  setSearch(search: string): void;
  setDraft(toolId: ToolId, draft: ToolDraft): void;
  upsertRun(run: RunRecord): void;
  /** §6.2 "Run again unlocks the form": hide this run's card, run nothing. */
  dismissRun(id: string): void;
  /**
   * Clear the result card the tool view would show for this (tool, target).
   *
   * The view watches the LATEST run of the pair, so the row the user clicked in
   * Recent runs is not necessarily the card in its way. A latest run that is
   * still in flight is left alone: §6.1 locks the form while it runs, and no
   * dismissal may take its progress block or its Cancel away.
   */
  dismissDoneRun(toolId: ToolId, targetLayerId: string): void;
  patchRun(id: string, patch: Partial<RunRecord>): void;
  pushNotice(text: string): void;
  resetForTest(): void;
}

const initial: ProcessingState = {
  open: false,
  activeTab: "tools",
  view: { kind: "catalogue" },
  search: "",
  drafts: {},
  runs: [],
  dismissedRunIds: [],
  unseenFailure: false,
  notice: null,
  noticeSeq: 0,
};

export const useProcessingStore = create<ProcessingState & ProcessingActions>(
  (set, get) => ({
    ...initial,
    setOpen: (open) =>
      set((s) => ({
        open,
        activeTab: open ? "tools" : s.activeTab,
        view: open ? s.view : { kind: "catalogue" },
        unseenFailure: open ? false : s.unseenFailure,
      })),
    toggle: () => get().setOpen(!get().open),
    setTab: (activeTab) => set({ activeTab }),
    // Opening the panel through a view is opening the panel: the amber dot
    // means "a failure you have not looked at", and the Tools tab is now up.
    openTool: (toolId) =>
      set({
        open: true,
        activeTab: "tools",
        view: { kind: "tool", toolId },
        unseenFailure: false,
      }),
    openLog: (runId) =>
      set((s) => ({
        open: true,
        activeTab: "tools",
        view: { kind: "log", runId, from: s.view },
        unseenFailure: false,
      })),
    back: () =>
      set((s) =>
        s.view.kind === "log"
          ? { view: s.view.from }
          : { view: { kind: "catalogue" } },
      ),
    setSearch: (search) => set({ search }),
    setDraft: (toolId, draft) =>
      set((s) => ({ drafts: { ...s.drafts, [toolId]: draft } })),
    upsertRun: (run) =>
      set((s) => {
        const rest = s.runs.filter((r) => r.id !== run.id);
        return {
          runs: [run, ...rest].slice(0, MAX_RUNS),
          unseenFailure:
            s.unseenFailure || (run.status === "failed" && !s.open),
        };
      }),
    dismissRun: (id) =>
      set((s) =>
        s.dismissedRunIds.includes(id)
          ? {}
          : { dismissedRunIds: [id, ...s.dismissedRunIds].slice(0, MAX_RUNS) },
      ),
    dismissDoneRun: (toolId, targetLayerId) => {
      // `runs` is newest first, so the first match IS the latest of the pair.
      const latest = get().runs.find(
        (r) => r.toolId === toolId && r.targetLayerId === targetLayerId,
      );
      if (latest?.status === "done") get().dismissRun(latest.id);
    },
    patchRun: (id, patch) =>
      set((s) => {
        // A patch for an id the history no longer holds (evicted past
        // MAX_RUNS, or reset under a late worker message) changes nothing —
        // least of all the dot, which would otherwise light for a run the
        // user can no longer open.
        const held = s.runs.some((r) => r.id === id);
        if (!held) return {};
        return {
          runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          unseenFailure:
            s.unseenFailure || (patch.status === "failed" && !s.open),
        };
      }),
    pushNotice: (text) =>
      set((s) => ({ notice: text, noticeSeq: s.noticeSeq + 1 })),
    resetForTest: () => set({ ...initial }),
  }),
);

export function runById(id: string): RunRecord | null {
  return useProcessingStore.getState().runs.find((r) => r.id === id) ?? null;
}
