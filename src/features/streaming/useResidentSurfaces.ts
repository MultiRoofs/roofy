/**
 * Fetches full ring geometry for one object on demand, via the streaming
 * layer's handle.
 *
 * `ResidentObjectRecord` (the payload shipped for every resident cell)
 * deliberately excludes `Surface.rings` — see the doc comment on
 * `ResidentObjectRecord` in the plugin's workerProtocol. The two main-thread
 * consumers that need rings (rooftop solar scoring, and the
 * Surfaces tab) act on exactly one selected object at a time, so this hook
 * fetches rings for that one object lazily instead of shipping every object's
 * full geometry on every cell fetch/recolor.
 *
 * Static (non-streaming) layers never use this — `CityObject.surfaces` is
 * already resident and synchronous, so callers keep using it directly and
 * only reach for this hook (with a non-null handle) for streaming layers.
 */
import { useEffect, useState } from "react";
import type { FcbStreamLayerHandle } from "@cityjson/navara-flatcitybuf";
import type { Surface } from "../../domain/citymodel/types";

export type SurfacesFetchState =
  | { readonly status: "empty" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly surfaces: ReadonlyArray<Surface> }
  | { readonly status: "error"; readonly message: string };

/**
 * `handle`/`objectId` are `null` when there's nothing to fetch — no
 * selection, or a non-streaming layer that doesn't need this hook's result
 * at all. The hook still has to be called unconditionally on every render
 * (Rules of Hooks), so `null` is the "stay idle" signal rather than a
 * caller-side conditional hook call.
 */
export function useObjectSurfaces(
  handle: FcbStreamLayerHandle | null,
  objectId: string | null,
): SurfacesFetchState {
  const [state, setState] = useState<SurfacesFetchState>({ status: "empty" });

  useEffect(() => {
    if (!handle || !objectId) {
      setState({ status: "empty" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    // No response-shape branch any more: `fetchSurfaces` types its result and
    // REJECTS both for a worker error and for an object that is not resident
    // in any cached cell, so every failure arrives on the one path below.
    handle
      .fetchSurfaces(objectId)
      .then((surfaces) => {
        if (cancelled) return; // objectId/handle changed or unmounted — stale
        setState({ status: "ready", surfaces });
      })
      .catch((err: unknown) => {
        // A layer removed mid-request terminates its WorkerClient, which
        // REJECTS every in-flight send() (workerClient.ts's terminate()
        // contract) instead of leaving it hanging — without this `.catch`,
        // that rejection had no handler at all and surfaced as an unhandled
        // promise rejection (non-blocking finding, 2026-07-28 final review).
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [handle, objectId]);

  return state;
}
