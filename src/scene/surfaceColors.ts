/**
 * Three.js Color instances derived from the shared surface color map.
 * Used by the mesh builder for vertex colors.
 */

import { Color } from "three";
import type { BuildingSurfaceType } from "../domain/citymodel/types";
import { SURFACE_COLOR_VALUES } from "../shared/surfaceColorMap";

export const SURFACE_COLORS: Record<BuildingSurfaceType, Color> =
  Object.fromEntries(
    Object.entries(SURFACE_COLOR_VALUES).map(([k, v]) => [k, new Color(v)]),
  ) as Record<BuildingSurfaceType, Color>;
