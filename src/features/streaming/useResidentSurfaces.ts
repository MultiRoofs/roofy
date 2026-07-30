/**
 * Fetches full ring geometry for one object on demand, via the worker's
 * `surfaces` message.
 *
 * `ResidentObjectRecord` (the payload shipped for every resident cell)
 * deliberately excludes `Surface.rings` — see the doc comment on
 * `ResidentObjectRecord` in workerProtocol.ts. The two main-thread consumers
 * that need rings (rooftop solar scoring in AnalysisTab, and the Surfaces
 * tab) act on exactly one selected object at a time, so this hook fetches
 * rings for that one object lazily instead of shipping every object's full
 * geometry on every cell fetch/recolor.
 *
 * Static (non-streaming) layers never use this — `CityObject.surfaces` is
 * already resident and synchronous, so callers keep using it directly and
 * only reach for this hook (with a non-null client) for streaming layers.
 */
import { useEffect, useState } from "react";
import type { Surface } from "../../domain/citymodel/types";
import type { WorkerClient } from "./workerClient";

export type SurfacesFetchState =
  | { readonly status: "empty" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly surfaces: ReadonlyArray<Surface> }
  | { readonly status: "error"; readonly message: string };

/**
 * `client`/`objectId` are `null` when there's nothing to fetch — no
 * selection, or a non-streaming layer that doesn't need this hook's result
 * at all. The hook still has to be called unconditionally on every render
 * (Rules of Hooks), so `null` is the "stay idle" signal rather than a
 * caller-side conditional hook call.
 */
export function useObjectSurfaces(
  client: WorkerClient | null,
  objectId: string | null,
): SurfacesFetchState {
  const [state, setState] = useState<SurfacesFetchState>({ status: "empty" });

  useEffect(() => {
    if (!client || !objectId) {
      setState({ status: "empty" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    void client.send({ type: "surfaces", objectId }).then((r) => {
      if (cancelled) return; // objectId/client changed or unmounted — stale
      if (r.type === "surfaceData") {
        // The wire type is `unknown[]` (workerProtocol.ts) because
        // postMessage can't carry a static type across the worker boundary.
        // fcb.worker.ts's `surfaces` handler builds this from
        // `obj.surfaces as unknown[]`, so it IS a `Surface[]` structurally —
        // this cast documents that contract rather than asserting something
        // unverified.
        setState({ status: "ready", surfaces: r.surfaces as Surface[] });
      } else if (r.type === "error") {
        setState({ status: "error", message: r.message });
      } else {
        setState({
          status: "error",
          message: `unexpected worker response for 'surfaces': ${r.type}`,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, objectId]);

  return state;
}
