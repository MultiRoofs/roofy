/**
 * LRU cache of resident cells under triangle and byte budgets.
 *
 * Budgets are on triangles and bytes, measured AFTER decode, because feature
 * count does not bound memory: one FCB feature can carry several CityObjects
 * and multiple complete LoDs.
 */
import type { CellKey } from "./tileGrid";

export interface CellStats {
  readonly triangles: number;
  readonly bytes: number;
}

interface Entry<T> {
  value: T;
  stats: CellStats;
  lastSeen: number;
  pinned: boolean;
}

export interface CellCacheOpts {
  readonly maxTriangles: number;
  readonly maxBytes: number;
}

export class CellCache<T> {
  private readonly entries = new Map<CellKey, Entry<T>>();
  private clock = 0;

  constructor(private readonly opts: CellCacheOpts) {}

  get(key: CellKey): T | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: CellKey): boolean {
    return this.entries.has(key);
  }

  keys(): CellKey[] {
    return [...this.entries.keys()];
  }

  set(key: CellKey, value: T, stats: CellStats): void {
    this.entries.set(key, {
      value,
      stats,
      lastSeen: ++this.clock,
      pinned: this.entries.get(key)?.pinned ?? false,
    });
  }

  touch(key: CellKey): void {
    const e = this.entries.get(key);
    if (e) e.lastSeen = ++this.clock;
  }

  pin(key: CellKey): void {
    const e = this.entries.get(key);
    if (e) e.pinned = true;
  }

  unpin(key: CellKey): void {
    const e = this.entries.get(key);
    if (e) e.pinned = false;
  }

  totals(): CellStats {
    let triangles = 0;
    let bytes = 0;
    for (const e of this.entries.values()) {
      triangles += e.stats.triangles;
      bytes += e.stats.bytes;
    }
    return { triangles, bytes };
  }

  /** Evicts LRU-first until within budget. Pinned cells are never evicted;
   *  if they alone exceed budget this returns early and the caller must
   *  surface that visibly rather than dropping them. */
  evictToBudget(): CellKey[] {
    const evicted: CellKey[] = [];
    const overBudget = () => {
      const t = this.totals();
      return (
        t.triangles > this.opts.maxTriangles || t.bytes > this.opts.maxBytes
      );
    };
    while (overBudget()) {
      let oldest: CellKey | undefined;
      let oldestSeen = Infinity;
      for (const [k, e] of this.entries) {
        if (e.pinned) continue;
        if (e.lastSeen < oldestSeen) {
          oldestSeen = e.lastSeen;
          oldest = k;
        }
      }
      if (oldest === undefined) break; // only pinned cells remain
      this.entries.delete(oldest);
      evicted.push(oldest);
    }
    return evicted;
  }

  /** Drops every cell outside `keep`, returning what was removed. */
  retain(keep: ReadonlyArray<CellKey>): CellKey[] {
    const keepSet = new Set(keep);
    const removed: CellKey[] = [];
    for (const k of [...this.entries.keys()]) {
      if (!keepSet.has(k)) {
        this.entries.delete(k);
        removed.push(k);
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }
}
