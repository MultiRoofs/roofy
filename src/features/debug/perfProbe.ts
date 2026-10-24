/**
 * A measuring probe for the browser performance harness
 * (`scripts/performance/browser-harness.mjs`).
 *
 * It wraps the WebGL prototype rather than the engine, so it counts what the
 * GPU is actually asked to do whoever asks: draw calls, bytes uploaded into
 * buffers and textures, synchronous readbacks, the vertices the draws ask for
 * (what culling saves), and frames, where a frame is an
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
  /** Vertices (or indices) all draws asked for, instances multiplied. */
  readonly drawnVertices: number;
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

/** Channels per texel of a WebGL2 pixel format; 4 for anything unlisted. */
const FORMAT_CHANNELS: Readonly<Record<number, number>> = {
  0x1902: 1, // DEPTH_COMPONENT
  0x1903: 1, // RED
  0x8d94: 1, // RED_INTEGER
  0x8227: 2, // RG
  0x8228: 2, // RG_INTEGER
  0x1907: 3, // RGB
  0x8d98: 3, // RGB_INTEGER
};

/** What a ranged sub-upload sends, or null when the call is not ranged.
 *  three passes the whole source array with a range: `bufferSubData`'s
 *  `srcOffset, length` (in elements) for an attribute's update ranges, and
 *  `texSubImage2D`'s `width x height` (with `UNPACK_ROW_LENGTH` set) for a
 *  DataTexture's. Counting the array would count bytes never sent. */
function rangedBytes(name: string, args: readonly unknown[]): number | null {
  if (name === "bufferSubData") {
    const data = args[2];
    const length = args[4];
    if (ArrayBuffer.isView(data) && typeof length === "number" && length > 0) {
      const element =
        "BYTES_PER_ELEMENT" in data ? (data.BYTES_PER_ELEMENT as number) : 1;
      return length * element;
    }
    return null;
  }
  if (name === "texSubImage2D") {
    const data = args[8];
    const [width, height, format] = [args[4], args[5], args[6]];
    if (
      ArrayBuffer.isView(data) &&
      typeof width === "number" &&
      typeof height === "number" &&
      typeof format === "number"
    ) {
      const element =
        "BYTES_PER_ELEMENT" in data ? (data.BYTES_PER_ELEMENT as number) : 1;
      const texel = (FORMAT_CHANNELS[format] ?? 4) * element;
      return Math.min(data.byteLength, width * height * texel);
    }
  }
  return null;
}

function uploadBytes(
  name: string,
  args: readonly unknown[],
  positions: readonly number[],
): number {
  const ranged = rangedBytes(name, args);
  if (ranged !== null) return ranged;
  // Calls come in several overloads; the data sits at the last of the listed
  // positions that holds a sized value, or at the final argument.
  for (let i = positions.length - 1; i >= 0; i--) {
    const size = byteSize(args[positions[i]!]);
    if (size > 0) return size;
  }
  return byteSize(args[args.length - 1]);
}

/** The vertex (or index) count a draw asks for, by the WebGL2 signatures. */
function drawnVertices(
  name: (typeof DRAW_METHODS)[number],
  args: readonly unknown[],
): number {
  const n = (i: number) => (typeof args[i] === "number" ? args[i] : 0);
  switch (name) {
    case "drawArrays":
      return n(2);
    case "drawElements":
      return n(1);
    case "drawArraysInstanced":
      return n(2) * n(3);
    case "drawElementsInstanced":
      return n(1) * n(4);
    case "drawRangeElements":
      return n(3);
  }
}

export function createPerfProbe(options: PerfProbeOptions): PerfProbe {
  const proto = options.glPrototype as Record<string, unknown>;
  const counts = {
    ticks: 0,
    frames: 0,
    drawCalls: 0,
    drawnVertices: 0,
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

  for (const name of DRAW_METHODS) {
    wrap(name, (args) => {
      counts.drawCalls++;
      counts.drawnVertices += drawnVertices(name, args);
    });
  }
  for (const name of READBACK_METHODS)
    wrap(name, () => void counts.readbacks++);
  for (const [name, positions] of Object.entries(UPLOAD_METHODS)) {
    wrap(name, (args) => {
      counts.uploadedBytes += uploadBytes(name, args, positions);
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
