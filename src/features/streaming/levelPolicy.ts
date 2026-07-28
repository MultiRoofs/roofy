/**
 * One uniform level for the whole viewport, and the LoD that goes with it.
 *
 * Uniform (not adaptive per-cell) because adaptive refinement costs one
 * R-tree traversal per probe: ~37N traversals for an N-cell viewport. One
 * level also means one LoD, so there are no mixed-LoD seams.
 */
import { cellSize, keysCovering, type Grid } from "./tileGrid";
import { MAX_COVER_CELLS, MIN_COVER_CELLS } from "./constants";

export type LodSelection =
  | { kind: "all" }
  | { kind: "unlabelled" }
  | { kind: "exact"; lod: string };

export function chooseLevel(
  grid: Grid,
  footprintBBox: [number, number, number, number],
): number | null {
  const [minX, minY, maxX, maxY] = footprintBBox;
  // Reject degenerate footprints with zero or negative extent (T4-F2)
  if (maxX <= minX || maxY <= minY) return null;

  for (let level = 0; level <= grid.maxLevel; level++) {
    const n = keysCovering(grid, footprintBBox, level).length;
    if (n >= MIN_COVER_CELLS) return n <= MAX_COVER_CELLS ? level : null;
  }
  return null;
}

/** Observed LoD labels, ascending. `null` is absence of a label, not a LoD. */
export function buildLadder(observed: ReadonlyArray<string | null>): string[] {
  const set = new Set<string>();
  for (const l of observed) if (l !== null) set.add(l);
  return [...set].sort((a, b) => {
    // Numeric labels first, sorted numerically; then non-numeric, sorted lexicographically (T4-F1)
    const numA = Number(a);
    const numB = Number(b);
    const aIsNum = !isNaN(numA);
    const bIsNum = !isNaN(numB);

    if (aIsNum && bIsNum) return numA - numB;
    if (aIsNum) return -1; // numeric before non-numeric
    if (bIsNum) return 1;
    return a.localeCompare(b); // both non-numeric: lexicographic
  });
}

export function lodForCellSize(
  ladder: ReadonlyArray<string>,
  cellSizeM: number,
): LodSelection {
  const n = ladder.length;
  if (n === 0) return { kind: "all" };
  if (cellSizeM > 2000) return { kind: "exact", lod: ladder[0]! };
  if (cellSizeM < 200) return { kind: "exact", lod: ladder[n - 1]! };
  return { kind: "exact", lod: ladder[Math.floor((n - 1) / 2)]! };
}

export { cellSize };
