import { create } from "zustand";
import type { RunRecord, Scope, ToolDestination, ToolId } from "./types";

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
  /** The SECOND layer a cross-layer run reads (spec §3), or null. */
  readonly sourceLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly prefix: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** §6's "Write to" radios. */
  readonly destination: ToolDestination;
  /**
   * What the user typed in §6's Name field, or null for "whatever the tool
   * would prefill".
   *
   * Null rather than the prefilled string, so a draft kept while the user
   * changes the TARGET follows the new target's name instead of freezing the
   * old one's — the same reason `lod` is dropped on a retarget.
   */
  readonly newLayerName: string | null;
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
  /**
   * Whether the right panel is collapsed, mirrored from the shell.
   *
   * A copy rather than a read because nothing under `features/` may import
   * from `ui/`, and the collapse is the shell's state — so the shell's own
   * setters push it here (`shellStore.ts`). It exists for ONE reason: "the
   * Tools tab is visible" is `open` AND `activeTab === "tools"` AND this, and
   * §4.1's amber dot is about exactly that.
   */
  readonly panelCollapsed: boolean;
  /** A failed run the user has not looked at yet (spec §4.1 amber dot). */
  readonly unseenFailure: boolean;
  /**
   * The analytics engine has stopped and is not coming back this session
   * (spec §6.1, minus its restart).
   *
   * It is ONE flag rather than a field per run because it is one fact about
   * the session: every backup table lived in the database that died, so no
   * run's Undo can restore anything, whatever its own `undoable` says. The
   * cards read this beside `undoable`; nothing clears it, because the status
   * bar's Retry reboots the engine without rebuilding the tables the backups
   * described.
   */
  readonly engineStopped: boolean;
  /** One-line toast text; `noticeSeq` increments so App can subscribe. */
  readonly notice: string | null;
  readonly noticeSeq: number;
}

interface ProcessingActions {
  setOpen(open: boolean): void;
  toggle(): void;
  setTab(tab: "tools" | "details"): void;
  /** The shell's `rightCollapsed`, mirrored. Called by `shellStore` only. */
  setPanelCollapsed(collapsed: boolean): void;
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
   *
   * FINISHED is done OR failed. §6.3's failed footer offers Retry and Log
   * only, and Retry repeats the run's FROZEN request — so while that card
   * stands there is no way to submit an edited one, and "Edit & run" would
   * open a form whose Run button is not there.
   */
  dismissFinishedRun(toolId: ToolId, targetLayerId: string): void;
  patchRun(id: string, patch: Partial<RunRecord>): void;
  /** Spec §6.1: the engine died. Called by the run queue's engine watcher. */
  markEngineStopped(): void;
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
  panelCollapsed: false,
  unseenFailure: false,
  engineStopped: false,
  notice: null,
  noticeSeq: 0,
};

/**
 * Spec §4.1: the amber dot turns off when "the Tools tab is opened" — which is
 * not the same as the toolbox being open. A failure that lands while DETAILS is
 * selected, or while the right panel is collapsed over both tabs, is one the
 * user has not seen, and the dot is the only thing that would say so.
 */
function toolsVisible(s: ProcessingState): boolean {
  return s.open && s.activeTab === "tools" && !s.panelCollapsed;
}

export const useProcessingStore = create<ProcessingState & ProcessingActions>(
  (set, get) => ({
    ...initial,
    setOpen: (open) =>
      set((s) => ({
        open,
        activeTab: open ? "tools" : s.activeTab,
        view: open ? s.view : { kind: "catalogue" },
        unseenFailure: open && !s.panelCollapsed ? false : s.unseenFailure,
      })),
    toggle: () => get().setOpen(!get().open),
    setTab: (activeTab) =>
      set((s) => ({
        activeTab,
        unseenFailure: toolsVisible({ ...s, activeTab })
          ? false
          : s.unseenFailure,
      })),
    setPanelCollapsed: (panelCollapsed) =>
      set((s) => ({
        panelCollapsed,
        unseenFailure: toolsVisible({ ...s, panelCollapsed })
          ? false
          : s.unseenFailure,
      })),
    // Opening the panel through a view is opening the panel: the amber dot
    // means "a failure you have not looked at", and the Tools tab is now up.
    // A collapsed panel still hides it — every caller here pairs the view with
    // `revealTools`, whose `setRightCollapsed(false)` mirrors in and clears it.
    openTool: (toolId) =>
      set((s) => ({
        open: true,
        activeTab: "tools",
        view: { kind: "tool", toolId },
        unseenFailure: s.panelCollapsed ? s.unseenFailure : false,
      })),
    openLog: (runId) =>
      set((s) => ({
        open: true,
        activeTab: "tools",
        view: { kind: "log", runId, from: s.view },
        unseenFailure: s.panelCollapsed ? s.unseenFailure : false,
      })),
    back: () =>
      set((s) =>
        s.view.kind === "log"
          ? { view: s.view.from }
          : { view: { kind: "catalogue" } },
      ),
    setSearch: (search) => set({ search }),
    setDraft: (toolId, draft) => {
      set((s) => ({ drafts: { ...s.drafts, [toolId]: draft } }));
      // §6.3's card has no Run button under it, so the first edit is what
      // gives the user one: a failed card the user has started editing away
      // from is gone, and its Retry stays reachable from Recent runs. Only a
      // FAILED one — a done card locks the form, and nothing in flight may
      // lose its progress block.
      const latest = get().runs.find(
        (r) => r.toolId === toolId && r.targetLayerId === draft.targetLayerId,
      );
      if (latest?.status === "failed") get().dismissRun(latest.id);
    },
    upsertRun: (run) =>
      set((s) => {
        const rest = s.runs.filter((r) => r.id !== run.id);
        return {
          runs: [run, ...rest].slice(0, MAX_RUNS),
          unseenFailure:
            s.unseenFailure || (run.status === "failed" && !toolsVisible(s)),
        };
      }),
    dismissRun: (id) =>
      set((s) =>
        s.dismissedRunIds.includes(id)
          ? {}
          : { dismissedRunIds: [id, ...s.dismissedRunIds].slice(0, MAX_RUNS) },
      ),
    dismissFinishedRun: (toolId, targetLayerId) => {
      // `runs` is newest first, so the first match IS the latest of the pair.
      const latest = get().runs.find(
        (r) => r.toolId === toolId && r.targetLayerId === targetLayerId,
      );
      if (latest?.status === "done" || latest?.status === "failed") {
        get().dismissRun(latest.id);
      }
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
            s.unseenFailure || (patch.status === "failed" && !toolsVisible(s)),
        };
      }),
    markEngineStopped: () => set({ engineStopped: true }),
    pushNotice: (text) =>
      set((s) => ({ notice: text, noticeSeq: s.noticeSeq + 1 })),
    resetForTest: () => set({ ...initial }),
  }),
);

export function runById(id: string): RunRecord | null {
  return useProcessingStore.getState().runs.find((r) => r.id === id) ?? null;
}
