import { describe, it, expect, vi } from "vitest";
import { act, renderHook, cleanup, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { useObjectSurfaces } from "../../../../src/features/streaming/useResidentSurfaces";
import type { FcbStreamLayerHandle } from "@cityjson/navara-flatcitybuf";
import type { Surface } from "../../../../src/domain/citymodel/types";

afterEach(() => {
  cleanup();
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
    let resolve!: (s: readonly Surface[]) => void;
    const fetchSurfaces = vi.fn(
      () => new Promise<readonly Surface[]>((r) => (resolve = r)),
    );
    const handle = fakeHandle(fetchSurfaces);

    const { result } = renderHook(() => useObjectSurfaces(handle, "obj-1"));
    expect(result.current).toEqual({ status: "loading" });
    expect(fetchSurfaces).toHaveBeenCalledWith("obj-1");

    await act(async () => {
      resolve(SURFACES);
      await Promise.resolve();
    });

    expect(result.current).toEqual({ status: "ready", surfaces: SURFACES });
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
      () => new Promise<readonly Surface[]>((_, r) => (reject = r)),
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
    const fetchSurfaces = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
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
    expect(result.current).toEqual({ status: "ready", surfaces: [] });

    rerender({ objectId: "b" });
    expect(fetchSurfaces).toHaveBeenCalledTimes(2);
    expect(fetchSurfaces).toHaveBeenNthCalledWith(2, "b");
  });

  it("ignores a stale response that resolves after objectId already changed", async () => {
    const resolvers: Array<(s: readonly Surface[]) => void> = [];
    const fetchSurfaces = vi.fn(
      () => new Promise<readonly Surface[]>((r) => resolvers.push(r)),
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
      resolvers[0]!([
        { type: "WallSurface", rings: [], attributes: {}, lod: null },
      ]);
      await Promise.resolve();
    });

    // Still loading — waiting on "b"'s request, the stale "a" response for
    // the unmounted-from-view object was discarded rather than applied.
    expect(result.current).toEqual({ status: "loading" });
  });
});
