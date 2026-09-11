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
