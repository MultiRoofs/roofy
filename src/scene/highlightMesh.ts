/**
 * Highlight logic for selected/hovered objects via vertex color mutation.
 *
 * Instead of creating overlay meshes, we mutate the color buffer attribute
 * in-place and restore from a snapshot (baseColors). This avoids extra
 * draw calls and geometry copies.
 */

import { Color } from "three";
import type { BufferGeometry } from "three";
import type { Selection } from "../domain/selection/types";
import type { PickingIndex } from "./buildCityMesh";

const HIGHLIGHT_COLOR = new Color(0xe8973f);
const HOVER_COLOR = new Color(0xfbbf24);

function resolveObjectIdx(
  selection: Selection | null,
  pickingIndex: PickingIndex,
): number {
  if (!selection) return -1;
  return pickingIndex.objectKeys.indexOf(selection.objectId);
}

/**
 * Apply highlight colors to the geometry's color buffer.
 * Restores base colors first, then overwrites vertices belonging
 * to the hovered and/or selected object/surface.
 */
export function applyHighlight(
  geometry: BufferGeometry,
  baseColors: Float32Array,
  selection: Selection | null,
  hovered: Selection | null,
  pickingIndex: PickingIndex,
): void {
  const colorAttr = geometry.getAttribute("color");
  if (!colorAttr) return;

  const objIdxAttr = geometry.getAttribute("objectIndex");
  const surfIdxAttr = geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return;

  // Restore base colors
  const colorArray = colorAttr.array as Float32Array;
  colorArray.set(baseColors);

  const selectedObjIdx = resolveObjectIdx(selection, pickingIndex);
  const hoveredObjIdx = resolveObjectIdx(hovered, pickingIndex);

  const vertexCount = colorAttr.count;

  for (let v = 0; v < vertexCount; v++) {
    const oIdx = objIdxAttr.getX(v);
    const sIdx = surfIdxAttr.getX(v);
    const base = v * 3;

    // Check hovered first (lower priority), then selected overrides
    if (
      hoveredObjIdx >= 0 &&
      oIdx === hoveredObjIdx &&
      matchesSurface(hovered, sIdx)
    ) {
      colorArray[base] = HOVER_COLOR.r;
      colorArray[base + 1] = HOVER_COLOR.g;
      colorArray[base + 2] = HOVER_COLOR.b;
    }

    if (
      selectedObjIdx >= 0 &&
      oIdx === selectedObjIdx &&
      matchesSurface(selection, sIdx)
    ) {
      colorArray[base] = HIGHLIGHT_COLOR.r;
      colorArray[base + 1] = HIGHLIGHT_COLOR.g;
      colorArray[base + 2] = HIGHLIGHT_COLOR.b;
    }
  }

  colorAttr.needsUpdate = true;
}

/**
 * Restore the geometry's color buffer to its base state.
 */
export function clearHighlight(
  geometry: BufferGeometry,
  baseColors: Float32Array,
): void {
  const colorAttr = geometry.getAttribute("color");
  if (!colorAttr) return;

  (colorAttr.array as Float32Array).set(baseColors);
  colorAttr.needsUpdate = true;
}

function matchesSurface(
  selection: Selection | null,
  surfaceIdx: number,
): boolean {
  if (!selection) return false;
  if (selection.kind === "object") return true;
  return selection.surfaceIndex === surfaceIdx;
}
