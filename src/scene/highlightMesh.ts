/**
 * Highlight logic for selected/hovered objects via vertex color mutation.
 *
 * Instead of creating overlay meshes, we mutate the color buffer attribute
 * in-place and restore from a snapshot (baseColors). This avoids extra
 * draw calls and geometry copies.
 *
 * Supports multi-select (Selection[]).
 */

import { Color } from "three";
import type { BufferGeometry } from "three";
import type { Selection } from "../domain/selection/types";
import type { PickingIndex } from "./buildCityMesh";

const HIGHLIGHT_COLOR = new Color(0xe8973f);
const HOVER_COLOR = new Color(0xfbbf24);

function resolveObjectIdx(
  selection: Selection,
  pickingIndex: PickingIndex,
): number {
  return pickingIndex.objectKeys.indexOf(selection.objectId);
}

/**
 * Apply highlight colors to the geometry's color buffer.
 * Restores from ruleColors (if present) or baseColors, then overwrites
 * vertices belonging to the hovered and/or selected objects/surfaces.
 *
 * Color layer stack: baseColors -> ruleColors -> highlight
 */
export function applyHighlight(
  geometry: BufferGeometry,
  baseColors: Float32Array,
  selections: ReadonlyArray<Selection>,
  hovered: Selection | null,
  pickingIndex: PickingIndex,
  ruleColors?: Float32Array | null,
): void {
  const colorAttr = geometry.getAttribute("color");
  if (!colorAttr) return;

  const objIdxAttr = geometry.getAttribute("objectIndex");
  const surfIdxAttr = geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return;

  // Restore from rule-colorized baseline (if active) or base colors
  const colorArray = colorAttr.array as Float32Array;
  colorArray.set(ruleColors ?? baseColors);

  // Build lookup for selected objects
  const selectedSet = new Map<number, Selection>();
  for (const sel of selections) {
    const idx = resolveObjectIdx(sel, pickingIndex);
    if (idx >= 0) selectedSet.set(idx, sel);
  }

  const hoveredObjIdx = hovered ? resolveObjectIdx(hovered, pickingIndex) : -1;

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

    const sel = selectedSet.get(oIdx);
    if (sel && matchesSurface(sel, sIdx)) {
      colorArray[base] = HIGHLIGHT_COLOR.r;
      colorArray[base + 1] = HIGHLIGHT_COLOR.g;
      colorArray[base + 2] = HIGHLIGHT_COLOR.b;
    }
  }

  colorAttr.needsUpdate = true;
}

/**
 * Restore the geometry's color buffer to its base or rule-colored state.
 */
export function clearHighlight(
  geometry: BufferGeometry,
  baseColors: Float32Array,
  ruleColors?: Float32Array | null,
): void {
  const colorAttr = geometry.getAttribute("color");
  if (!colorAttr) return;

  (colorAttr.array as Float32Array).set(ruleColors ?? baseColors);
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
