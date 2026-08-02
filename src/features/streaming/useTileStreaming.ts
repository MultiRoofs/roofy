/**
 * The streaming driver: turns OrbitControls' `change` event into
 * footprint → probe → level → fetch/evict decisions for every streaming
 * layer, and applies the results to `useStreamStore`.
 *
 * The render loop is NOT the trigger. R3F's `useFrame` runs continuously, so
 * a frame-based settle timer never fires — the camera never appears "still"
 * to it. `enableDamping` with `dampingFactor: 0.1`
 * (`CitySceneR3F.tsx:963-964`) keeps OrbitControls' `change` event firing
 * while damping decays, which is exactly the "interaction has stopped"
 * signal this module needs, and nothing else in the app produces.
 *
 * Mounted from `CitySceneInner` (`src/scene/CitySceneR3F.tsx`) as
 * `useTileStreaming(sceneOriginRef, groundY)` — see that call site for why
 * it needs those two params instead of being a true zero-arg hook: streaming
 * cells and static-layer meshes must share ONE scene origin/ground plane or
 * they render misaligned (CitySceneR3F already maintains both as the
 * multi-layer shared anchor, established from the first-loaded layer).
 * `camera`/`controls` still come from `useThree()` (works from any component
 * under `<Canvas>`, per `OrbitControls`' `makeDefault` prop); layers/streams
 * come from the Zustand stores directly.
 */
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useLayerStore } from "../layers/layerStore";
import { useStreamStore, emptyCellEntry } from "./streamStore";
import { viewportFootprint } from "./viewportFootprint";
import { buildLadder, type LodSelection } from "./levelPolicy";
import type { CellKey } from "./tileGrid";
import {
  cellStatsFromGeometry,
  commitNormal,
  commitSwap,
  ladderEquals,
  lodToWireLabel,
  planCommit,
  type FetchedCell,
} from "./commitPlanner";
import { SETTLE_MS, LEVEL_SWAP_TIMEOUT_MS } from "./constants";
import type { WorkerResponse } from "./workerProtocol";
import type { BBox3, Vec3 } from "../../domain/citymodel/types";

// ---------------------------------------------------------------------
// Pure helpers — each independently unit- and mutation-tested.
//
// The commit planner itself (`planCommit`, `commitNormal`, `commitSwap` and
// the LoD/ladder/stats helpers around them) moved to
// `@cityjson/navara-flatcitybuf` in M7.5; only `groundYFromBBox` — which is
// about the app's Three scene, not the stream — stayed behind.
// ---------------------------------------------------------------------

/**
 * Same formula `CitySceneR3F.tsx` uses for its ground plane's Y position,
 * exported so both sides compute the identical value from the identical
 * (shared, multi-layer UNION) bbox — `CitySceneInner` calls this on
 * `computeUnionBBox(layers)` and passes the result into `useTileStreaming`
 * as `groundY`, rather than each streaming layer computing its own ground
 * from just its own bbox. That per-layer-vs-shared mismatch was flagged as
 * an open gap in an earlier draft of this module; resolved by having the
 * caller own the shared computation and pass it in (see `useTileStreaming`'s
 * `groundY` parameter) instead of this module recomputing it per layer.
 */
export function groundYFromBBox(bbox: BBox3 | null): number {
  if (!bbox) return 0;
  const extentZ = bbox[5] - bbox[2];
  return -extentZ / 2 - 0.01;
}

// ---------------------------------------------------------------------
// Settle/abort state machine.
// ---------------------------------------------------------------------

export interface SettleController {
  /** Call on every OrbitControls `change` event. */
  onChange(): void;
  /** Clears any pending timer and forgets first-change state (unmount). */
  dispose(): void;
}

/**
 * `change` fires repeatedly while `enableDamping` decays, so settling is a
 * classic debounce — EXCEPT the FIRST event of a burst needs its own
 * synchronous callback (abort in-flight work immediately, per the brief),
 * not just a reset timer. `awaitingFirst` resets once `onSettle` actually
 * fires, so the next burst gets its own `onFirstChange` call.
 */
export function createSettleController(opts: {
  readonly settleMs: number;
  readonly onFirstChange: () => void;
  readonly onSettle: () => void;
}): SettleController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let awaitingFirst = true;
  return {
    onChange() {
      if (awaitingFirst) {
        awaitingFirst = false;
        opts.onFirstChange();
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        awaitingFirst = true;
        opts.onSettle();
      }, opts.settleMs);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      awaitingFirst = true;
    },
  };
}

// ---------------------------------------------------------------------
// The driver.
// ---------------------------------------------------------------------

/**
 * Runs the full footprint → probe → level → fetch/evict pipeline for one
 * streaming layer's settled commit. Exported (not module-private) so it can
 * be driven directly in tests without a real OrbitControls/timer harness —
 * `useTileStreaming`'s own job is only to call this at the right time.
 *
 * Bumps its own epoch at the start (in addition to the one `onFirstChange`
 * already bumped when the interaction began). This double-bump is
 * deliberate, not an oversight: nothing captures the `onFirstChange` epoch
 * value for its own guard checks, so re-bumping here is the only way this
 * function gets an epoch value that is current as THIS commit starts, and
 * bumping twice per settle is harmless — `isCurrent` only ever compares
 * against "the latest bump", never counts how many happened.
 */
export async function commitStreamingLayer(
  layerId: string,
  camera: PerspectiveCamera,
  origin: Vec3,
  groundY: number,
): Promise<void> {
  const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
  const stream = useStreamStore.getState().get(layerId);
  if (!layer || !layer.isStreaming || !stream) return;

  const epoch = stream.client.newEpoch();

  // Everything below awaits the WorkerClient at least once, and terminate()
  // (the layer-removal teardown path, CitySceneR3F.tsx) now REJECTS every
  // promise it still has in flight rather than leaving it hanging — a real
  // race if the user pans right as a layer is removed. Caught here so that
  // race surfaces as, at worst, a status update (and only if the stream is
  // still registered for someone to show it to) rather than an unhandled
  // promise rejection.
  try {
    const footprint = viewportFootprint(camera, groundY, origin);

    let probeCount: number | null = null;
    if (footprint !== null) {
      useStreamStore.getState().setStatus(layerId, "probing");
      const probeResp = await stream.client.send({
        type: "probe",
        bbox: footprint.bbox,
      });
      if (!stream.client.isCurrent(epoch)) return;
      if (probeResp.type !== "probed") {
        const message =
          probeResp.type === "error"
            ? probeResp.message
            : `unexpected probe response: ${probeResp.type}`;
        useStreamStore.getState().setStatus(layerId, "error", message);
        return;
      }
      probeCount = probeResp.count;
    }

    const plan = planCommit({
      footprint,
      probeCount,
      grid: stream.grid,
      cache: stream.cache,
      prevLevel: stream.level,
      prevCommit: stream.lastCommit,
      prevLod: lastLod.get(layerId) ?? null,
      ladder: stream.ladder,
      lodMode: layer.lodMode,
      selectedLod: layer.selectedLod,
    });

    if (plan.kind === "too-far") {
      useStreamStore
        .getState()
        .setStatus(layerId, "too-far", `Zoom in (${plan.reason})`);
      return;
    }
    if (plan.kind === "skip") {
      useStreamStore.getState().setStatus(layerId, "idle");
      return;
    }
    if (footprint === null) return; // unreachable: plan.kind is "commit" only when footprint is non-null.

    useStreamStore.getState().setStatus(layerId, "fetching");
    const fetched = new Map<CellKey, FetchedCell>();
    let fetchError: string | null = null;

    const fetchPromise = stream.client
      .sendStreaming(
        {
          type: "fetch",
          bbox: footprint.bbox,
          level: plan.level,
          cells: [...plan.toFetch],
          lod: lodToWireLabel(plan.lod),
          rules: layer.rules,
          rulesEnabled: layer.rulesEnabled,
        },
        (msg: WorkerResponse) => {
          if (msg.type === "cell") {
            fetched.set(msg.key, {
              entry: {
                geometry: msg.geometry,
                objects: msg.objects,
                surfaceAttrKeys: msg.surfaceAttrKeys,
                lodsSeen: msg.lodsSeen,
                // Snapshot of what THIS fetch asked the worker to bake into
                // `geometry.ruleColors` — `layer` is this call's own local,
                // never reassigned, so every cell from this commit is
                // stamped identically even if the user edits a rule while
                // it's still in flight (see CellEntry's doc comment).
                builtWithRulesEnabled: layer.rulesEnabled,
                builtWithRules: layer.rules,
              },
              stats: cellStatsFromGeometry(msg.geometry),
            });
          } else if (msg.type === "error") {
            fetchError = msg.message;
          }
        },
      )
      .then(() => "done" as const);

    const outcome = plan.isSwap
      ? await Promise.race([
          fetchPromise,
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), LEVEL_SWAP_TIMEOUT_MS),
          ),
        ])
      : await fetchPromise;

    if (!stream.client.isCurrent(epoch)) return;

    if (outcome === "timeout") {
      // notify() is genuinely fire-and-forget (workerClient.ts): unlike the
      // old send()-based cancel, it registers no pending entry, so there is
      // nothing here for a terminate()-triggered rejection to leak — no
      // `.catch()` needed, and none of the "not awaited, needs its own
      // catch" reasoning that applied to send() applies to it.
      stream.client.notify({ type: "cancel" });
      if (fetched.size > 0) {
        // The worker may have gone on to fully decode and cache some (or
        // all) of these cells anyway, right as the deadline passed — cancel
        // above only helps if it's still mid-flight. Either way, THIS
        // commit never adopts them (the timeout branch returns without
        // calling commitNormal/commitSwap), so the worker must not keep
        // them either, or they become worker-only cache entries the main
        // thread's evict can never reach (B3, 2026-07-28 final review).
        stream.client.notify({ type: "evict", cells: [...fetched.keys()] });
      }
      useStreamStore
        .getState()
        .setStatus(
          layerId,
          "error",
          "Level swap timed out; kept the previous level",
        );
      return;
    }
    if (fetchError !== null) {
      useStreamStore.getState().setStatus(layerId, "error", fetchError);
      return;
    }

    // Every key this commit actually asked for (`plan.toFetch`) that did NOT
    // come back as a 'cell' message was genuinely queried and found empty —
    // the worker only emits 'cell' for a populated bucket (fcb.worker.ts).
    // Backfilling a zero-triangle entry for it here is what makes it count
    // as RESIDENT (`cache.has(key)` true) from now on; without this, an
    // empty cell was indistinguishable from "never fetched," so
    // `planCommit`'s `missing` filter kept treating it as a hole forever —
    // bypassing hysteresis and re-running full selection/decode on every
    // settle for any viewport with even one sparse cell (B5, 2026-07-28
    // final review).
    for (const key of plan.toFetch) {
      if (!fetched.has(key)) {
        fetched.set(key, {
          entry: emptyCellEntry(layer.rulesEnabled, layer.rules),
          stats: { triangles: 0, bytes: 0 },
        });
      }
    }

    // Fold this commit's observed LoD labels into the layer's persisted
    // ladder (B1, 2026-07-28 final review). Previously the worker always
    // reported `lodsSeen: []`, so `stream.ladder` never grew past its
    // initial `[]` and `resolveLod`'s auto mode (`lodForCellSize`) always
    // fell back to "no filter" — loading every LoD, forever. A UNION with
    // the existing ladder (not a replacement) makes this a monotonically
    // growing, persisted record of every label ever seen for this layer,
    // never shrinking as cells are evicted.
    const observedLods: string[] = [];
    for (const { entry } of fetched.values())
      observedLods.push(...entry.lodsSeen);
    if (observedLods.length > 0) {
      const newLadder = buildLadder([...stream.ladder, ...observedLods]);
      if (!ladderEquals(newLadder, stream.ladder)) {
        useStreamStore.getState().setLadder(layerId, newLadder);
      }
    }

    const evicted = plan.isSwap
      ? commitSwap(stream.cache, plan.desired, fetched)
      : commitNormal(stream.cache, plan.desired, fetched);

    if (evicted.length > 0) {
      // Same fire-and-forget rationale as the cancel above: notify() needs
      // no catch, unlike the send()-based version this replaced.
      stream.client.notify({ type: "evict", cells: evicted });
    }

    lastLod.set(layerId, plan.lod);
    const latest = useStreamStore.getState().get(layerId);
    if (!latest) return; // layer was removed while the fetch was in flight.
    useStreamStore.getState().register(layerId, {
      ...latest,
      level: plan.level,
      lastCommit: plan.commitView,
      status: "idle",
      message: null,
    });
    if (fetched.size > 0 || evicted.length > 0) {
      useStreamStore.getState().bumpVersion(layerId);
    }
  } catch (err) {
    if (useStreamStore.getState().get(layerId)) {
      useStreamStore
        .getState()
        .setStatus(
          layerId,
          "error",
          err instanceof Error ? err.message : String(err),
        );
    }
  }
}

/**
 * "The LoD selection the currently resident cells were fetched under", per
 * layer. Deliberately NOT part of `StreamState`: it's the driver's own
 * bookkeeping for detecting a LoD change (see `planCommit`'s `lodChanged`
 * comment), not state another consumer needs to read.
 */
const lastLod = new Map<string, LodSelection>();

/**
 * @param sceneOriginRef The scene's shared multi-layer origin offset
 *   (`CitySceneR3F.tsx`'s `sceneOriginRef`), passed in rather than recomputed
 *   here so a streaming layer's footprint math agrees with where its cell
 *   meshes actually get placed by the scene (both derive from the SAME
 *   value — see `CitySceneR3F.tsx`'s mesh-management effect, which sets this
 *   ref from the first-loaded layer, streaming or not). Read fresh via
 *   `.current` inside the change handler (never stale, no extra dependency).
 * @param groundY The scene's shared ground-plane Y (`CitySceneInner`'s own
 *   `groundY` memo, `computeUnionBBox(layers)` run through `groundYFromBBox`)
 *   — likewise passed in so streaming and static layers agree on where "the
 *   ground" is. Captured in a ref (not a dependency) so this effect doesn't
 *   re-subscribe every time it changes, matching the existing "layers isn't
 *   a dependency either" design below.
 */
export function useTileStreaming(
  sceneOriginRef: RefObject<Vec3 | null>,
  groundY: number,
): void {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  const controllers = useRef<Map<string, SettleController>>(new Map());
  const groundYRef = useRef(groundY);
  groundYRef.current = groundY;

  useEffect(() => {
    if (!controls) return;
    // Captured once for this effect instance rather than read via
    // `controllers.current` inside the handler/cleanup — `controllers`
    // itself is a plain bookkeeping ref that React never reassigns, but
    // reading `.current` directly inside a cleanup trips
    // `react-hooks/exhaustive-deps`, and this is the pattern it recommends.
    const map = controllers.current;

    const handleChange = () => {
      const streamingLayers = useLayerStore
        .getState()
        .layers.filter((l) => l.isStreaming);
      const activeIds = new Set(streamingLayers.map((l) => l.id));

      for (const [id, controller] of map) {
        if (!activeIds.has(id)) {
          controller.dispose();
          map.delete(id);
        }
      }

      for (const layer of streamingLayers) {
        let controller = map.get(layer.id);
        if (!controller) {
          controller = createSettleController({
            settleMs: SETTLE_MS,
            onFirstChange: () => {
              const stream = useStreamStore.getState().get(layer.id);
              if (!stream) return;
              stream.client.newEpoch();
              // notify() is genuinely fire-and-forget (workerClient.ts): no
              // pending entry is registered, so there is nothing for a
              // terminate()-triggered rejection to leak and no catch needed.
              stream.client.notify({ type: "cancel" });
            },
            onSettle: () => {
              const origin: Vec3 = sceneOriginRef.current ?? [0, 0, 0];
              void commitStreamingLayer(
                layer.id,
                camera,
                origin,
                groundYRef.current,
              );
            },
          });
          map.set(layer.id, controller);
        }
        controller.onChange();
      }
    };

    controls.addEventListener("change", handleChange);
    return () => {
      controls.removeEventListener("change", handleChange);
      for (const controller of map.values()) {
        controller.dispose();
      }
      map.clear();
    };
    // `layers` is intentionally not a dependency: the handler re-reads
    // `useLayerStore.getState()` fresh on every `change` event instead, so
    // this effect only needs to re-subscribe when the controls instance or
    // camera identity itself changes — not on every layer store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, camera]);

  // A manual LoD change — `setLayerLod`/`setLodMode` from LodSelector.tsx —
  // never touches OrbitControls, so nothing above would ever notice one:
  // `commitStreamingLayer` only ever runs from a settled camera interaction.
  // Left unhandled, the user's choice sat inert until the next unrelated
  // pan/zoom happened to re-evaluate `planCommit`'s `lodChanged` (B1,
  // 2026-07-28 final review). This is a SEPARATE effect (not folded into the
  // one above) because it reacts to the layer store, not to `controls`.
  const lodSignature = useLayerStore((s) => {
    let key = "";
    for (const layer of s.layers) {
      if (!layer.isStreaming) continue;
      key += `${layer.id}:${layer.lodMode}:${layer.selectedLod ?? ""};`;
    }
    return key;
  });
  const prevLodKeys = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const streamingLayers = useLayerStore
      .getState()
      .layers.filter((l) => l.isStreaming);
    const seen = new Set<string>();
    for (const layer of streamingLayers) {
      seen.add(layer.id);
      const key = `${layer.lodMode}:${layer.selectedLod ?? ""}`;
      const prev = prevLodKeys.current.get(layer.id);
      prevLodKeys.current.set(layer.id, key);
      // `prev === undefined` means this is the layer's FIRST time appearing
      // in this signature (just opened, or this effect's first run) — not a
      // user-driven change, so no forced commit; its initial commit already
      // happens via the normal camera-settle path.
      if (prev === undefined || prev === key) continue;
      const origin: Vec3 = sceneOriginRef.current ?? [0, 0, 0];
      void commitStreamingLayer(layer.id, camera, origin, groundYRef.current);
    }
    // Non-blocking cleanup (2026-07-28 final review): `lastLod` is a
    // module-level Map keyed by layer id with no other removal path, so a
    // deleted layer's entry would otherwise linger for the lifetime of the
    // tab.
    // Deleting the CURRENT key from a Map mid-iteration is well-defined (the
    // key was already visited, so it isn't revisited or skipped) — no
    // defensive array copy needed before iterating, same convention as
    // CitySceneR3F.tsx's syncStreamingCells.
    for (const id of prevLodKeys.current.keys()) {
      if (!seen.has(id)) {
        prevLodKeys.current.delete(id);
        lastLod.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lodSignature, camera]);
}
