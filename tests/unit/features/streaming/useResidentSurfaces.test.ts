import { describe, it, expect, vi } from "vitest";
import { act, renderHook, cleanup, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { useObjectSurfaces } from "../../../../src/features/streaming/useResidentSurfaces";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { FcbStreamLayerHandle } from "@cityjson/navara-flatcitybuf";
import type { Surface } from "../../../../src/domain/citymodel/types";
import type { ObjectSurfaces } from "@cityjson/navara-flatcitybuf";

afterEach(() => {
  cleanup();
  useStreamStore.setState({ streams: {} });
});

/** Only `fetchSurfaces` is reached; the rest of the handle owns a worker and
 *  GPU meshes that jsdom cannot provide. */
function fakeHandle(
  fetchSurfaces: FcbStreamLayerHandle["fetchSurfaces"],
): FcbStreamLayerHandle {
  return { fetchSurfaces } as unknown as FcbStreamLayerHandle;
}

const SURFACES: Surface[] = [
  { type: "RoofSurface", rings: [], attributes: {}, lod: null },
];

/** A projected layer's answer: rings in the source CRS, so no local frame. */
const PROJECTED: ObjectSurfaces = { surfaces: SURFACES, frame: null };

/** A geographic layer's answer: rings in the owning cell's ENU metres, with
 *  the origin they are measured from. */
const CELL_ENU: ObjectSurfaces = {
  surfaces: SURFACES,
  frame: { kind: "enu", lngDeg: 139.6, latDeg: 35.46, heightM: 37.2 },
};

describe("useObjectSurfaces", () => {
  it("stays 'empty' and does not fetch when objectId is null (handle present)", () => {
    // `handle` is hoisted to a stable reference BEFORE renderHook, not
    // constructed inline in the render callback — a fresh object literal
    // there would change identity on every render, retriggering the
    // effect (whose deps include `handle`) forever. That's a test-fixture
    // trap, not a hook bug: caught by hand while writing this suite (see
    // task-15-report.md).
    const fetchSurfaces = vi.fn();
    const handle = fakeHandle(fetchSurfaces);
    const { result } = renderHook(() => useObjectSurfaces(handle, null));
    expect(result.current).toEqual({ status: "empty" });
    expect(fetchSurfaces).not.toHaveBeenCalled();
  });

  it("stays 'empty' and does not fetch when the handle is null", () => {
    const fetchSurfaces = vi.fn();
    const { result } = renderHook(() => useObjectSurfaces(null, "obj-1"));
    expect(result.current).toEqual({ status: "empty" });
    expect(fetchSurfaces).not.toHaveBeenCalled();
  });

  it("goes 'loading' immediately, then 'ready' once the handle resolves", async () => {
    let resolve!: (s: ObjectSurfaces) => void;
    const fetchSurfaces = vi.fn(
      () => new Promise<ObjectSurfaces>((r) => (resolve = r)),
    );
    const handle = fakeHandle(fetchSurfaces);

    const { result } = renderHook(() => useObjectSurfaces(handle, "obj-1"));
    expect(result.current).toEqual({ status: "loading" });
    expect(fetchSurfaces).toHaveBeenCalledWith("obj-1");

    await act(async () => {
      resolve(PROJECTED);
      await Promise.resolve();
    });

    expect(result.current).toEqual({
      status: "ready",
      surfaces: SURFACES,
      frame: null,
    });
  });

  it("carries the CELL frame a geographic layer's rings are measured in", async () => {
    // Since the geographic-to-ENU milestone a streamed cell is baked in its own
    // ENU frame, so these rings are local metres rather than source-CRS
    // coordinates. A consumer measuring area or slope can ignore that (those
    // are frame-independent, and a level cell frame measures them better than a
    // projection does); one placing a ring cannot, so the origin is published
    // rather than dropped on the floor here.
    const handle = fakeHandle(vi.fn().mockResolvedValue(CELL_ENU));
    const { result } = renderHook(() => useObjectSurfaces(handle, "obj-1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toEqual({
      status: "ready",
      surfaces: SURFACES,
      frame: CELL_ENU.frame,
    });
  });

  it("reports an error when the handle rejects (object not resident, or the layer was removed mid-request)", async () => {
    const handle = fakeHandle(
      vi.fn().mockRejectedValue(new Error("WorkerClient terminated")),
    );
    const { result } = renderHook(() => useObjectSurfaces(handle, "b1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect((result.current as { message: string }).message).toBe(
      "WorkerClient terminated",
    );
  });

  it("does not resurrect a rejected result after unmount (the cancelled guard covers the rejection path too)", async () => {
    let reject!: (e: Error) => void;
    const fetchSurfaces = vi.fn(
      () => new Promise<ObjectSurfaces>((_, r) => (reject = r)),
    );
    const handle = fakeHandle(fetchSurfaces);

    const { result, unmount } = renderHook(() =>
      useObjectSurfaces(handle, "obj-1"),
    );
    unmount();

    // If this rejection had no `.catch`, it would surface as an unhandled
    // promise rejection — vitest fails the run on those, so simply reaching
    // the assertion below is part of the proof.
    await act(async () => {
      reject(new Error("WorkerClient terminated"));
      await Promise.resolve();
    });

    expect(result.current).toEqual({ status: "loading" });
  });

  it("re-fetches when objectId changes", async () => {
    const empty: ObjectSurfaces = { surfaces: [], frame: null };
    const fetchSurfaces = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty);
    const handle = fakeHandle(fetchSurfaces);

    const { result, rerender } = renderHook(
      ({ objectId }: { objectId: string }) =>
        useObjectSurfaces(handle, objectId),
      { initialProps: { objectId: "a" } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toEqual({
      status: "ready",
      surfaces: [],
      frame: null,
    });

    rerender({ objectId: "b" });
    expect(fetchSurfaces).toHaveBeenCalledTimes(2);
    expect(fetchSurfaces).toHaveBeenNthCalledWith(2, "b");
  });

  it("ignores a stale response that resolves after objectId already changed", async () => {
    const resolvers: Array<(s: ObjectSurfaces) => void> = [];
    const fetchSurfaces = vi.fn(
      () => new Promise<ObjectSurfaces>((r) => resolvers.push(r)),
    );
    const handle = fakeHandle(fetchSurfaces);

    const { result, rerender } = renderHook(
      ({ objectId }: { objectId: string }) =>
        useObjectSurfaces(handle, objectId),
      { initialProps: { objectId: "a" } },
    );

    rerender({ objectId: "b" });
    expect(resolvers).toHaveLength(2);

    // Resolve the FIRST (now-stale) request after the second has started.
    await act(async () => {
      resolvers[0]!({
        surfaces: [
          { type: "WallSurface", rings: [], attributes: {}, lod: null },
        ],
        frame: null,
      });
      await Promise.resolve();
    });

    // Still loading — waiting on "b"'s request, the stale "a" response for
    // the unmounted-from-view object was discarded rather than applied.
    expect(result.current).toEqual({ status: "loading" });
  });

  it("re-fetches when the handle's stream commits (a LoD refetch changes the resident surfaces)", async () => {
    const fetchSurfaces = vi.fn().mockResolvedValue({
      surfaces: [],
      frame: null,
    } satisfies ObjectSurfaces);
    const handle = fakeHandle(fetchSurfaces);
    useStreamStore.setState({
      streams: { L: { handle, version: 1 } as never },
    });

    const { result } = renderHook(() => useObjectSurfaces(handle, "obj-1"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSurfaces).toHaveBeenCalledTimes(1);

    let resolveSecond!: (s: ObjectSurfaces) => void;
    fetchSurfaces.mockImplementationOnce(
      () => new Promise<ObjectSurfaces>((r) => (resolveSecond = r)),
    );
    await act(async () => {
      useStreamStore.getState().bumpVersion("L");
      await Promise.resolve();
    });
    expect(fetchSurfaces).toHaveBeenCalledTimes(2);
    expect(fetchSurfaces).toHaveBeenNthCalledWith(2, "obj-1");
    // Same object: the old surfaces stay up while the new ones load, rather
    // than flashing "Loading" on every commit.
    expect(result.current).toEqual({
      status: "ready",
      surfaces: [],
      frame: null,
    });

    await act(async () => {
      resolveSecond(PROJECTED);
      await Promise.resolve();
    });
    expect(result.current).toEqual({
      status: "ready",
      surfaces: SURFACES,
      frame: null,
    });
  });

  it("does not re-fetch when ANOTHER layer's stream commits", async () => {
    const fetchSurfaces = vi.fn().mockResolvedValue({
      surfaces: [],
      frame: null,
    } satisfies ObjectSurfaces);
    const handle = fakeHandle(fetchSurfaces);
    const other = fakeHandle(vi.fn());
    useStreamStore.setState({
      streams: {
        L: { handle, version: 1 } as never,
        M: { handle: other, version: 1 } as never,
      },
    });

    renderHook(() => useObjectSurfaces(handle, "obj-1"));
    await act(async () => {
      useStreamStore.getState().bumpVersion("M");
      await Promise.resolve();
    });
    expect(fetchSurfaces).toHaveBeenCalledTimes(1);
  });
});
