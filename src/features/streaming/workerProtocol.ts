import type { BBox3 } from "../../domain/citymodel/types";
import type { RoofMetrics } from "../../domain/roofMetrics/types";
import type { Rule } from "../rules/types";
import type { CellKey } from "./tileGrid";

export interface CellGeometry {
  readonly positions: Float32Array; // 3 per vertex
  readonly normals: Float32Array; // 3 per vertex
  readonly baseColors: Float32Array; // 3 per vertex
  readonly ruleColors: Float32Array | null;
  readonly objectIndices: Uint32Array; // 1 per vertex
  readonly surfaceIndices: Uint32Array; // 1 per vertex
  readonly objectKeys: string[];
  readonly triangleCount: number;
}

/** A streaming layer's object payload. NOT a CityObject — CityObject.surfaces
 *  is non-optional, and rings are fetched on demand instead (see 'surfaces'). */
export interface ResidentObjectRecord {
  readonly id: string;
  readonly objectType: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly bbox: BBox3;
  readonly lod: string | null;
  readonly surfaceCount: number;
  readonly roofMetrics: ReadonlyArray<RoofMetrics>;
  readonly footprintAreaSqM: number;
  readonly volumeCuM: number | null;
  readonly parents: ReadonlyArray<string>;
  readonly children: ReadonlyArray<string>;
}

export type WorkerRequest =
  | { type: "open"; id: number; url: string }
  | { type: "open"; id: number; blob: Blob }
  | { type: "probe"; id: number; bbox: [number, number, number, number] }
  | {
      type: "fetch";
      id: number;
      bbox: [number, number, number, number];
      level: number;
      cells: CellKey[];
      lod: string | null;
      rules: ReadonlyArray<Rule>;
      rulesEnabled: boolean;
    }
  | {
      type: "recolor";
      id: number;
      cells: CellKey[];
      rules: ReadonlyArray<Rule>;
      rulesEnabled: boolean;
    }
  | { type: "surfaces"; id: number; objectId: string }
  | { type: "evict"; id: number; cells: CellKey[] }
  | { type: "cancel"; id: number }
  | { type: "close"; id: number };

export type WorkerResponse =
  | { type: "opened"; id: number; header: unknown; admission: unknown }
  | { type: "probed"; id: number; count: number }
  | {
      type: "cell";
      id: number;
      key: CellKey;
      geometry: CellGeometry;
      objects: ResidentObjectRecord[];
      surfaceAttrKeys: string[];
      lodsSeen: string[];
    }
  | { type: "recolored"; id: number; key: CellKey; ruleColors: Float32Array }
  | { type: "surfaceData"; id: number; objectId: string; surfaces: unknown[] }
  | { type: "done"; id: number }
  | {
      type: "error";
      id: number;
      message: string;
      code?: string;
      aborted: boolean;
    };

/** Throws if a received cell violates the length invariants. */
export function assertCellGeometry(g: CellGeometry): void {
  const v = g.triangleCount * 3;
  const check = (name: string, len: number, want: number) => {
    if (len !== want) {
      throw new Error(`cell geometry ${name}: expected ${want}, got ${len}`);
    }
  };
  check("positions", g.positions.length, v * 3);
  check("normals", g.normals.length, v * 3);
  check("baseColors", g.baseColors.length, v * 3);
  check("objectIndices", g.objectIndices.length, v);
  check("surfaceIndices", g.surfaceIndices.length, v);
  if (g.ruleColors !== null) check("ruleColors", g.ruleColors.length, v * 3);
}
