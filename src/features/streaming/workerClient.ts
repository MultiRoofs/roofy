/**
 * Promise-per-message wrapper over the streaming worker, with an epoch guard.
 *
 * An epoch is needed even though select() supports AbortSignal: an abort stops
 * the range reads, but a response already in flight can still arrive after a
 * newer request was issued.
 */
import { assertCellGeometry } from "./workerProtocol";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

/**
 * `Omit<WorkerRequest, "id">` does NOT do what it looks like it does: `Omit`
 * is defined in terms of `Pick<T, Exclude<keyof T, K>>`, and for a union
 * type `keyof WorkerRequest` is only the keys common to every member — just
 * `"type"`. So a plain `Omit` collapses the whole discriminated union down
 * to `{ type: WorkerRequest["type"] }`, silently discarding every
 * variant-specific field (bbox, cells, url, ...). Any real call passing a
 * full request object then fails to type-check. This distributes the Omit
 * over each union member individually by routing through a conditional type
 * with a naked type parameter, which the compiler distributes automatically.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

interface PendingEntry {
  readonly resolve: (r: WorkerResponse) => void;
  readonly reject: (e: Error) => void;
}

interface StreamingEntry {
  readonly onMessage: (r: WorkerResponse) => void;
  readonly reject: (e: Error) => void;
}

export class WorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingEntry>();
  /** Streaming responses live in a separate map from `pending` because a
   *  streaming request receives many messages ('cell' * N, then 'done'), and
   *  `pending`'s dispatch deletes the handler after the first message —
   *  which would silently drop every cell after the first. */
  private readonly streaming = new Map<number, StreamingEntry>();
  private nextId = 0;
  private epoch = 0;

  constructor() {
    this.worker = new Worker(new URL("./fcb.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const stream = this.streaming.get(ev.data.id);
      if (stream) {
        stream.onMessage(ev.data);
        return;
      }
      const cb = this.pending.get(ev.data.id);
      if (cb) {
        this.pending.delete(ev.data.id);
        cb.resolve(ev.data);
      }
    };
  }

  /** Bumps the epoch; results captured under an older epoch are stale. */
  newEpoch(): number {
    return ++this.epoch;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }

  send(
    msg: DistributiveOmit<WorkerRequest, "id">,
    transfer: Transferable[] = [],
  ): Promise<WorkerResponse> {
    const id = ++this.nextId;
    const full = { ...msg, id } as WorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(full, transfer);
    });
  }

  /**
   * Genuinely fire-and-forget: registers NO pending entry, so there is
   * nothing for it to leak. Only for a request the worker never
   * acknowledges — `evict`/`cancel`/`close` (see fcb.worker.ts's handlers
   * for those three, none of which ever `post()`s a response) — and that no
   * caller reads a return value from. Using `send()` for these instead (as
   * this module originally did) permanently retains a `pending` entry per
   * call, since `send()`'s promise only ever settles on a matching response
   * arriving, which these three requests never produce; every interaction
   * burst (a `cancel` on first-change, an `evict` after budget eviction)
   * then leaked one more entry forever.
   */
  notify(msg: DistributiveOmit<WorkerRequest, "id">): void {
    const id = ++this.nextId;
    this.worker.postMessage({ ...msg, id } as WorkerRequest);
  }

  /** Streaming responses: one 'cell' per cell, then 'done'. Every 'cell'
   *  message is validated against the protocol's length invariants on
   *  receipt — a malformed payload fails loudly here rather than producing
   *  a silently unpickable mesh downstream. */
  sendStreaming(
    msg: DistributiveOmit<WorkerRequest, "id">,
    onMessage: (r: WorkerResponse) => void,
  ): Promise<void> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.streaming.set(id, {
        onMessage: (r) => {
          if (r.type === "cell") assertCellGeometry(r.geometry);
          onMessage(r);
          if (r.type === "done" || r.type === "error") {
            this.streaming.delete(id);
            resolve();
          }
        },
        reject,
      });
      this.worker.postMessage({ ...msg, id } as WorkerRequest);
    });
  }

  /**
   * Tears down the underlying worker thread (which also releases anything
   * it holds — an open FcbReader, a cloned Blob, the per-cell cache — as a
   * side effect of thread teardown, so nothing here needs to explicitly
   * "close" the reader first) and REJECTS every promise still awaiting a
   * response, rather than leaving it hanging forever. A caller mid-`await`
   * on `send`/`sendStreaming` (e.g. `commitStreamingLayer` racing a layer
   * removal) gets a real rejection it can catch, instead of a permanently
   * unsettled promise — the leak this method exists to prevent.
   */
  terminate(): void {
    const err = new Error("WorkerClient terminated");
    for (const { reject } of this.pending.values()) reject(err);
    for (const { reject } of this.streaming.values()) reject(err);
    this.pending.clear();
    this.streaming.clear();
    this.worker.terminate();
  }
}
