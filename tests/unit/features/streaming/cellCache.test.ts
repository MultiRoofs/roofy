import { describe, it, expect } from "vitest";
import { CellCache } from "../../../../src/features/streaming/cellCache";

const S = (triangles: number) => ({ triangles, bytes: triangles * 100 });

describe("CellCache", () => {
  it("evicts least-recently-used first when over the triangle budget (T5-F1)", () => {
    const c = new CellCache<string>({ maxTriangles: 250, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.set("b", "B", S(100));
    c.set("c", "C", S(100)); // now 300 > 250
    c.touch("a"); // a becomes most recent; b is now oldest
    const evicted = c.evictToBudget();
    expect(evicted).toEqual(["b"]); // b is oldest, should be evicted first
    expect(c.has("b")).toBe(false);
    expect(c.has("a")).toBe(true);
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

  it("preserves pinned state on replacement (T5-F2)", () => {
    const c = new CellCache<string>({ maxTriangles: 150, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.pin("a");
    // Replace a with new stats
    c.set("a", "A_new", S(100));
    expect(c.get("a")).toBe("A_new");
    // evictToBudget should not evict the pinned replacement
    c.set("b", "B", S(100)); // now 200 > 150
    expect(c.evictToBudget()).toEqual(["b"]);
    expect(c.has("a")).toBe(true);
  });

  it("stops when pinned cells alone exceed budget; unpinned cells also present (T5-F3)", () => {
    const c = new CellCache<string>({ maxTriangles: 100, maxBytes: Infinity });
    c.set("a", "A", S(150)); // pinned alone exceeds budget
    c.pin("a");
    c.set("b", "B", S(50)); // now 200 > 100
    const evicted = c.evictToBudget();
    expect(evicted).toEqual(["b"]); // unpinned b is evicted
    expect(c.has("a")).toBe(true); // pinned a stays even though it alone exceeds budget
    expect(c.totals().triangles).toBe(150); // STILL over the 100 budget
  });

  it("get() returns undefined for missing keys (T5-F4)", () => {
    const c = new CellCache<string>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    c.set("a", "A", S(1));
    expect(c.get("a")).toBe("A");
    expect(c.get("nonexistent")).toBeUndefined();
  });

  it("replacement updates stats; unpin() allows eviction (T5-F4)", () => {
    const c = new CellCache<string>({ maxTriangles: 100, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.set("a", "A2", S(50)); // replace with different stats
    expect(c.totals().triangles).toBe(50); // not 150, proof of replacement
    c.pin("a");
    c.unpin("a"); // unpin for eviction test
    c.set("b", "B", S(100)); // now 150 > 100 (with a=50)
    const evicted = c.evictToBudget();
    expect(evicted).toEqual(["a"]); // a is now unpinned and oldest
    expect(c.has("a")).toBe(false);
  });

  it("clear() removes all cells (T5-F4)", () => {
    const c = new CellCache<string>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    c.set("a", "A", S(1));
    c.set("b", "B", S(1));
    c.clear();
    expect(c.keys()).toEqual([]);
    expect(c.totals()).toEqual({ triangles: 0, bytes: 0 });
  });
});
