import { describe, it, expect } from "vitest";
import { CellCache } from "../../../../src/features/streaming/cellCache";

const S = (triangles: number) => ({ triangles, bytes: triangles * 100 });

describe("CellCache", () => {
  it("evicts least-recently-used first when over the triangle budget", () => {
    const c = new CellCache<string>({ maxTriangles: 250, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.set("b", "B", S(100));
    c.set("c", "C", S(100)); // now 300 > 250
    c.touch("b"); // b becomes most recent; a is oldest
    const evicted = c.evictToBudget();
    expect(evicted).toEqual(["a"]);
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
  });

  it("never evicts a pinned cell", () => {
    const c = new CellCache<string>({ maxTriangles: 150, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.set("b", "B", S(100));
    c.pin("a"); // a is oldest but pinned
    expect(c.evictToBudget()).toEqual(["b"]);
    expect(c.has("a")).toBe(true);
  });

  it("stops rather than dropping pinned cells when they alone exceed budget", () => {
    const c = new CellCache<string>({ maxTriangles: 50, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.pin("a");
    expect(c.evictToBudget()).toEqual([]);
    expect(c.has("a")).toBe(true); // visible message is the caller's job
  });

  it("enforces the byte budget independently of triangles", () => {
    const c = new CellCache<string>({ maxTriangles: Infinity, maxBytes: 150 });
    c.set("a", "A", { triangles: 1, bytes: 100 });
    c.set("b", "B", { triangles: 1, bytes: 100 });
    expect(c.evictToBudget()).toEqual(["a"]);
  });

  it("retain() drops everything outside the desired cover", () => {
    const c = new CellCache<string>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    c.set("a", "A", S(1));
    c.set("b", "B", S(1));
    c.set("c", "C", S(1));
    expect(c.retain(["b", "c"]).sort()).toEqual(["a"]);
    expect(c.keys().sort()).toEqual(["b", "c"]);
  });

  it("reports running totals", () => {
    const c = new CellCache<string>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    c.set("a", "A", S(10));
    c.set("b", "B", S(5));
    expect(c.totals()).toEqual({ triangles: 15, bytes: 1500 });
  });
});
