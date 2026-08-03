/**
 * Navara viewport: owns the `ThreeView` lifecycle and exposes the imperative
 * {@link CitySceneHandle} `App.tsx` drives the camera through.
 *
 * Replacement for `CitySceneR3F.tsx` (spec 4.1). No React Three Fiber: Navara
 * is imperative, so the whole engine lives behind refs and focused effects, and
 * React only owns the DOM around it.
 *
 * SCOPE (Tasks B11b + B14 + B15): engine lifecycle, the photorealistic globe,
 * the static layer store -> `CityModelHandle` mirror (`handleSync.ts`)
 * including per-layer rule styling, fit/align against the live handles'
 * geodetic bounds, the triangle readout, the init-failure panel, and the
 * interaction hub — pointer events -> pick intents -> `selectionStore`,
 * selection/hover -> `setHighlight`, and the source-CRS cursor readout.
 *
 * This file is the ENGINE SEAM for interaction, and holds only that: which
 * engine event carries what, and how a screen point becomes an ECEF ray. Every
 * decision it feeds is pure and tested elsewhere — `pickEventHandlers.ts`
 * (nearest-hit routing, tool gating, drag suppression, intents),
 * `handleSync.ts` (the handle registries) and `cursorCrsReadout.ts` (geodetic
 * -> source CRS, throttling).
 *
 * Task C13 turned STREAMING on: the FlatCityBuf plugin joins the session's
 * ordered plugin list (registered before `view.init()`, which is the only
 * moment the engine accepts one), is published through `streamPlugin.ts` and
 * handed out by `getStreamingPlugin()`, and every open stream's handle joins
 * `streamsRef` — the second half of the one interaction registry, so a streamed
 * cell picks, highlights, fits and counts exactly like a static one. Only
 * STYLING branches (`setRules` vs `setStyle`), and every programmatic camera
 * move is bracketed by `suppressSettle` so it cannot masquerade as a gesture.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ThreeView, {
  getPickRay,
  radianToDegree,
  vector3ToGeodetic,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Vector2 } from "three";
// The engine-bound subpaths, NOT the package barrels: the barrels must stay
// importable from Node (Global Constraints -> NODE_IMPORT_SAFE = false).
import { CityJSONPlugin } from "@cityjson/navara-cityjson/plugin";
import { FlatCityBufPlugin } from "@cityjson/navara-flatcitybuf/plugin";
import type {
  EcefRay,
  GeodeticBounds,
  ScreenPoint,
} from "@cityjson/navara-cityjson";
import { useLayerStore } from "../features/layers/layerStore";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useSolarStore } from "../features/solar/solarStore";
import { useStreamStore } from "../features/streaming/streamStore";
import { setStreamPlugin } from "../features/streaming/streamPlugin";
import {
  closeAllStreamingLayers,
  closeStreamingLayer,
} from "../features/streaming/openStreamingLayer";
import {
  allInteractionHandles,
  interactionHandles,
  layerHeightOffset,
  syncHighlight,
  syncLayers,
  syncStreamState,
  syncStyles,
  totalTriangles,
  type HighlightMemo,
  type InteractionHandle,
  type LiveLayer,
  type StreamInteractionHandle,
  type StreamSyncMemo,
} from "./handleSync";
import {
  acceptsPointer,
  applyPickIntent,
  canvasPointOf,
  createClickGate,
  narrowToMode,
  pickIntentFor,
  resolveNearestHit,
  sameSelection,
} from "./pickEventHandlers";
import {
  createThrottle,
  crsFromGeodetic,
  epsgForLayer,
} from "./cursorCrsReadout";
import {
  createNavaraSession,
  NavaraSessionDisposedError,
  type NavaraSession,
} from "./navaraSession";
import { advanceTime } from "./timeAnimation";
import { siteEnuFrame, sunPositionFromEcef } from "./sunWriter";
import {
  alignCameraForBounds,
  cameraForBounds,
  unionGeodeticBounds,
  type GeographicCameraState,
} from "./geographicCamera";
import { ViewAlignButtons, type ViewDirection } from "./ViewAlignButtons";

export interface CitySceneHandle {
  fitAll: () => void;
  fitLayer: (layerId: string) => void;
  alignView: (direction: ViewDirection) => void;
  getCameraState: () => GeographicCameraState | null;
  setCameraState: (state: GeographicCameraState) => void;
  /** Resolves once the engine is live (`view.init()` + plugins registered);
   *  REJECTS with the init error if it never came up. App.tsx awaits this
   *  inside try/catch instead of a 100 ms setTimeout — see Task C20. */
  readonly ready: Promise<void>;
  /**
   * The live FlatCityBuf plugin, once the engine is up.
   *
   * A promise rather than the instance, because a `.fcb` open can be requested
   * during the first render — a share hash, a restored workspace — when the
   * plugin does not exist yet. Awaiting {@link ready} first means such a call
   * QUEUES instead of dereferencing a null ref, and an engine that never comes
   * up REJECTS this rather than leaving the caller hanging.
   */
  getStreamingPlugin(): Promise<FlatCityBufPlugin>;
}

export interface NavaraViewportProps {
  readonly onTriangleCount: (count: number) => void;
  readonly onFps?: (fps: number) => void;
  readonly onCursorPosition?: (
    pos: readonly [number, number, number] | null,
  ) => void;
  readonly onLayerError?: (layerId: string, message: string) => void;
}

type ViewInstance = InstanceType<typeof ThreeView>;

interface ReadyGate {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Serialises engine lifetimes across mounts. BROWSER-VERIFIED requirement, not
 * a precaution: `@navaramap/three` keeps its tile worker pool in a MODULE-LEVEL
 * singleton, so a second `view.init()` that starts before the first view's
 * `dispose()` has run `terminateWorkerPool()` throws "Worker pool has already
 * been initialized." and both views come up dead. React StrictMode's
 * mount/unmount/mount does exactly that.
 *
 * Every mount therefore queues behind this promise: it constructs nothing
 * until the previous view is gone, and a mount cancelled before its turn (the
 * StrictMode first pass) never constructs a view at all — so StrictMode boots
 * the engine exactly once instead of twice.
 *
 * Corollary: at most ONE `NavaraViewport` may be mounted at a time. That is an
 * engine constraint, not a design choice — {@link mountedViewports} enforces
 * it loudly in development.
 */
let engineSlot: Promise<unknown> = Promise.resolve();

/**
 * How many `NavaraViewport`s are mounted right now. StrictMode never pushes
 * this past 1 (its first pass is cleaned up before the second mounts), so
 * anything above 1 is a genuine second instance — which cannot come up until
 * the first unmounts, because of the worker-pool singleton above.
 */
let mountedViewports = 0;

function createReadyGate(): ReadyGate {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nobody may ever await it (the component can unmount first), so make sure a
  // rejection is never reported as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export const NavaraViewport = forwardRef<CitySceneHandle, NavaraViewportProps>(
  function NavaraViewport(props, ref) {
    const { onFps, onTriangleCount, onLayerError, onCursorPosition } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<ViewInstance | null>(null);
    const cityPluginRef = useRef<CityJSONPlugin | null>(null);
    /** The live FlatCityBuf plugin, or null before the engine is up (and after
     *  it goes away). Read through the ref everywhere: it is the difference
     *  between a streaming-capable session and a static-only one. */
    const flatPluginRef = useRef<FlatCityBufPlugin | null>(null);
    /** Why there is no FlatCityBuf plugin, when there is none. Reported to a
     *  caller that asks for one rather than swallowed — see
     *  {@link getStreamingPlugin}. */
    const flatPluginErrorRef = useRef<unknown>(null);
    /** The live static handles, keyed by layer id. A ref, not state: the
     *  engine owns the meshes, and re-rendering on a handle change would only
     *  invalidate the imperative callbacks below. */
    const liveRef = useRef(new Map<string, LiveLayer>());
    /** Streaming layer handles, keyed by layer id — the second half of the ONE
     *  interaction registry (`handleSync.ts`). Filled by the reconciliation
     *  effect below, which is what makes picking, highlighting, fit and the
     *  triangle readout cover streamed cells. */
    const streamsRef = useRef(new Map<string, InteractionHandle>());
    /** What each streaming handle was last told (rules / LoD / visibility). */
    const streamSyncRef = useRef(new Map<string, StreamSyncMemo>());
    const [engineReady, setEngineReady] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);
    /** Bumped by the sync effect when a layer was newly added, which is the
     *  only thing that triggers an automatic fit. */
    const [fitToken, setFitToken] = useState(0);
    const layers = useLayerStore((s) => s.layers);
    /**
     * Which layer ids currently have a stream registered, as one string.
     *
     * The reconciliation effect below reads the handles out of
     * `useStreamStore.getState()`, so it needs a reason to re-run when a stream
     * is opened or closed — but subscribing to `streams` itself would re-render
     * this component on every cell commit (a commit replaces that object; see
     * streamStore.ts's doc comment on exactly this hazard). The id set changes
     * only when a layer is opened or closed, which is precisely the beat this
     * effect cares about.
     */
    const streamIds = useStreamStore((s) =>
      Object.keys(s.streams).sort().join(" "),
    );

    // CitySceneHandle.ready — created eagerly so a consumer can await it before
    // the mount effect has run. Resolve-or-reject, never a hang: see the Shared
    // Interface Contract.
    //
    // RE-ARMABLE, and read through the ref EVERYWHERE (never captured in a
    // closure): the lifecycle cleanup below rejects the current gate and
    // installs a fresh one, because a gate whose engine has been torn down can
    // never settle by itself. StrictMode makes that subtle — it runs
    // setup/cleanup/setup against ONE render, so the second pass re-enters the
    // *same* effect closure, and a captured gate would be the one the first
    // pass's cleanup already rejected. Hence `readyRef.current` at use time,
    // and a getter on the imperative handle so a consumer always sees the live
    // promise rather than a dead one.
    const readyRef = useRef<ReadyGate | null>(null);
    readyRef.current ??= createReadyGate();

    // --- Engine lifecycle (StrictMode-safe, see navaraSession.ts) ---
    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        // Unreachable in practice — the div below is rendered unconditionally,
        // so React has attached the ref by the time this effect runs — but an
        // early `return` here would leave `ready` pending FOREVER, which is
        // the same hang class as the plugin-constructor escape fixed in B11a.
        // Resolve-or-reject, never a hang (Shared Interface Contract).
        const error = new Error(
          "NavaraViewport: the canvas container never mounted, so the engine cannot start.",
        );
        setInitError(error.message);
        // No re-arm: this is a hard, permanent failure, and returning without
        // a cleanup means nothing will ever try again.
        readyRef.current!.reject(error);
        return;
      }

      mountedViewports += 1;
      if (import.meta.env.DEV && mountedViewports > 1) {
        console.warn(
          `NavaraViewport: ${mountedViewports} instances are mounted at once. ` +
            "Navara's tile worker pool is a process-wide singleton, so only " +
            "one view can be live: the extra instances stay blank until the " +
            "first one unmounts. Render exactly one NavaraViewport.",
        );
      }

      let cancelled = false;
      let session: NavaraSession<ViewInstance> | null = null;
      // Captured, not read as `ref.current` from the cleanup below: the maps
      // outlive nothing here (a ref object is stable for the component's whole
      // life), and reading them once is what makes the cleanup provably
      // operate on the same registries this mount filled.
      const live = liveRef.current;
      const streams = streamsRef.current;
      const streamMemos = streamSyncRef.current;

      // ONE try/catch around the WHOLE queued body. Everything that can throw
      // lives inside it — a rejected predecessor, a plugin constructor on an
      // unsupported browser, `createView`, `init()`, an `afterInit` hook — so
      // there is no escape that leaves `ready` pending. Resolve-or-reject,
      // never a hang (Shared Interface Contract → CitySceneHandle.ready).
      const started = (async () => {
        try {
          // Our turn only comes once any previous view has been disposed. If
          // this mount was already torn down by then (StrictMode's first
          // pass), build nothing at all.
          await engineSlot;
          if (cancelled) return;

          // Constructed here so this component keeps typed refs; the session
          // only needs them in registration order (Task B8). There is no
          // `view.addPlugin` call anywhere in this component: the engine
          // rejects `addPlugin()` after `init()`, and this component never
          // holds the view before init has started, so the ordered list is the
          // ONLY registration point.
          const defaultPlugin = new DefaultPlugin();
          const cityPlugin = new CityJSONPlugin();
          // Streaming is the one OPTIONAL capability of the three: a build (or
          // a browser) in which this constructor throws must still show static
          // layers, so the failure is recorded and re-raised only at the point
          // someone actually asks to open a `.fcb` — unlike DefaultPlugin,
          // whose failure is the whole viewer's failure.
          let flatPlugin: FlatCityBufPlugin | null = null;
          try {
            flatPlugin = new FlatCityBufPlugin({
              // The component owns the container element, so it — not the
              // plugin — measures the viewport: `ThreeView` documents `canvas`
              // as a CONSTRUCTOR option, not a readable property (Task C4).
              // Same size source the pick path reads.
              getViewportSize: () => ({
                width: container.clientWidth,
                height: container.clientHeight,
              }),
            });
            flatPluginErrorRef.current = null;
          } catch (error) {
            flatPluginErrorRef.current = error;
            console.error(
              "NavaraViewport: the FlatCityBuf plugin could not be constructed, " +
                "so .fcb streaming is unavailable in this session. Static layers are unaffected.",
              error,
            );
          }

          session = createNavaraSession({
            // Task B1 finding 3: `Options` has NO `useNormal`. `shadow` is
            // init-time-only, and `picking` defaults to true but is spelled
            // out because the app depends on it. `animation` keeps the render
            // loop running every frame, which is what the FPS readout below
            // measures.
            createView: () =>
              new ThreeView({
                container,
                shadow: true,
                picking: true,
                animation: true,
              }),
            plugins: [
              {
                key: "default",
                instance: defaultPlugin,
                // Must run after `view.init()` — hence an afterInit hook
                // rather than a call next to the constructor.
                afterInit: () => void defaultPlugin.addDefaultPhotorealScene(),
              },
              { key: "cityjson", instance: cityPlugin },
              ...(flatPlugin === null
                ? []
                : [{ key: "flatcitybuf", instance: flatPlugin }]),
            ],
          });

          const result = await session.ready;
          if (cancelled) return;

          viewRef.current = result.view;
          cityPluginRef.current = cityPlugin;
          flatPluginRef.current = flatPlugin;
          // The `.fcb` open paths live in `useLayerFileLoader` and `App.tsx`,
          // nowhere near this component; `streamPlugin.ts` is the one place
          // they resolve the live plugin from (Task C12).
          setStreamPlugin(flatPlugin);
          setInitError(null);
          setEngineReady(true);
          // `readyRef.current`, never a captured gate: a cancelled predecessor
          // (StrictMode's first pass) has already re-armed it, and resolving
          // the retired one would leave this mount's consumers waiting.
          readyRef.current!.resolve();
        } catch (error) {
          // Torn down mid-init, or disposed before it went live: not a failure
          // anyone needs to see, the cleanup below still disposes, and the
          // cleanup has already rejected the gate this mount owned.
          if (cancelled || error instanceof NavaraSessionDisposedError) return;
          setInitError(error instanceof Error ? error.message : String(error));
          readyRef.current!.reject(error);
        }
      })();

      engineSlot = started;

      return () => {
        cancelled = true;
        mountedViewports -= 1;
        setEngineReady(false);
        viewRef.current = null;
        cityPluginRef.current = null;
        // Streaming state dies with the engine, and it has to be TOLD to: the
        // plugin's `dispose()` deletes every handle, but `streamStore` holds
        // the only other reference to them, so leaving its entries behind
        // would leave the layer panel, the inspector and the status bar
        // reading a handle whose worker has been terminated. Closing them here
        // releases those workers immediately and unregisters in one pass; the
        // later `session.dispose()` is idempotent over the same handles.
        const flatPlugin = flatPluginRef.current;
        flatPluginRef.current = null;
        setStreamPlugin(null);
        closeAllStreamingLayers(flatPlugin);
        streams.clear();
        streamMemos.clear();
        // SETTLE, then RE-ARM. Both halves are load-bearing:
        //   * settle — every `return` inside `started` above is guarded by
        //     `cancelled`, so once this cleanup has run nothing can ever
        //     resolve this gate. A consumer that grabbed `handle.ready` and is
        //     still awaiting it (App.tsx closes the last layer mid-init, and
        //     Task C20 replaces its 100 ms setTimeout with exactly that await)
        //     would wait forever. Resolve-or-reject, never a hang.
        //   * re-arm — a settled promise cannot be reused, and this component
        //     may well mount again: StrictMode does it immediately, and so
        //     does re-opening a file after `handleClose`. `createReadyGate`
        //     already attaches a `.catch`, so the rejection below is never
        //     reported as unhandled even when nobody was listening.
        readyRef.current!.reject(
          new Error(
            "NavaraViewport was unmounted before the 3D engine finished starting.",
          ),
        );
        readyRef.current = createReadyGate();
        // The handles die with the view; dropping them here means the next
        // mount re-adds every layer from the store instead of trusting stale
        // entries whose meshes have been disposed.
        live.clear();
        // The solar site died with them. `App.tsx` unmounts this component in
        // the same commit that empties the layer store (`handleClose`), so the
        // site effect below never gets to clear it — and a `latLon` with no
        // scene behind it is a sun readout for a model that is gone.
        useSolarStore.getState().setLatLon(null);
        useSolarStore.getState().setSunPosition(null);
        // `started` settles only after `session.ready` has, so by the time
        // this runs the session disposes synchronously — which is what lets
        // the next mount initialise a fresh worker pool. If `dispose()` itself
        // throws, the next mount's `await engineSlot` re-raises it into that
        // mount's catch: reported in its error panel, never a silent hang.
        engineSlot = started.then(() => session?.dispose());
      };
      // `[]`: the gate now lives entirely behind `readyRef`, so there is
      // nothing left for this effect to depend on. Re-running it would tear
      // the engine down and rebuild it for no reason.
    }, []);

    // --- FPS readout from the render loop ---
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view || !onFps) return;
      let frames = 0;
      let last = performance.now();
      const onPostRender = () => {
        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          onFps(Math.round((frames * 1000) / (now - last)));
          frames = 0;
          last = now;
        }
      };
      view.on("postRender", onPostRender);
      return () => view.off("postRender", onPostRender);
    }, [engineReady, onFps]);

    // --- camera helpers ---
    // Bounds come from the live handles, so a fit frames the model where it is
    // actually PLACED (the geoid offset is baked into `getBoundsGeodetic`).
    // With nothing registered the union is empty and a fit is a no-op rather
    // than a jump to a NaN camera. Deps stay `[]` on purpose: `liveRef` is a
    // ref, so `fitAll`'s identity is stable and the fit-once effect below
    // cannot be re-triggered by an unrelated store update.
    // Streaming layers are in the union too — an FCB-only workspace has NOTHING
    // in `liveRef`, so reading only that map would make "Fit all" a no-op for
    // the one layer on screen. A streaming handle answers from its FCB header
    // extent as soon as it is open (Task C14) — it does NOT wait for a first
    // commit, which would be unreachable — and `null` only once deleted, which
    // `unionGeodeticBounds` already skips.
    const boundsOf = useCallback((ids?: readonly string[]) => {
      const handles: InteractionHandle[] = [];
      for (const [id, entry] of liveRef.current) {
        if (ids && !ids.includes(id)) continue;
        handles.push(entry.handle);
      }
      for (const [id, handle] of streamsRef.current) {
        if (ids && !ids.includes(id)) continue;
        handles.push(handle);
      }
      const bounds: GeodeticBounds[] = [];
      for (const handle of handles) {
        const b = handle.getBoundsGeodetic();
        if (b) bounds.push(b);
      }
      return unionGeodeticBounds(bounds);
    }, []);

    /**
     * Run a camera mutation with the streaming settle controller deaf to the
     * camera burst it produces.
     *
     * `flyTo` emits a full `movestart`/`move`/`moveend` burst (Task B1's
     * `PROGRAMMATIC_MOVE_EMITS`), and a `moveend` is exactly what commits a
     * streaming layer — so without this, restoring a share link, fitting a
     * layer or aligning the view would immediately re-fetch tiles for a camera
     * the user never moved.
     *
     * `suppressSettleThenCommit`, not the bare `suppressSettle`: suppression on
     * its own leaves a commit OWED. Every camera event of the flight is
     * swallowed, so a fit that lands squarely on a city fetches NOTHING — the
     * viewport sits framed and empty until the user happens to nudge the
     * camera (reported from the M7.5 browser smoke). The plugin queues one
     * commit for the moment the suppression window closes, which is the
     * destination the user is about to look at. That applies to all four
     * callers, not just the fit: a share-link restore and an alignment land on
     * a viewport the user reads too.
     *
     * Deliberately the REF, not `getStreamingPlugin()`: a static-only workspace
     * has no FlatCityBuf plugin and must never block a `fitAll` on streaming
     * readiness. Fire-and-forget, so the `CitySceneHandle` methods stay `void`
     * — but REPORTED, not swallowed: the move runs inside the plugin's own
     * promise, so a throwing `flyTo`/`setCamera` becomes the rejection of a
     * promise nobody awaits. Without the `.catch` that is an unhandled
     * rejection with no stack pointing here (Task C13 fold-in); the no-plugin
     * branch above, by contrast, throws synchronously into its caller.
     */
    const withSettleSuppressed = useCallback((move: () => void): void => {
      const plugin = flatPluginRef.current;
      if (!plugin) {
        move();
        return;
      }
      plugin.suppressSettleThenCommit(move).catch((error: unknown) => {
        console.error(
          "NavaraViewport: a camera move failed inside the streaming settle-suppression window.",
          error,
        );
      });
    }, []);

    const fitAll = useCallback(() => {
      const view = viewRef.current;
      const bounds = boundsOf();
      if (!view || !bounds) return;
      withSettleSuppressed(() => view.flyTo(cameraForBounds(bounds)));
    }, [boundsOf, withSettleSuppressed]);

    const fitLayer = useCallback(
      (layerId: string) => {
        const view = viewRef.current;
        const bounds = boundsOf([layerId]);
        if (!view || !bounds) return;
        withSettleSuppressed(() => view.flyTo(cameraForBounds(bounds)));
      },
      [boundsOf, withSettleSuppressed],
    );

    const alignView = useCallback(
      (direction: ViewDirection) => {
        const view = viewRef.current;
        const bounds = boundsOf();
        if (!view || !bounds) return;
        // Instant, not animated: `setCamera` emits no camera events of its own
        // (Task C7), so an alignment cannot be mistaken for a user gesture.
        // Still suppressed: the engine's `idle` fires on any change, and the
        // suppression window is what keeps it from flushing a debounce.
        withSettleSuppressed(() =>
          view.setCamera(alignCameraForBounds(bounds, direction)),
        );
      },
      [boundsOf, withSettleSuppressed],
    );

    // --- layer store -> engine handles ---
    // The reconciliation itself lives in `handleSync.ts` (pure, unit-tested);
    // this effect only supplies the registry binding and reports the results.
    // Streaming layers are skipped by `syncLayers` — @cityjson/navara-flatcitybuf
    // creates and owns their meshes from M7.5 on.
    useEffect(() => {
      const plugin = cityPluginRef.current;
      if (!engineReady || !plugin) return;
      const before = liveRef.current.size;
      syncLayers(
        {
          get: (id) => plugin.getHandle(id),
          add: (layer) =>
            plugin.addCityModel(layer.model, {
              id: layer.id,
              crs: layer.model.metadata.referenceSystem,
              lod: layer.selectedLod,
            }),
        },
        layers,
        liveRef.current,
        (layerId, error) =>
          onLayerError?.(
            layerId,
            error instanceof Error ? error.message : String(error),
          ),
      );
      // Rule colors, after the handles exist so a newly added layer is styled
      // on the same pass it appears (Task B14). Memoised inside — a rule edit
      // repaints only the layer whose rules changed.
      syncStyles(layers, liveRef.current);
      onTriangleCount(
        totalTriangles(layers, liveRef.current, streamsRef.current),
      );
      // Only a NEW layer earns a camera move: a visibility toggle, a LoD
      // change or a rule edit must not yank the camera out from under the user.
      if (liveRef.current.size > before) setFitToken((t) => t + 1);
    }, [engineReady, layers, onTriangleCount, onLayerError]);

    // Fit once whenever a layer is newly added. Separate from the sync effect
    // so the fit runs after the handles exist and `boundsOf` can see them.
    useEffect(() => {
      if (fitToken === 0) return;
      fitAll();
    }, [fitToken, fitAll]);

    // --- stream store -> the interaction registry (Task C13) ---
    //
    // The streaming counterpart of the layer effect above, and the reason a
    // streamed cell can be picked, highlighted, fitted and counted at all:
    // `syncLayers` never puts a streaming layer in `liveRef` (the FlatCityBuf
    // plugin owns those meshes), so `streamsRef` is the ONLY way one reaches
    // the shared registry in `handleSync.ts`.
    useEffect(() => {
      if (!engineReady) return;
      const streams = streamsRef.current;
      const memos = streamSyncRef.current;
      const store = useStreamStore.getState();
      const unsubscribes: Array<() => void> = [];
      const present = new Set<string>();
      /** A streaming layer joined the registry on this pass — the streaming
       *  half of the layer effect's "only a NEW layer earns a camera move". */
      let added = false;

      for (const layer of layers) {
        if (!layer.isStreaming) continue;
        // The plugin opened the stream (`openStreamingLayer`), so a layer whose
        // handle is not registered yet is simply one whose open is still in
        // flight: `streamIds` brings this effect back when it lands.
        // No cast: this is where the compiler checks that the plugin's
        // `FcbStreamLayerHandle` really does satisfy the app's structural
        // `StreamInteractionHandle` — the same discipline `gatherHandles` uses
        // for the static side.
        const handle: StreamInteractionHandle | undefined = store.get(
          layer.id,
        )?.handle;
        if (!handle) continue;
        present.add(layer.id);
        if (!streams.has(layer.id)) added = true;
        streams.set(layer.id, handle);
        // Rules, LoD and visibility — the streaming replacement for
        // `syncLayers` + `syncStyles`, memoised per layer (`handleSync.ts`).
        syncStreamState(layer, handle, memos);
        // Cells arrive asynchronously, LONG after any store change, so the
        // triangle readout and the highlight have to be refreshed on every
        // commit — otherwise an FCB-only workspace reports its first commit's
        // count forever and cells that land while something is selected render
        // unhighlighted. Subscribed on EVERY run, not only for handles that are
        // new to the map: the cleanup below unsubscribes unconditionally, so a
        // "skip the ones already registered" shortcut would go deaf after the
        // first unrelated layer change.
        unsubscribes.push(
          handle.onCommit(() => {
            onTriangleCount(totalTriangles(layers, liveRef.current, streams));
            const selection = useSelectionStore.getState();
            // Only the committing handle, and deliberately WITHOUT the memo:
            // its highlight key has not changed — the cells under it have — so
            // a memoised push would be skipped exactly when it is needed.
            syncHighlight([handle], selection.selections, selection.hovered);
          }),
        );
      }

      // Whatever the store or the registry still holds for a layer that has
      // left `layerStore`: stop its worker, drop its cell meshes, forget it.
      // Normally `LayerPanel`/`App` have already called `closeStreamingLayer`
      // before removing the layer — this is the safety net that also keeps
      // `streamsRef` from letting `fitAll`, a pick or the triangle count read
      // a deleted handle.
      for (const id of new Set([
        ...streams.keys(),
        ...Object.keys(store.streams),
      ])) {
        if (present.has(id)) continue;
        closeStreamingLayer(flatPluginRef.current, id);
        streams.delete(id);
        memos.delete(id);
      }

      onTriangleCount(totalTriangles(layers, liveRef.current, streams));
      // A newly opened stream earns the same one-off fit a newly added static
      // layer does — and needs it MORE: a streaming layer only fetches cells
      // once the camera is close enough for the cover to fit the budget, so a
      // `.fcb` opened as the first layer would otherwise sit on a whole-globe
      // camera reporting "Zoom in to load features" forever, with nothing on
      // screen to aim at. `getBoundsGeodetic` answers from the header extent
      // (plugin, Task C14), so this frames the file before a single cell has
      // arrived.
      if (added) setFitToken((t) => t + 1);
      return () => {
        for (const off of unsubscribes) off();
      };
    }, [engineReady, layers, streamIds, onTriangleCount]);

    // --- solar: the atmosphere's clock, and the sun it reports back ---
    //
    // Task C16. Four seams, in the order the data flows:
    //
    //   the loaded layers -> `solarStore.latLon`      (which site the sun is read at)
    //   `solarStore.datetime` -> `atmosphere.date`    (a user edit, a restored link)
    //   the render loop -> `atmosphere.date` + a throttled `setDatetime`
    //   `sunChanged` -> `solarStore.setSunPosition`   (in the site's ENU frame)
    //
    // The animation deliberately does NOT run on React state. At 60 fps a
    // `useState` clock would re-render this component — and re-run the engine
    // bindings hanging off it — every frame; the loop writes the atmosphere
    // imperatively and publishes to the store on a ~10 Hz beat instead, which
    // is the only rate any readout can be read at anyway.

    /** The date the atmosphere is currently showing. The animation's
     *  accumulator: while the clock runs it is AHEAD of
     *  `solarStore.datetime`, which only catches up on the sync beat. */
    const datetimeRef = useRef<Date>(useSolarStore.getState().datetime);
    /** The exact `Date` this component last put INTO the store, so the
     *  subscription below can tell its own echo from a real edit. */
    const publishedDatetimeRef = useRef<Date | null>(null);
    /** Publishes the engine's current sun direction into the store — null
     *  until there is a site to read it at. */
    const publishSunRef = useRef<(() => void) | null>(null);

    // The site the sun readout speaks for: the centre of everything loaded.
    // Derived from the live handles' geodetic bounds rather than a model's
    // CRS + bbox (the retired `CitySceneR3F` called `initFromModel` here),
    // because bounds are the one source a STREAMING layer has too — its FCB
    // header extent, Task C14 — and they need no reprojection.
    const latLon = useSolarStore((s) => s.latLon);
    useEffect(() => {
      if (!engineReady) return;
      const bounds = boundsOf();
      const next =
        bounds === null
          ? null
          : {
              lat: (bounds.south + bounds.north) / 2,
              lon: (bounds.west + bounds.east) / 2,
            };
      const current = useSolarStore.getState().latLon;
      // Value comparison, not identity: this effect re-runs on every layer
      // change, and publishing a fresh object per run would rebuild the ENU
      // frame — and re-subscribe the sun writer — on a visibility toggle.
      if (current === null && next === null) return;
      if (
        current !== null &&
        next !== null &&
        current.lat === next.lat &&
        current.lon === next.lon
      ) {
        return;
      }
      useSolarStore.getState().setLatLon(next);
    }, [engineReady, layers, streamIds, boundsOf]);

    /** The site's ENU frame. Rebuilt only when the site itself moves. */
    const siteFrame = useMemo(
      () => (latLon === null ? null : siteEnuFrame(latLon)),
      [latLon],
    );

    // `sunChanged` -> the store, in the site's local ENU frame.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;
      if (siteFrame === null) {
        // Nothing loaded: the last model's sun must not linger in the readout.
        if (useSolarStore.getState().sunPosition !== null) {
          useSolarStore.getState().setSunPosition(null);
        }
        return;
      }
      const atmosphere = view.atmosphere;
      const publish = () => {
        useSolarStore
          .getState()
          .setSunPosition(
            sunPositionFromEcef(siteFrame, atmosphere.getSunDirection()),
          );
      };
      publishSunRef.current = publish;
      // Once, immediately: the engine emits `sunChanged` only when the date
      // moves, so a site that appears afterwards — the usual case, a file
      // dropped into a running engine — would otherwise leave every solar
      // readout empty until the user touched the clock.
      publish();
      const onSunChanged = () => {
        // While the clock runs, the loop below publishes on its own beat:
        // `sunChanged` fires once per frame, and a store write per frame is a
        // re-render of the toolbar, the solar tab and the analysis tab per
        // frame.
        if (useSolarStore.getState().timeAnimating) return;
        publish();
      };
      atmosphere.on("sunChanged", onSunChanged);
      return () => {
        atmosphere.off("sunChanged", onSunChanged);
        publishSunRef.current = null;
      };
    }, [engineReady, siteFrame]);

    // `solarStore.datetime` -> `atmosphere.date`, for every change this
    // component did not make itself.
    //
    // A store SUBSCRIPTION rather than `useSolarStore((s) => s.datetime)`:
    // the loop publishes ten times a second, and a selector would re-render
    // the whole viewport at that rate for a value it only ever hands to the
    // engine.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;
      const push = (datetime: Date) => {
        // Our own publication coming back around. The atmosphere is already
        // showing this date — or a LATER one, since the loop runs ahead of the
        // store between beats — so writing it back would rewind the sun by up
        // to one beat every time the clock ticks.
        if (datetime === publishedDatetimeRef.current) return;
        datetimeRef.current = datetime;
        view.atmosphere.date = datetime;
      };
      // The engine starts on its own default date (the real clock), so the
      // store's datetime has to be pushed once as soon as there is a view —
      // including the one a share link restored before the engine came up.
      push(useSolarStore.getState().datetime);
      return useSolarStore.subscribe((state, previous) => {
        if (state.datetime !== previous.datetime) push(state.datetime);
      });
    }, [engineReady]);

    // The animation itself: one `preUpdate` subscription for the lifetime of
    // the engine, driving the atmosphere directly.
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;
      /** The previous frame's timestamp, or null before there has been one. */
      let previous: number | null = null;
      let lastSync = 0;
      /** Whether the clock was running on the previous frame. */
      let running = false;

      const publishDatetime = (datetime: Date) => {
        publishedDatetimeRef.current = datetime;
        useSolarStore.getState().setDatetime(datetime);
        // The sun belongs to the same beat: `sunChanged` is ignored while the
        // clock runs, so this is what moves the altitude/azimuth readout.
        publishSunRef.current?.();
      };

      // `now` is the engine's own `DOMHighResTimeStamp` (`setAnimationLoop`),
      // i.e. the same clock as `performance.now()` — and, being an argument,
      // the seam a test drives the animation through.
      const onPreUpdate = (now: number) => {
        const last = previous;
        previous = now;
        const solar = useSolarStore.getState();
        if (!solar.timeAnimating) {
          if (running) {
            running = false;
            // A pause lands between beats, so the store can be up to 100 ms of
            // wall clock — six minutes of sun at 3600x — behind the date the
            // atmosphere is showing. Publish the animation's last value so the
            // clock the user reads matches the sky they are looking at.
            publishDatetime(datetimeRef.current);
          }
          return;
        }
        if (!running) {
          running = true;
          lastSync = now;
        }
        // First frame after subscribing: no previous timestamp, so no delta.
        if (last === null) return;
        const step = advanceTime(
          datetimeRef.current,
          (now - last) / 1000,
          solar.timeSpeed,
          now - lastSync,
        );
        datetimeRef.current = step.next;
        view.atmosphere.date = step.next;
        if (step.shouldSyncStore) {
          lastSync = now;
          publishDatetime(step.next);
        }
      };

      view.on("preUpdate", onPreUpdate);
      return () => view.off("preUpdate", onPreUpdate);
    }, [engineReady]);

    // --- selection / hover -> handle.setHighlight ---
    // Subscribed as state (not read from `getState()`) because a selection made
    // anywhere else in the app — the inspector, a share link restore, box
    // select — has to repaint too, not just one made by a click in here.
    const selections = useSelectionStore((s) => s.selections);
    const hovered = useSelectionStore((s) => s.hovered);
    /** What each live handle was last told. Keyed by handle identity, so a
     *  deleted layer's entry disappears with it and a re-added layer's fresh
     *  handle is always pushed to. */
    const highlightMemoRef = useRef<HighlightMemo>(new WeakMap());
    useEffect(() => {
      if (!engineReady) return;
      syncHighlight(
        // ALL handles, hidden layers included: highlight outlives a visibility
        // toggle, and each handle filters the array by its own layerId.
        allInteractionHandles(layers, liveRef.current, streamsRef.current),
        selections,
        hovered,
        // Hovering a building in one layer must not repaint the others:
        // `setHighlight` recolors the whole layer, and this effect runs on
        // every hover step.
        highlightMemoRef.current,
      );
      // `streamIds`: a handle that joins the registry AFTER its layer appeared
      // (the open resolves a tick later) must be told the current selection,
      // not only whatever arrives next. The memo is keyed by handle identity,
      // so this costs one push per newly opened stream and nothing else.
    }, [engineReady, layers, streamIds, selections, hovered]);

    // --- engine pointer events -> pick intents + the cursor readout ---
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;

      // ONE registry for interaction. In Part B it only ever holds static
      // handles; Task C13 fills `streamsRef` and this same closure then picks
      // and highlights streamed cells with no further change here. Rebuilt per
      // event rather than captured: `liveRef` mutates in place, and a captured
      // array would go stale the moment a layer is added.
      const handles = () =>
        interactionHandles(layers, liveRef.current, streamsRef.current);

      /**
       * Screen point -> ECEF ray.
       *
       * `getPickRay` is a free function taking a `{width, height, pixelRatio}`
       * window-like and the raw three camera (Task B1 finding 5). It measures
       * from the CANVAS' top-left, which is why every caller below goes through
       * `canvasPointOf` rather than the event's `clientX`/`clientY`.
       */
      const rayAt = (point: ScreenPoint): EcefRay | null => {
        const size = view.screenSize;
        return getPickRay(
          { width: size.x, height: size.y, pixelRatio: view.pixelRatio },
          view.camera.raw,
          new Vector2(point.x, point.y),
        );
      };

      const pickAt = (point: ScreenPoint) => {
        const ray = rayAt(point);
        return ray ? resolveNearestHit(handles(), ray) : null;
      };

      // ~15 Hz, the old app's inline `performance.now()` gate. Hover is NOT
      // throttled — it is what makes the highlight follow the pointer — but the
      // readout costs a depth read plus a proj4 transform, and the status bar
      // cannot show more than this anyway.
      const throttleCursor = createThrottle(66);
      const clickGate = createClickGate();

      const reportCursor = (point: ScreenPoint, hitLayerId?: string) => {
        if (!onCursorPosition) return;
        throttleCursor(() => {
          const ecef = view.pickDepthPosition(point.x, point.y);
          if (!ecef) {
            // Nothing rendered under the cursor at all (the sky). Not a
            // ground-plane fallback: the engine's depth read already answers
            // with the globe surface wherever the terrain is drawn.
            onCursorPosition(null);
            return;
          }
          // No hit means the cursor is on the terrain rather than a model; the
          // readout then speaks the first layer's CRS, which is the only CRS
          // the user has asked to see.
          const layerId = hitLayerId ?? layers[0]?.id;
          const layer = layers.find((l) => l.id === layerId);
          const epsg = epsgForLayer(layer?.model.metadata.referenceSystem);
          if (epsg === null) {
            onCursorPosition(null);
            return;
          }
          const lle = vector3ToGeodetic(ecef);
          onCursorPosition(
            crsFromGeodetic(
              // RADIANS in, degrees out. Evidence, not assumption: the B1 spike
              // placed its probe mesh with the exact inverse of this call —
              // `geodeticToVector3({ lng: degreeToRadian(site.lng), lat:
              // degreeToRadian(site.lat), height })` (`src/spike/
              // navaraMrtSpike.ts`) — and the mesh rendered at the right place
              // on the globe in the browser. The engine's `LatLngHeight` is
              // degrees elsewhere in its own API (`flyTo`,
              // `camera.positionGeographic`), so this must stay explicit.
              radianToDegree(lle.lng),
              radianToDegree(lle.lat),
              // ELLIPSOIDAL -> ORTHOMETRIC. The layer sits `heightOffset`
              // metres up because its geodetic heights were raised by the geoid
              // undulation (Global Constraints -> Vertical datum); subtracting
              // it again yields the z the source file actually contains.
              lle.height -
                layerHeightOffset(layerId, liveRef.current, streamsRef.current),
              epsg,
            ),
          );
        });
      };

      /**
       * The last mousemove the ENGINE reported, by object identity.
       *
       * `convertMouseEventToMapEvent` `Object.assign`s `{ map }` onto the very
       * DOM event it received and returns `null` when the screen ray misses the
       * ellipsoid — so the object the engine emits IS the object our own DOM
       * listener sees afterwards (the engine binds to the canvas, we bind to its
       * parent, so bubbling puts the engine first). Comparing them is therefore
       * an exact "did the engine handle this move?" test.
       */
      let lastEngineMove: unknown = null;

      /** Nothing is under the cursor: drop the hover and the readout. */
      const clearCursorState = () => {
        const store = useSelectionStore.getState();
        if (store.hovered !== null) store.hover(null);
        onCursorPosition?.(null);
      };

      const onMouseDown = (e: MouseEvent) => clickGate.down(canvasPointOf(e));

      const onMouseMove = (e: MouseEvent) => {
        lastEngineMove = e;
        const point = canvasPointOf(e);
        clickGate.move(point);
        const store = useSelectionStore.getState();
        // Gate on the tool BEFORE resolving: a measure-mode move must not cost
        // a raycast across every layer.
        if (!acceptsPointer(store.toolMode, "move")) {
          reportCursor(point);
          return;
        }
        const hit = narrowToMode(pickAt(point), store.mode);
        // Every resolved pick is a fresh object, so pushing it unconditionally
        // would change `hovered` on every mousemove and repaint every layer's
        // vertex colors at pointer rate.
        if (!sameSelection(store.hovered, hit)) {
          applyPickIntent(
            pickIntentFor({ type: "move", shiftKey: false }, hit),
            store,
          );
        }
        reportCursor(point, hit?.layerId);
      };

      const onClick = (e: MouseEvent) => {
        const store = useSelectionStore.getState();
        if (!acceptsPointer(store.toolMode, "click")) return;
        // The engine's `click` is the raw DOM click and fires at the end of a
        // camera orbit too; without this, every gesture would clear the
        // selection on mouseup.
        if (!clickGate.isClean()) return;
        const hit = narrowToMode(pickAt(canvasPointOf(e)), store.mode);
        applyPickIntent(
          pickIntentFor({ type: "click", shiftKey: e.shiftKey === true }, hit),
          store,
        );
      };

      /**
       * SKY DETECTOR, and the reason the two listeners below exist at all.
       *
       * The engine emits NO pointer event — not `mousemove`, not even
       * `mouseleave` — when the screen ray misses the ellipsoid, because
       * `convertMouseEventToMapEvent` returns null and the emit is skipped.
       * Relying on engine events alone therefore freezes the hover highlight
       * and the status bar at their last on-globe values the moment the cursor
       * moves onto the sky, and leaves them frozen if the pointer exits the
       * canvas across a sky pixel.
       *
       * The DOM always fires, so the container listens too: a move the engine
       * did NOT claim is a move over the sky.
       */
      const onDomMouseMove = (e: MouseEvent) => {
        // Feed the drag gate from here as well: a gesture that starts or moves
        // over the sky is invisible to the engine, and a stale gate would let
        // the click that ends it commit a selection.
        clickGate.move(canvasPointOf(e));
        if (lastEngineMove === e) return;
        clearCursorState();
      };
      const onDomMouseDown = (e: MouseEvent) =>
        clickGate.down(canvasPointOf(e));
      // Leaving the canvas: unconditional, and the one case the engine's own
      // `mouseleave` cannot be trusted for.
      const onDomMouseLeave = () => clearCursorState();

      // No `view.on("pick", ...)`: PICK_PATH is "own-raycast" (Task B1).
      // `PickableMeshWrapper` allocates ONE batch id per mesh, so an engine
      // pick could only ever name a layer, and it would fire alongside `click`
      // — committing a second, coarser selection over the right one.
      // `handleSync.resolvePickedFeature` stands ready for the day that
      // changes.
      view.on("mousedown", onMouseDown);
      view.on("mousemove", onMouseMove);
      view.on("click", onClick);

      const host = containerRef.current;
      host?.addEventListener("mousemove", onDomMouseMove);
      host?.addEventListener("mousedown", onDomMouseDown);
      host?.addEventListener("mouseleave", onDomMouseLeave);

      return () => {
        view.off("mousedown", onMouseDown);
        view.off("mousemove", onMouseMove);
        view.off("click", onClick);
        host?.removeEventListener("mousemove", onDomMouseMove);
        host?.removeEventListener("mousedown", onDomMouseDown);
        host?.removeEventListener("mouseleave", onDomMouseLeave);
      };
    }, [engineReady, layers, onCursorPosition]);

    const getCameraState = useCallback((): GeographicCameraState | null => {
      const view = viewRef.current;
      if (!view) return null;
      try {
        const { lng, lat, height } = view.camera.positionGeographic;
        const { heading, pitch, roll } = view.camera.orientation;
        if (
          heading === undefined ||
          pitch === undefined ||
          roll === undefined
        ) {
          return null;
        }
        return { lng, lat, height, heading, pitch, roll };
      } catch {
        // BROWSER-VERIFIED, not defensive padding: `positionGeographic`
        // throws a bare "Invariant failed" until the engine has wired the
        // camera to its Rust core, which happens on the first rendered frame —
        // AFTER `view.init()` resolves. A snapshot taken in that window (C20's
        // autosave, a share-link capture) must report "no camera yet", not
        // take the caller down.
        return null;
      }
    }, []);

    const setCameraState = useCallback(
      (state: GeographicCameraState) => {
        const view = viewRef.current;
        if (!view) return;
        // A restore is the sharpest case of a move that is not a gesture:
        // without the bracket, reopening a share link would re-fetch tiles for
        // a camera the user never touched.
        withSettleSuppressed(() => view.setCamera(state));
      },
      [withSettleSuppressed],
    );

    /**
     * Hand the FlatCityBuf plugin out, once there is one.
     *
     * Awaiting `ready` is what turns the old `fcbPluginRef.current!` race — a
     * share hash processed on the first render, when the ref is still null —
     * into a queue. It REJECTS if the engine failed (Shared Interface Contract
     * -> `ready`) or if the plugin itself could not be built, so a caller gets
     * an error it can toast rather than a promise that never settles.
     */
    const getStreamingPlugin =
      useCallback(async (): Promise<FlatCityBufPlugin> => {
        await readyRef.current!.promise;
        const plugin = flatPluginRef.current;
        if (plugin) return plugin;
        const cause = flatPluginErrorRef.current;
        throw new Error(
          "FlatCityBuf streaming is unavailable in this session, so a .fcb layer cannot be opened" +
            (cause instanceof Error ? `: ${cause.message}` : "."),
          cause === null ? undefined : { cause },
        );
      }, []);

    useImperativeHandle(
      ref,
      () => ({
        fitAll,
        fitLayer,
        alignView,
        getCameraState,
        setCameraState,
        getStreamingPlugin,
        // A GETTER, not a captured promise, because the lifecycle cleanup
        // RE-ARMS the gate. A snapshot taken when this handle was built would
        // be correct only as long as React keeps re-invoking `create()` in
        // lockstep with that cleanup — which it does today (the lifecycle
        // effect's deps are `[]`, so it can only cycle together with this
        // layout effect, and both are double-invoked under StrictMode). That
        // is an ordering guarantee this component should not be spending, so
        // read the ref instead: `handle.ready` is then, by construction, the
        // promise of the engine that is coming up NOW. (`readyRef` is a ref,
        // hence no dependency.)
        get ready() {
          return readyRef.current!.promise;
        },
      }),
      [
        fitAll,
        fitLayer,
        alignView,
        getCameraState,
        setCameraState,
        getStreamingPlugin,
      ],
    );

    return (
      <div className="navara-viewport">
        {/* The engine appends its canvas here. Kept childless so React never
            has to reconcile around a DOM node it does not own. */}
        <div className="navara-viewport__canvas" ref={containerRef} />
        {initError !== null && (
          <div className="navara-viewport__error" role="alert">
            The 3D engine failed to start: {initError}
          </div>
        )}
        <ViewAlignButtons onAlign={alignView} />
      </div>
    );
  },
);
