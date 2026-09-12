/**
 * The ONE way anything in this app awaits the DuckDB engine.
 *
 * WHY IT EXISTS. duckdb-wasm drops the promises of the requests that were in
 * flight when its worker died — its own `onError` does
 * `this._pendingRequests.clear()` WITHOUT rejecting them — and once the worker
 * is gone `postTask` logs and returns `undefined` rather than rejecting. So a
 * query, an extension load, a table build's `CREATE` or a run's write caught by
 * the death NEVER SETTLES. Anything sitting on one holds whatever it is holding
 * for the life of the page: the shared table FIFO above all, where one stranded
 * await means every later run AND every later table build queues behind a task
 * that can never finish.
 *
 * There is no rejection to listen for, so the death is an independent signal
 * ({@link onEngineDeath}) that this module races the await against.
 *
 * Engine-free in the sense that matters: no `@duckdb/duckdb-wasm` import — the
 * death comes through `insights/duckdb.ts`, which is still the only module
 * under `src/` allowed to touch the package.
 */

import { onEngineDeath } from "./duckdb";

/**
 * Thrown when the engine died under an await that can never settle.
 *
 * A DISTINCT class because its callers each have a different true thing to say
 * about it: a run's card reads §6.1's "Analytics engine stopped", a table build
 * abandons its entry to the invalidation, and neither is the failure of the
 * statement they were waiting on — nothing failed, the database stopped
 * existing.
 */
export class EngineDeadError extends Error {}

/**
 * Thrown when the user cancelled the work under the await.
 *
 * Shared with {@link raced}'s callers rather than private to any one of them
 * (it used to live in `runQueue.ts`): it is what makes a run end "cancelled"
 * rather than "failed", so the module that reads it and the module that throws
 * it have to agree on the class. A tool EXECUTOR still cannot fake either one —
 * `ToolContext` exposes `throwIfCancelled()`, never this.
 */
export class CancelledError extends Error {}

/**
 * Race an ENGINE await against the engine's DEATH, and optionally against a
 * caller's own abort.
 *
 * The death is a signal of its own and not a reading of the abort, because an
 * `AbortSignal` fires ONCE: work cancelled while the engine was alive has
 * already spent its abort, and the crash that catches its write a moment later
 * would have nothing left to fire. Racing the death separately covers every
 * cancel state, which is the whole point.
 *
 * `signal` is null for the awaits at and past a point of no return (a run's
 * write and the DESCRIBE after it) and for work no user cancels (a table
 * build). Only the death may take those.
 *
 * The listeners are removed on settle; work that is never cancelled would
 * otherwise leave one on its controller for as long as the signal lives.
 *
 * ONE LIMIT, by construction: `onEngineDeath` fires once per engine and drops
 * its waiters as it fires, so a `raced` STARTED after the death hears nothing.
 * That is not a hole — every primitive in `duckdb.ts` answers immediately once
 * the engine is gone (`db` is null and the status is not `ready`, so
 * `runQuery`/`ddl` return "not running", `registerBuffer` returns false and
 * `dropBuffer` returns) — the hazard is only ever the await already in flight.
 */
export function raced<T>(
  promise: Promise<T>,
  signal: AbortSignal | null,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new CancelledError());
  return new Promise<T>((resolve, reject) => {
    const stopListening = () => {
      signal?.removeEventListener("abort", onAbort);
      stopDeath();
    };
    const onAbort = () => {
      stopListening();
      reject(new CancelledError());
    };
    const stopDeath = onEngineDeath(() => {
      stopListening();
      reject(new EngineDeadError());
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        stopListening();
        resolve(value);
      },
      (error: unknown) => {
        stopListening();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** {@link raced} for work with no abort of its own — a table build, a cleanup,
 *  a column re-describe. The death is the only thing that may take it. */
export function racedWithDeath<T>(promise: Promise<T>): Promise<T> {
  return raced(promise, null);
}
