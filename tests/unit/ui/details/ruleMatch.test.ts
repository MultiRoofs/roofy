/**
 * RULE MATCH — which rule coloured a selection, by rule identity (never by
 * colour). Pure, pinned against the core rule engine.
 */
import { describe, expect, it } from "vitest";
import type { CityObject } from "../../../../src/domain/citymodel/types";
import type { RoofMetrics } from "@cityjson/navara-core";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { Rule } from "../../../../src/features/rules/types";
import { ruleMatchFor } from "../../../../src/ui/details/ruleMatch";
import type { ResolvedBuilding } from "../../../../src/ui/details/subject";

function rule(overrides: Partial<Rule> & { id: string }): Rule {
  return {
    name: "rule",
    color: "#ff0000",
    conditions: [],
    logic: "AND",
    enabled: true,
    ...overrides,
  };
}

const FLAT = rule({
  id: "r1",
  name: "Flat roofs",
  conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
});

function metrics(inclinationDeg: number): RoofMetrics {
  return { areaSqM: 100, inclinationDeg, azimuthDeg: 180, elevationM: 0 };
}

function layer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "Delft",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    },
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    colorBy: "rules",
    singleColor: "#000000",
    unmatchedColor: "#000000",
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    ...overrides,
  } as Layer;
}

function owner(id: string): CityObject {
  return {
    id,
    objectType: "Building",
    attributes: {},
    surfaces: [],
    bbox: null,
    children: [],
    parents: [],
    lod: null,
  };
}

describe("ruleMatchFor", () => {
  it("is null when the layer is not coloured by rules", () => {
    const building: ResolvedBuilding = {
      object: owner("o"),
      parts: [],
      roofSurfaces: [{ owner: owner("o"), metrics: metrics(5) }],
      loading: false,
    };
    expect(ruleMatchFor(building, layer({ colorBy: "surface" }))).toBeNull();
    expect(ruleMatchFor(building, layer({ colorBy: "single" }))).toBeNull();
  });

  it("matches a surface by rule identity, two same-coloured rules told apart", () => {
    const twinA = rule({
      id: "a",
      name: "Shallow A",
      color: "#00ff00",
      conditions: [{ field: "inclinationDeg", operator: "<", value: 45 }],
    });
    const twinB = rule({
      id: "b",
      name: "Steep B",
      color: "#00ff00",
      conditions: [{ field: "inclinationDeg", operator: ">", value: 60 }],
    });
    const l = layer({ rules: [twinA, twinB] });

    const subject = {
      surface: {
        type: "RoofSurface",
        rings: [],
        attributes: {},
        lod: null,
      } as const,
      owner: owner("o"),
      metrics: metrics(30),
    };
    const result = ruleMatchFor(subject, l);
    expect(result).toEqual({ kind: "surface", rule: twinA });

    const subjectB = { ...subject, metrics: metrics(70) };
    expect(ruleMatchFor(subjectB, l)).toEqual({ kind: "surface", rule: twinB });
  });

  it("is null (unmatched) when no rule applies", () => {
    const l = layer({ rules: [FLAT] });
    const subject = {
      surface: {
        type: "RoofSurface",
        rings: [],
        attributes: {},
        lod: null,
      } as const,
      owner: owner("o"),
      metrics: metrics(45),
    };
    expect(ruleMatchFor(subject, l)).toEqual({ kind: "surface", rule: null });
  });

  it("counts per-rule roof surfaces and the unmatched remainder for a building", () => {
    const l = layer({ rules: [FLAT] });
    const o = owner("o");
    const building: ResolvedBuilding = {
      object: o,
      parts: [],
      roofSurfaces: [
        { owner: o, metrics: metrics(5) },
        { owner: o, metrics: metrics(3) },
        { owner: o, metrics: metrics(45) },
      ],
      loading: false,
    };

    expect(ruleMatchFor(building, l)).toEqual({
      kind: "building",
      matched: [{ rule: FLAT, surfaces: 2 }],
      unmatched: 1,
    });
  });
});
