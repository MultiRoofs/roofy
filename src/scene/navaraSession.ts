/**
 * Creation/teardown sequencer for a Navara `ThreeView`, isolated from React so
 * the StrictMode double-mount contract is unit-testable:
 *
 *  - EVERY plugin in the ordered list is added BEFORE `init()` (adding after
 *    init throws in Navara). Callers append to the list instead of calling
 *    `addPlugin()` later — the viewport never sees the view before init has
 *    started, so the list is the only registration point;
 *  - `ready` resolves with the view plus the plugin instances, or REJECTS:
 *    with the underlying error if `createView()`/`init()`/an `afterInit` hook
 *    threw, or with {@link NavaraSessionDisposedError} if `dispose()` beat init
 *    to the finish. Callers distinguish the two: the first is a real failure to
 *    surface, the second is a StrictMode remount to ignore. It never hangs and
 *    never collapses a failure into `null` (Shared Interface Contract →
 *    `CitySceneHandle.ready`);
 *  - `dispose()` called while `init()` is still in flight waits for init to
 *    settle and then disposes exactly once; called after it has settled it
 *    disposes synchronously, so a React cleanup leaves nothing pending;
 *  - `dispose()` is idempotent.
 *
 * This module is deliberately ENGINE-FREE: it never imports `@navaramap/*`
 * (Task B1: importing the engine under Node crashes at module scope). The
 * caller constructs the view and the plugin instances — which is also how it
 * keeps fully typed references to them — and injects them here.
 */

/** The slice of `ThreeView` this sequencer touches. */
export interface NavaraViewLike {
  addPlugin(plugin: unknown): void;
  init(): Promise<void>;
  dispose(): void;
}

/**
 * Raised through `ready` when the session was torn down before it went live.
 * Not a failure — React StrictMode produces one of these on every mount.
 */
export class NavaraSessionDisposedError extends Error {
  constructor() {
    super("Navara session was disposed before initialization completed.");
    this.name = "NavaraSessionDisposedError";
  }
}

export interface NavaraPluginSpec<T = unknown> {
  /** Stable key for looking the instance up on the result. Must be unique. */
  readonly key: string;
  /** Constructed by the caller, so the caller keeps a fully typed reference. */
  readonly instance: T;
  /**
   * Runs after `view.init()` settles, in list order — e.g. DefaultPlugin's
   * `addDefaultPhotorealScene()`. Skipped when the session was disposed.
   */
  afterInit?(view: NavaraViewLike): void;
}

export interface NavaraSessionOptions<
  TView extends NavaraViewLike = NavaraViewLike,
> {
  createView(): TView;
  /** Registered with `view.addPlugin()` in this exact order, before init. */
  readonly plugins: readonly NavaraPluginSpec[];
}

export interface NavaraSessionResult<
  TView extends NavaraViewLike = NavaraViewLike,
> {
  readonly view: TView;
  /** The same instances that were passed in, keyed by `spec.key`. */
  readonly plugins: ReadonlyMap<string, unknown>;
}

export interface NavaraSession<TView extends NavaraViewLike = NavaraViewLike> {
  readonly ready: Promise<NavaraSessionResult<TView>>;
  dispose(): void;
}

export function createNavaraSession<TView extends NavaraViewLike>(
  options: NavaraSessionOptions<TView>,
): NavaraSession<TView> {
  const specs = options.plugins;
  let view: TView | null = null;
  let cancelled = false;
  let disposed = false;
  let initSettled = false;

  const disposeOnce = (): void => {
    if (disposed) return;
    disposed = true;
    view?.dispose();
  };

  const ready = (async (): Promise<NavaraSessionResult<TView>> => {
    // Everything up to the first `await` runs synchronously, so the view is
    // constructed and every plugin registered before `createNavaraSession`
    // returns — dispose() therefore always sees a fully built view.
    const plugins = new Map<string, unknown>();
    try {
      view = options.createView();
      for (const spec of specs) {
        if (plugins.has(spec.key)) {
          throw new Error(
            `createNavaraSession: duplicate plugin key "${spec.key}".`,
          );
        }
        plugins.set(spec.key, spec.instance);
        view.addPlugin(spec.instance);
      }
    } catch (error) {
      initSettled = true;
      disposeOnce();
      throw asError(error);
    }

    const live = view;
    try {
      await live.init();
    } catch (error) {
      initSettled = true;
      disposeOnce();
      throw asError(error);
    }
    initSettled = true;

    if (cancelled) {
      disposeOnce();
      throw new NavaraSessionDisposedError();
    }

    try {
      for (const spec of specs) spec.afterInit?.(live);
    } catch (error) {
      // A hook that throws leaves a live view nobody owns: tear it down and
      // surface the failure exactly like an init() failure.
      disposeOnce();
      throw asError(error);
    }

    return { view: live, plugins };
  })();

  // A caller may never attach a rejection handler (dispose-before-ready during
  // a StrictMode remount), so keep the runtime from reporting it as unhandled.
  // `ready` itself stays rejectable for the callers that do await it.
  const settled = ready.catch(() => undefined);

  return {
    ready,
    dispose: () => {
      cancelled = true;
      // Once init has settled, tear down synchronously so a React cleanup
      // returns with the view already gone; before that, wait for init to
      // finish rather than disposing a view still coming up.
      if (initSettled) disposeOnce();
      else void settled.then(disposeOnce);
    },
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
