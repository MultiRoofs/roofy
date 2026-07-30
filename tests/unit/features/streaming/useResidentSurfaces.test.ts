import { describe, it, expect, vi } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { useObjectSurfaces } from "../../../../src/features/streaming/useResidentSurfaces";
import type { WorkerClient } from "../../../../src/features/streaming/workerClient";
import type { WorkerResponse } from "../../../../src/features/streaming/workerProtocol";

afterEach(() => {
  cleanup();
});

function fakeClient(send: WorkerClient["send"]): WorkerClient {
  return { send } as unknown as WorkerClient;
}

describe("useObjectSurfaces", () => {
  it("stays 'empty' and does not call send when objectId is null (client present)", () => {
    // `client` is hoisted to a stable reference BEFORE renderHook, not
    // constructed inline in the render callback — a fresh object literal
    // there would change identity on every render, retriggering the
    // effect (whose deps include `client`) forever. That's a test-fixture
    // trap, not a hook bug: caught by hand while writing this suite (see
    // task-15-report.md).
    const send = vi.fn();
    const client = fakeClient(send);
    const { result } = renderHook(() => useObjectSurfaces(client, null));
    expect(result.current).toEqual({ status: "empty" });
    expect(send).not.toHaveBeenCalled();
  });

  it("stays 'empty' and does not call send when objectId is null", () => {
    const send = vi.fn();
    const { result } = renderHook(() => useObjectSurfaces(null, "obj-1"));
    expect(result.current).toEqual({ status: "empty" });
    expect(send).not.toHaveBeenCalled();
  });

  it("goes 'loading' immediately, then 'ready' once the worker resolves", async () => {
    let resolve!: (r: WorkerResponse) => void;
    const send = vi.fn(() => new Promise<WorkerResponse>((r) => (resolve = r)));
    const client = fakeClient(send);

    const { result } = renderHook(() => useObjectSurfaces(client, "obj-1"));
    expect(result.current).toEqual({ status: "loading" });
    expect(send).toHaveBeenCalledWith({ type: "surfaces", objectId: "obj-1" });

    const surfaces = [
      { type: "RoofSurface", rings: [], attributes: {}, lod: null },
    ];
    await act(async () => {
      resolve({
        type: "surfaceData",
        id: 1,
        objectId: "obj-1",
        surfaces,
      });
      await Promise.resolve();
    });

    expect(result.current).toEqual({ status: "ready", surfaces });
  });

  it("goes 'loading' then 'error' when the worker reports an error", async () => {
    let resolve!: (r: WorkerResponse) => void;
    const send = vi.fn(() => new Promise<WorkerResponse>((r) => (resolve = r)));
    const client = fakeClient(send);

    const { result } = renderHook(() => useObjectSurfaces(client, "obj-1"));

    await act(async () => {
      resolve({
        type: "error",
        id: 1,
        message: "not resident",
        aborted: false,
      });
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      status: "error",
      message: "not resident",
    });
  });

  it("treats an unexpected response type as an error rather than hanging in 'loading'", async () => {
    let resolve!: (r: WorkerResponse) => void;
    const send = vi.fn(() => new Promise<WorkerResponse>((r) => (resolve = r)));
    const client = fakeClient(send);

    const { result } = renderHook(() => useObjectSurfaces(client, "obj-1"));

    await act(async () => {
      resolve({ type: "done", id: 1 });
      await Promise.resolve();
    });

    expect(result.current.status).toBe("error");
  });

  it("re-fetches (a new send call) when objectId changes", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        type: "surfaceData",
        id: 1,
        objectId: "a",
        surfaces: [],
      })
      .mockResolvedValueOnce({
        type: "surfaceData",
        id: 2,
        objectId: "b",
        surfaces: [],
      });
    const client = fakeClient(send);

    const { result, rerender } = renderHook(
      ({ objectId }: { objectId: string }) =>
        useObjectSurfaces(client, objectId),
      { initialProps: { objectId: "a" } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toEqual({ status: "ready", surfaces: [] });

    rerender({ objectId: "b" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, {
      type: "surfaces",
      objectId: "b",
    });
  });

  it("ignores a stale response that resolves after objectId already changed", async () => {
    const resolvers: Array<(r: WorkerResponse) => void> = [];
    const send = vi.fn(
      () => new Promise<WorkerResponse>((r) => resolvers.push(r)),
    );
    const client = fakeClient(send);

    const { result, rerender } = renderHook(
      ({ objectId }: { objectId: string }) =>
        useObjectSurfaces(client, objectId),
      { initialProps: { objectId: "a" } },
    );

    rerender({ objectId: "b" });
    expect(resolvers).toHaveLength(2);

    // Resolve the FIRST (now-stale) request after the second has started.
    await act(async () => {
      resolvers[0]!({
        type: "surfaceData",
        id: 1,
        objectId: "a",
        surfaces: [
          { type: "WallSurface", rings: [], attributes: {}, lod: null },
        ],
      });
      await Promise.resolve();
    });

    // Still loading — waiting on "b"'s request, the stale "a" response for
    // the unmounted-from-view object was discarded rather than applied.
    expect(result.current).toEqual({ status: "loading" });
  });
});
