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
        view: open ? s.view : { kind: "catalogue" },
        unseenFailure: open ? false : s.unseenFailure,
      })),
    toggle: () => get().setOpen(!get().open),
    openTool: (toolId) => set({ open: true, view: { kind: "tool", toolId } }),
    openLog: (runId) =>
      set((s) => ({ open: true, view: { kind: "log", runId, from: s.view } })),
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
      set((s) => ({
        runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        unseenFailure:
          s.unseenFailure || (patch.status === "failed" && !s.open),
      })),
    pushNotice: (text) =>
      set((s) => ({ notice: text, noticeSeq: s.noticeSeq + 1 })),
    resetForTest: () => set({ ...initial }),
  }),
);

export function runById(id: string): RunRecord | null {
  return useProcessingStore.getState().runs.find((r) => r.id === id) ?? null;
}
