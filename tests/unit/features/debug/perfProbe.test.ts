import { describe, expect, it } from "vitest";
import { createPerfProbe } from "../../../../src/features/debug/perfProbe";

/** A stand-in for `WebGL2RenderingContext.prototype`: the probe wraps methods by name. */
function fakeGlPrototype() {
  const calls: string[] = [];
  const proto = {
    drawArrays: () => calls.push("drawArrays"),
    drawElements: () => calls.push("drawElements"),
    drawArraysInstanced: () => calls.push("drawArraysInstanced"),
    drawElementsInstanced: () => calls.push("drawElementsInstanced"),
    bufferData: (_t: number, data: ArrayBufferView | number) =>
      calls.push(
        `bufferData:${typeof data === "number" ? data : data.byteLength}`,
      ),
    bufferSubData: () => calls.push("bufferSubData"),
    texImage2D: () => calls.push("texImage2D"),
    texSubImage2D: () => calls.push("texSubImage2D"),
    readPixels: () => calls.push("readPixels"),
  };
  return { proto, calls };
}

function manualClock() {
  let callback: (() => void) | null = null;
  return {
    schedule: (cb: () => void) => {
      callback = cb;
    },
    tick: () => {
      const cb = callback;
      callback = null;
      cb?.();
    },
  };
}

describe("perfProbe", () => {
  it("counts draw calls and still calls through to the original methods", () => {
    const { proto, calls } = fakeGlPrototype();
    const clock = manualClock();
    const probe = createPerfProbe({
      glPrototype: proto,
      schedule: clock.schedule,
    });
    proto.drawArrays();
    proto.drawElements();
    proto.drawElementsInstanced();
    expect(calls).toEqual([
      "drawArrays",
      "drawElements",
      "drawElementsInstanced",
    ]);
    expect(probe.snapshot().drawCalls).toBe(3);
  });

  it("sums the vertices each draw asks for, instances multiplied", () => {
    const { proto } = fakeGlPrototype();
    const probe = createPerfProbe({
      glPrototype: proto,
      schedule: manualClock().schedule,
    });
    const call = (name: keyof typeof proto, ...args: unknown[]) =>
      (proto[name] as (...a: unknown[]) => void)(...args);
    call("drawArrays", 4, 0, 30); // mode, first, count
    call("drawElements", 4, 600, 5125, 0); // mode, count, type, offset
    call("drawArraysInstanced", 4, 0, 6, 10); // + instance count
    call("drawElementsInstanced", 4, 12, 5123, 0, 5);
    expect(probe.snapshot().drawnVertices).toBe(30 + 600 + 60 + 60);
    probe.reset();
    expect(probe.snapshot().drawnVertices).toBe(0);
  });

  it("sums uploaded bytes from typed arrays and sized allocations", () => {
    const { proto } = fakeGlPrototype();
    const probe = createPerfProbe({
      glPrototype: proto,
      schedule: manualClock().schedule,
    });
    proto.bufferData(0, new Float32Array(10));
    proto.bufferData(0, 64);
    (proto.bufferSubData as (t: number, o: number, d: ArrayBufferView) => void)(
      0,
      0,
      new Uint8Array(5),
    );
    (proto.texSubImage2D as (...a: unknown[]) => void)(
      0,
      0,
      0,
      0,
      2,
      2,
      0,
      0,
      new Uint8Array(16),
    );
    expect(probe.snapshot().uploadedBytes).toBe(40 + 64 + 5 + 16);
  });

  it("counts a frame only for a tick in which something was drawn", () => {
    const { proto } = fakeGlPrototype();
    const clock = manualClock();
    const probe = createPerfProbe({
      glPrototype: proto,
      schedule: clock.schedule,
    });
    clock.tick(); // nothing drawn
    proto.drawArrays();
    clock.tick();
    clock.tick(); // idle
    proto.drawElements();
    proto.drawElements();
    clock.tick();
    expect(probe.snapshot().frames).toBe(2);
    expect(probe.snapshot().ticks).toBe(4);
  });

  it("counts synchronous readbacks", () => {
    const { proto } = fakeGlPrototype();
    const probe = createPerfProbe({
      glPrototype: proto,
      schedule: manualClock().schedule,
    });
    proto.readPixels();
    expect(probe.snapshot().readbacks).toBe(1);
  });

  it("reset zeroes every counter", () => {
    const { proto } = fakeGlPrototype();
    const clock = manualClock();
    const probe = createPerfProbe({
      glPrototype: proto,
      schedule: clock.schedule,
    });
    proto.drawArrays();
    proto.bufferData(0, 8);
    clock.tick();
    probe.reset();
    expect(probe.snapshot()).toMatchObject({
      drawCalls: 0,
      uploadedBytes: 0,
      frames: 0,
      ticks: 0,
      readbacks: 0,
      longTasks: 0,
      longTaskMs: 0,
    });
  });

  it("records long tasks it is told about", () => {
    const { proto } = fakeGlPrototype();
    const probe = createPerfProbe({
      glPrototype: proto,
      schedule: manualClock().schedule,
    });
    probe.recordLongTask(120);
    probe.recordLongTask(60);
    expect(probe.snapshot()).toMatchObject({
      longTasks: 2,
      longTaskMs: 180,
      longestTaskMs: 120,
    });
  });
});
