import { BASE_CELL_M, MIN_CELL_M } from "./constants";
import type { BBox3, Vec3 } from "../../domain/citymodel/types";

/** The rotated origin delta for a cell mesh — see sceneTransform for why
 *  this is (d.x, d.z, −d.y) and not `d` componentwise. */
export function meshOffset(cellCentre: Vec3, sceneOrigin: Vec3): Vec3 {
  const dx = cellCentre[0] - sceneOrigin[0];
  const dy = cellCentre[1] - sceneOrigin[1];
  const dz = cellCentre[2] - sceneOrigin[2];
  return [dx, dz, -dy];
}

export type CellKey = string;

export interface Grid {
  readonly originX: number;
  readonly originY: number;
  readonly rootCell: number;
  readonly maxLevel: number;
}

export function makeGrid(extent: BBox3): Grid {
  const span = Math.max(extent[3] - extent[0], extent[4] - extent[1]);
  let rootCell = BASE_CELL_M;
  while (rootCell < span) rootCell *= 2;
  let maxLevel = 0;
  while (rootCell / 2 ** (maxLevel + 1) >= MIN_CELL_M) maxLevel++;
  return { originX: extent[0], originY: extent[1], rootCell, maxLevel };
}

export function cellSize(grid: Grid, level: number): number {
  return grid.rootCell / 2 ** level;
}

function parse(key: CellKey): [number, number, number] {
  const [l, c, r] = key.split("/").map(Number);
  return [l!, c!, r!];
}

export function cellBBox(
  grid: Grid,
  key: CellKey,
): [number, number, number, number] {
  const [level, col, row] = parse(key);
  const s = cellSize(grid, level);
  const x = grid.originX + col * s;
  const y = grid.originY + row * s;
  return [x, y, x + s, y + s];
}

export function cellCentre(grid: Grid, key: CellKey, z: number): Vec3 {
  const b = cellBBox(grid, key);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, z];
}

/** Cells are half-open [min,max); the outer maximum clamps into the last
 *  row/column so nothing falls through the top edge. */
function indexOf(
  grid: Grid,
  coord: number,
  axisOrigin: number,
  level: number,
): number {
  const s = cellSize(grid, level);
  const n = 2 ** level;
  const i = Math.floor((coord - axisOrigin) / s);
  return Math.min(Math.max(i, 0), n - 1);
}

export function keysCovering(
  grid: Grid,
  bbox: [number, number, number, number],
  level: number,
): CellKey[] {
  const c0 = indexOf(grid, bbox[0], grid.originX, level);
  const c1 = indexOf(grid, bbox[2], grid.originX, level);
  const r0 = indexOf(grid, bbox[1], grid.originY, level);
  const r1 = indexOf(grid, bbox[3], grid.originY, level);
  const out: CellKey[] = [];
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) out.push(`${level}/${c}/${r}`);
  }
  return out;
}

export function ownerKey(
  grid: Grid,
  featureBBox: BBox3,
  level: number,
): CellKey | null {
  // Reject if any bbox component is non-finite
  for (let i = 0; i < 6; i++) {
    if (!Number.isFinite(featureBBox[i])) return null;
  }
  const cx = (featureBBox[0] + featureBBox[3]) / 2;
  const cy = (featureBBox[1] + featureBBox[4]) / 2;
  const col = indexOf(grid, cx, grid.originX, level);
  const row = indexOf(grid, cy, grid.originY, level);
  return `${level}/${col}/${row}`;
}
