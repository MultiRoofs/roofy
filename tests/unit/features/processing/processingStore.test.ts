import { afterEach, describe, expect, it } from "vitest";
import {
  useProcessingStore,
  type ToolDraft,
} from "../../../../src/features/processing/processingStore";
import type { RunRecord } from "../../../../src/features/processing/types";

function run(id: string, patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    toolId: "height-from-extent",
    targetLayerId: "L1",
    targetName: "Delft",
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 2,
    featureIds: null,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: ["extent_height_m"],
    status: "queued",
    phase: null,
    startedAt: 0,
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    note: null,
    ...patch,
  };
}

afterEach(() => useProcessingStore.getState().resetForTest());

describe("processingStore", () => {
  it("opens on the catalogue and toggles closed", () => {
    const s = useProcessingStore.getState();
    expect(s.open).toBe(false);
    s.setOpen(true);
    expect(useProcessingStore.getState().view).toEqual({ kind: "catalogue" });
    useProcessingStore.getState().toggle();
    expect(useProcessingStore.getState().open).toBe(false);
  });

  it("keeps a draft per tool and restores it on return", () => {
    const s = useProcessingStore.getState();
    s.openTool("height-from-extent");
    const draft: ToolDraft = {
      targetLayerId: "L1",
      scope: "selected",
      lod: null,
      prefix: "h_",
      params: {},
    };
    s.setDraft("height-from-extent", draft);
    s.back();
    expect(useProcessingStore.getState().view).toEqual({ kind: "catalogue" });
    s.openTool("height-from-extent");
    expect(useProcessingStore.getState().drafts["height-from-extent"]).toEqual(
      draft,
    );
  });

  it("keeps runs newest first, capped at 20", () => {
    const s = useProcessingStore.getState();
    for (let i = 0; i < 22; i += 1) s.upsertRun(run(`r${i}`));
    const runs = useProcessingStore.getState().runs;
    expect(runs).toHaveLength(20);
    expect(runs[0]?.id).toBe("r21");
    s.patchRun("r21", { status: "done" });
    expect(useProcessingStore.getState().runs[0]?.status).toBe("done");
  });

  it("counts unseen failures until the panel opens", () => {
    const s = useProcessingStore.getState();
    s.upsertRun(run("r1", { status: "failed", error: "boom" }));
    expect(useProcessingStore.getState().unseenFailure).toBe(true);
    s.setOpen(true);
    expect(useProcessingStore.getState().unseenFailure).toBe(false);
  });

  it("clears an unseen failure whenever a view opens the panel", () => {
    const s = useProcessingStore.getState();
    s.upsertRun(run("r1", { status: "failed", error: "boom" }));
    expect(useProcessingStore.getState().unseenFailure).toBe(true);
    s.openTool("height-from-extent");
    expect(useProcessingStore.getState().unseenFailure).toBe(false);

    useProcessingStore.setState({ open: false, unseenFailure: true });
    s.openLog("r1");
    expect(useProcessingStore.getState().unseenFailure).toBe(false);
  });

  it("ignores a patch for a run it does not hold", () => {
    const s = useProcessingStore.getState();
    s.patchRun("nope", { status: "failed", error: "boom" });
    expect(useProcessingStore.getState().unseenFailure).toBe(false);
  });

  it("remembers a dismissed result card, once, and forgets it on reset", () => {
    const store = useProcessingStore.getState();
    expect(store.dismissedRunIds).toEqual([]);
    store.dismissRun("r1");
    store.dismissRun("r1");
    store.dismissRun("r2");
    expect(useProcessingStore.getState().dismissedRunIds).toEqual(["r2", "r1"]);
    useProcessingStore.getState().resetForTest();
    expect(useProcessingStore.getState().dismissedRunIds).toEqual([]);
  });

  it("publishes a notice with a sequence number", () => {
    const s = useProcessingStore.getState();
    s.pushNotice("done");
    const { notice, noticeSeq } = useProcessingStore.getState();
    expect(notice).toBe("done");
    expect(noticeSeq).toBe(1);
  });
});
