/**
 * TypeScript types for CityJSON Text Sequences (CityJSONSeq).
 *
 * A .city.jsonl file contains:
 *   Line 1: A CityJSON header (valid CityJSON object with empty CityObjects/vertices)
 *   Line 2+: CityJSONFeature objects, each with local vertices
 *
 * Reference: https://www.cityjson.org/specs/ §7.2
 */

import type { CityJSONObject, CityJSONVertex } from "../cityjson/types";

export interface CityJSONFeature {
  readonly type: "CityJSONFeature";
  readonly id: string;
  readonly CityObjects: Readonly<Record<string, CityJSONObject>>;
  readonly vertices: ReadonlyArray<CityJSONVertex>;
  readonly appearance?: unknown;
}
