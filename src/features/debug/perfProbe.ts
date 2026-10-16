/**
 * A measuring probe for the browser performance harness
 * (`scripts/performance/browser-harness.mjs`).
 *
 * It wraps the WebGL prototype rather than the engine, so it counts what the
 * GPU is actually asked to do whoever asks: draw calls, bytes uploaded into
 * buffers and textures, synchronous readbacks, and frames, where a frame is an
 * animation tick in which at least one draw call happened. A still camera on a
 * render-on-demand engine should therefore count ticks but no frames.
 *
 * Installed only when the page is opened with `?perf` (see `main.tsx`); it is
 * never on in normal use.
 */

export interface PerfSnapshot {
  readonly ticks: number;
  readonly frames: number;
  readonly drawCalls: number;
  readonly uploadedBytes: number;
  readonly readbacks: number;
  readonly longTasks: number;
  readonly longTaskMs: number;
  readonly longestTaskMs: number;
}

export interface PerfProbe {
  snapshot(): PerfSnapshot;
  reset(): void;
  recordLongTask(durationMs: number): void;
}

export interface PerfProbeOptions {
  /** The object whose methods are wrapped: `WebGL2RenderingContext.prototype` in the browser. */
  readonly glPrototype: object;
  /** Schedules the next tick: `requestAnimationFrame` in the browser. */
  readonly schedule: (callback: () => void) => void;
}

const DRAW_METHODS = [
  "drawArrays",
  "drawElements",
  "drawArraysInstanced",
  "drawElementsInstanced",
  "drawRangeElements",
] as const;

const READBACK_METHODS = ["readPixels"] as const;

/** Upload methods, with the index of the argument that carries the data. */
const UPLOAD_METHODS: Readonly<Record<string, readonly number[]>> = {
  bufferData: [1],
  bufferSubData: [2],
  texImage2D: [5, 8],
  texSubImage2D: [6, 8],
  texImage3D: [9],
  texSubImage3D: [10],
  compressedTexImage2D: [6],
  compressedTexSubImage2D: [7],
};

function byteSize(value: unknown): number {
  if (typeof value === "number") return value;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (
    value &&
    typeof value === "object" &&
    "width" in value &&
    "height" in value
  ) {
    const { width, height } = value as { width: number; height: number };
    return width * height * 4;
  }
  return 0;
}

function uploadBytes(
  args: readonly unknown[],
  positions: readonly number[],
): number {
  // Calls come in several overloads; the data sits at the last of the listed
  // positions that holds a sized value, or at the final argument.
  for (let i = positions.length - 1; i >= 0; i--) {
    const size = byteSize(args[positions[i]!]);
    if (size > 0) return size;
  }
  return byteSize(args[args.length - 1]);
}

export function createPerfProbe(options: PerfProbeOptions): PerfProbe {
  const proto = options.glPrototype as Record<string, unknown>;
  const counts = {
    ticks: 0,
    frames: 0,
    drawCalls: 0,
    uploadedBytes: 0,
    readbacks: 0,
    longTasks: 0,
    longTaskMs: 0,
    longestTaskMs: 0,
  };
  let drawsAtLastTick = 0;

  const wrap = (name: string, before: (args: unknown[]) => void) => {
    const original = proto[name];
    if (typeof original !== "function") return;
    proto[name] = function (this: unknown, ...args: unknown[]) {
      before(args);
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  };

  for (const name of DRAW_METHODS) wrap(name, () => void counts.drawCalls++);
  for (const name of READBACK_METHODS)
    wrap(name, () => void counts.readbacks++);
  for (const [name, positions] of Object.entries(UPLOAD_METHODS)) {
    wrap(name, (args) => {
      counts.uploadedBytes += uploadBytes(args, positions);
    });
  }

  const tick = () => {
    counts.ticks++;
    if (counts.drawCalls !== drawsAtLastTick) counts.frames++;
    drawsAtLastTick = counts.drawCalls;
    options.schedule(tick);
  };
  options.schedule(tick);

  return {
    snapshot: () => ({ ...counts }),
    reset: () => {
      for (const key of Object.keys(counts) as (keyof typeof counts)[])
        counts[key] = 0;
      drawsAtLastTick = 0;
    },
    recordLongTask: (durationMs) => {
      counts.longTasks++;
      counts.longTaskMs += durationMs;
      counts.longestTaskMs = Math.max(counts.longestTaskMs, durationMs);
    },
  };
}

declare global {
  interface Window {
    __roofyPerf?: PerfProbe & {
      /** Bytes fetched since the last reset, from Resource Timing. */
      fetchedBytes(): number;
    };
  }
}

/** Installs the probe on the real WebGL prototypes and publishes it as `window.__roofyPerf`. */
export function installPerfProbe(): void {
  if (typeof window === "undefined" || window.__roofyPerf) return;
  const glPrototype =
    typeof WebGL2RenderingContext === "undefined"
      ? null
      : WebGL2RenderingContext.prototype;
  if (!glPrototype) return;
  const probe = createPerfProbe({
    glPrototype,
    schedule: (callback) => requestAnimationFrame(callback),
  });
  let resourceMark = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        probe.recordLongTask(entry.duration);
    }).observe({ type: "longtask", buffered: false });
  } catch {
    // Long-task timing is Chromium-only; the other counters still work.
  }
  window.__roofyPerf = {
    ...probe,
    reset: () => {
      probe.reset();
      resourceMark = performance.getEntriesByType("resource").length;
    },
    fetchedBytes: () =>
      (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
        .slice(resourceMark)
        .reduce(
          (sum, entry) =>
            sum + (entry.transferSize || entry.encodedBodySize || 0),
          0,
        ),
  };
}
