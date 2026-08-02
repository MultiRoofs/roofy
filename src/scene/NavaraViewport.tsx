/**
 * Navara viewport: owns the `ThreeView` lifecycle and exposes the imperative
 * {@link CitySceneHandle} `App.tsx` drives the camera through.
 *
 * Replacement for `CitySceneR3F.tsx` (spec 4.1). No React Three Fiber: Navara
 * is imperative, so the whole engine lives behind refs and focused effects, and
 * React only owns the DOM around it.
 *
 * SCOPE (Task B11a): engine lifecycle, the photorealistic globe, camera
 * accessors and the init-failure panel. There are no city layers yet — Task
 * B11b mirrors the layer store into `CityModelHandle`s (`handleSync.ts`), fills
 * in the bounds sources the fit/align helpers below ask for, and switches
 * `App.tsx` over from `CityScene`. Until then this component is reachable only
 * from the `navara.html` harness page.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
// The engine-bound subpath, NOT the package barrel: the barrel must stay
// importable from Node (Global Constraints -> NODE_IMPORT_SAFE = false).
import { CityJSONPlugin } from "@cityjson/navara-cityjson/plugin";
import {
  createNavaraSession,
  NavaraSessionDisposedError,
  type NavaraSession,
} from "./navaraSession";
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
    // Only `onFps` is wired in B11a; `onTriangleCount` / `onCursorPosition` /
    // `onLayerError` stay in the props contract so B11b, which reports them,
    // does not change this component's public shape.
    const { onFps } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<ViewInstance | null>(null);
    const cityPluginRef = useRef<CityJSONPlugin | null>(null);
    const [engineReady, setEngineReady] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);

    // CitySceneHandle.ready — created eagerly so a consumer can await it before
    // the mount effect has run. Resolve-or-reject, never a hang: see the Shared
    // Interface Contract.
    const readyRef = useRef<ReadyGate | null>(null);
    readyRef.current ??= createReadyGate();
    const readyGate = readyRef.current;

    // --- Engine lifecycle (StrictMode-safe, see navaraSession.ts) ---
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

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
          // only needs them in registration order (Task B8). Task C13 appends
          // the FlatCityBuf plugin to this same array.
          const defaultPlugin = new DefaultPlugin();
          const cityPlugin = new CityJSONPlugin();

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
            ],
          });

          const result = await session.ready;
          if (cancelled) return;

          viewRef.current = result.view;
          cityPluginRef.current = cityPlugin;
          setInitError(null);
          setEngineReady(true);
          readyGate.resolve();
        } catch (error) {
          // Torn down mid-init, or disposed before it went live: not a failure
          // anyone needs to see, and the cleanup below still disposes.
          if (cancelled || error instanceof NavaraSessionDisposedError) return;
          setInitError(error instanceof Error ? error.message : String(error));
          readyGate.reject(error);
        }
      })();

      engineSlot = started;

      return () => {
        cancelled = true;
        mountedViewports -= 1;
        setEngineReady(false);
        viewRef.current = null;
        cityPluginRef.current = null;
        // `started` settles only after `session.ready` has, so by the time
        // this runs the session disposes synchronously — which is what lets
        // the next mount initialise a fresh worker pool. If `dispose()` itself
        // throws, the next mount's `await engineSlot` re-raises it into that
        // mount's catch: reported in its error panel, never a silent hang.
        engineSlot = started.then(() => session?.dispose());
      };
    }, [readyGate]);

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
    // The bounds sources arrive in Task B11b (static handles + streaming
    // cells); with none registered every box is empty, so a fit is a no-op
    // rather than a jump to a NaN camera.
    const boundsOf = useCallback((_layerIds?: readonly string[]) => {
      return unionGeodeticBounds([]);
    }, []);

    const fitAll = useCallback(() => {
      const view = viewRef.current;
      const bounds = boundsOf();
      if (!view || !bounds) return;
      view.flyTo(cameraForBounds(bounds));
    }, [boundsOf]);

    const fitLayer = useCallback(
      (layerId: string) => {
        const view = viewRef.current;
        const bounds = boundsOf([layerId]);
        if (!view || !bounds) return;
        view.flyTo(cameraForBounds(bounds));
      },
      [boundsOf],
    );

    const alignView = useCallback(
      (direction: ViewDirection) => {
        const view = viewRef.current;
        const bounds = boundsOf();
        if (!view || !bounds) return;
        // Instant, not animated: `setCamera` emits no camera events, so an
        // alignment cannot be mistaken for a user gesture (Task C7).
        view.setCamera(alignCameraForBounds(bounds, direction));
      },
      [boundsOf],
    );

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

    const setCameraState = useCallback((state: GeographicCameraState) => {
      viewRef.current?.setCamera(state);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        fitAll,
        fitLayer,
        alignView,
        getCameraState,
        setCameraState,
        ready: readyGate.promise,
      }),
      [
        fitAll,
        fitLayer,
        alignView,
        getCameraState,
        setCameraState,
        readyGate.promise,
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
