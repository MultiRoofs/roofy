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
 * `useTileStreaming()` is not mounted anywhere yet. No code path sets
 * `Layer.isStreaming = true` (that lands in Task 17), and Task 13's report
 * on the two-level scene map says explicitly that it doesn't call this
 * hook either. It is written to be mounted with a single
 * `useTileStreaming();` call inside `CitySceneInner` — it takes no props,
 * reading camera/controls via `useThree()` (works from any component under
 * `<Canvas>`, per `OrbitControls`' `makeDefault` prop) and layers/streams
 * via the Zustand stores directly. A later task both flips `isStreaming` and
 * consumes `CellEntry` into `LayerSceneState.cells`; until then this hook
 * has no live layer to act on, which is why its coverage below is a mix of
 * directly-tested pure functions plus one real-timers integration test, not
 * a live-camera end-to-end test — see the task report for the split.
 */
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useLayerStore, type Layer } from "../layers/layerStore";
import { useStreamStore, type CellEntry } from "./streamStore";
import { viewportFootprint, type Footprint } from "./viewportFootprint";
import {
  chooseLevel,
  lodForCellSize,
  cellSize,
  type LodSelection,
} from "./levelPolicy";
import { keysCovering, type CellKey, type Grid } from "./tileGrid";
import { CellCache, type CellStats } from "./cellCache";
import { shouldRefetch, type CommitView } from "./throttleGates";
import {
  SETTLE_MS,
  VIEWPORT_FEATURE_BUDGET,
  LEVEL_SWAP_TIMEOUT_MS,
} from "./constants";
import type { CellGeometry, WorkerResponse } from "./workerProtocol";
import { computeOriginOffset } from "../../scene/buildCityMesh";
import type { BBox3 } from "../../domain/citymodel/types";

// ---------------------------------------------------------------------
// Pure helpers — each independently unit- and mutation-tested.
// ---------------------------------------------------------------------

/**
 * `WorkerRequest['fetch'].lod` is `string | null` on the wire: it can carry
 * an EXACT label or "no filter" (`null`), but has no representation for
 * "unlabelled geometry only". This is not a gap introduced here:
 * `lodForCellSize` (Task 4, `levelPolicy.ts`) never actually PRODUCES
 * `{kind:"unlabelled"}` — a ladder of length 0 already maps to `"all"` per
 * the design doc's §9 — so `sel.kind === "unlabelled"` is unreachable from
 * `resolveLod` below today. Mapped to `null` (same as "all") rather than
 * silently miscompiled, and documented rather than "fixed" by widening
 * `workerProtocol.ts`, which is Phase C and out of this task's file list.
 */
export function lodToWireLabel(sel: LodSelection): string | null {
  return sel.kind === "exact" ? sel.lod : null;
}

/**
 * `layer.selectedLod === null` already means "do not filter" for a manual
 * layer — same meaning a non-streaming layer gives it — so it resolves to
 * `"all"`, not `"unlabelled"`.
 */
export function resolveLod(
  layer: Pick<Layer, "lodMode" | "selectedLod">,
  ladder: ReadonlyArray<string>,
  cellSizeM: number,
): LodSelection {
  if (layer.lodMode === "manual") {
    return layer.selectedLod === null
      ? { kind: "all" }
      : { kind: "exact", lod: layer.selectedLod };
  }
  return lodForCellSize(ladder, cellSizeM);
}

export function lodSelectionEquals(a: LodSelection, b: LodSelection): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "exact" && b.kind === "exact" ? a.lod === b.lod : true;
}

/** Bytes actually held post-decode, mirroring `CellCache`'s "measured after
 *  decode, not predicted" budget doc — `triangleCount` alone doesn't bound
 *  memory, and `ruleColors` is optional so it must be counted only when
 *  present. */
export function cellStatsFromGeometry(g: CellGeometry): CellStats {
  return {
    triangles: g.triangleCount,
    bytes:
      g.positions.byteLength +
      g.normals.byteLength +
      g.baseColors.byteLength +
      (g.ruleColors?.byteLength ?? 0) +
      g.objectIndices.byteLength +
      g.surfaceIndices.byteLength,
  };
}

/**
 * `layer.model.bbox` is expected to be a stub-model's own extent for a
 * streaming layer (set from the header extent at open time, Task 17), not
 * necessarily the multi-layer shared scene anchor `CitySceneR3F.tsx`
 * establishes from the FIRST loaded layer (design doc §10). A second
 * streaming layer sharing a scene with an already-anchored first layer would
 * need the SHARED anchor, not its own centre, for its footprint math to
 * agree with where its meshes actually get placed. That reconciliation is
 * out of scope while no code path ever sets `isStreaming = true`, and
 * `CitySceneR3F.tsx`'s shared origin ref is module-private — flagged here
 * rather than silently assumed correct for the multi-layer case.
 */
export function groundYFromBBox(bbox: BBox3 | null): number {
  if (!bbox) return 0;
  const extentZ = bbox[5] - bbox[2];
  return -extentZ / 2 - 0.01;
}

export interface PlanCommitInput {
  readonly footprint: Footprint | null;
  readonly probeCount: number | null;
  readonly grid: Grid;
  readonly cache: CellCache<CellEntry>;
  readonly prevLevel: number | null;
  readonly prevCommit: CommitView | null;
  readonly prevLod: LodSelection | null;
  readonly ladder: ReadonlyArray<string>;
  readonly lodMode: "auto" | "manual";
  readonly selectedLod: string | null;
}

export type CommitPlan =
  | { readonly kind: "too-far"; readonly reason: string }
  | { readonly kind: "skip" }
  | {
      readonly kind: "commit";
      readonly level: number;
      readonly lod: LodSelection;
      readonly desired: readonly CellKey[];
      readonly toFetch: readonly CellKey[];
      readonly isSwap: boolean;
      readonly commitView: CommitView;
    };

/**
 * The pure decision core: footprint → probe budget → level → desired/missing
 * → hysteresis. No I/O — every impure step (probing, fetching, committing to
 * the cache/store) happens around a call to this function in
 * `commitStreamingLayer`, which is why this function (not the hook) carries
 * the dedicated test coverage for the decision logic.
 */
export function planCommit(input: PlanCommitInput): CommitPlan {
  const { footprint } = input;
  if (footprint === null) return { kind: "too-far", reason: "footprint" };
  if (input.probeCount === null) return { kind: "too-far", reason: "no-probe" };
  if (input.probeCount > VIEWPORT_FEATURE_BUDGET) {
    return { kind: "too-far", reason: "feature-budget" };
  }

  const level = chooseLevel(input.grid, footprint.bbox);
  if (level === null) return { kind: "too-far", reason: "no-level" };

  const desired = keysCovering(input.grid, footprint.bbox, level);
  const missing = desired.filter((k) => !input.cache.has(k));
  const hasHoles = missing.length > 0;
  const levelChanged = level !== input.prevLevel;

  const lod = resolveLod(
    { lodMode: input.lodMode, selectedLod: input.selectedLod },
    input.ladder,
    cellSize(input.grid, level),
  );
  // A LoD change invalidates every resident cell AT THE CURRENT LEVEL the
  // same way a level change invalidates the whole old level: the geometry
  // cached under an unchanged key was decoded under the OLD lod. Once
  // hasHoles stops being true for those keys (they're already resident,
  // just stale), hysteresis could otherwise serve stale-lod geometry
  // indefinitely on a pan back to them. Treated as a swap for that reason,
  // even though the eviction-policy text only names level changes by name.
  const lodChanged =
    input.prevLod !== null && !lodSelectionEquals(lod, input.prevLod);
  const isSwap = levelChanged || lodChanged;

  const commitView: CommitView = {
    centre: footprint.centre,
    span: footprint.span,
  };
  if (!shouldRefetch(input.prevCommit, commitView, hasHoles, isSwap)) {
    return { kind: "skip" };
  }

  return {
    kind: "commit",
    level,
    lod,
    desired,
    toFetch: isSwap ? desired : missing,
    isSwap,
    commitView,
  };
}

export interface FetchedCell {
  readonly entry: CellEntry;
  readonly stats: CellStats;
}

/**
 * Normal commit. Touches every DESIRED cell — including ones already
 * resident — which is what protects an off-screen-but-cached cell from
 * being starved out by `evictToBudget` on the very next commit. Inserts
 * newly fetched cells, then evicts down to budget. Never calls `retain()`:
 * dropping every cell outside the viewport on a normal commit would force a
 * refetch on every pan-back and defeat the entire reason the cache exists.
 */
export function commitNormal(
  cache: CellCache<CellEntry>,
  desired: ReadonlyArray<CellKey>,
  fetched: ReadonlyMap<CellKey, FetchedCell>,
): CellKey[] {
  for (const key of desired) cache.touch(key);
  for (const [key, { entry, stats }] of fetched) cache.set(key, entry, stats);
  return cache.evictToBudget();
}

/**
 * Level/LoD swap — the ONLY situation that calls `retain()`. Insert the new
 * cover's cells, then drop everything else in one all-or-nothing step: the
 * old level's (or old LoD's) cells can never be reused. Call this only
 * after the WHOLE new cover has fetched successfully; on a
 * `LEVEL_SWAP_TIMEOUT_MS` timeout the caller must discard the partial fetch
 * and never call this, leaving the old level/cache untouched.
 */
export function commitSwap(
  cache: CellCache<CellEntry>,
  newCover: ReadonlyArray<CellKey>,
  fetched: ReadonlyMap<CellKey, FetchedCell>,
): CellKey[] {
  for (const [key, { entry, stats }] of fetched) cache.set(key, entry, stats);
  return cache.retain(newCover);
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
): Promise<void> {
  const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
  const stream = useStreamStore.getState().get(layerId);
  if (!layer || !layer.isStreaming || !stream) return;

  const epoch = stream.client.newEpoch();

  const origin = computeOriginOffset(layer.model);
  const groundY = groundYFromBBox(layer.model.bbox);
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
    void stream.client.send({ type: "cancel" });
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

  const evicted = plan.isSwap
    ? commitSwap(stream.cache, plan.desired, fetched)
    : commitNormal(stream.cache, plan.desired, fetched);

  if (evicted.length > 0) {
    void stream.client.send({ type: "evict", cells: evicted });
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
}

/**
 * "The LoD selection the currently resident cells were fetched under", per
 * layer. Deliberately NOT part of `StreamState`: it's the driver's own
 * bookkeeping for detecting a LoD change (see `planCommit`'s `lodChanged`
 * comment), not state another consumer needs to read.
 */
const lastLod = new Map<string, LodSelection>();

export function useTileStreaming(): void {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  const controllers = useRef<Map<string, SettleController>>(new Map());

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
              void stream.client.send({ type: "cancel" });
            },
            onSettle: () => {
              void commitStreamingLayer(layer.id, camera);
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
}
