/**
 * Built-in rule presets for common roof classification scenarios.
 *
 * Each preset is a function that returns a Rule with a fresh UUID.
 * Presets provide one-click access to frequently used analysis patterns.
 *
 * Colours are the brand's rooftop-function hues (`--layer-*` in brand.css):
 * flat roofs take the water blue, the two sun-facing presets the energy
 * ambers, steep roofs the social orange and large roofs the nature lime — so
 * a legend of presets reads in the same palette as the mark.
 */

import type { Rule } from "./types";

export interface RulePreset {
  readonly label: string;
  readonly description: string;
  readonly create: () => Rule;
}

export const RULE_PRESETS: ReadonlyArray<RulePreset> = [
  {
    label: "Flat roofs",
    description: "Roofs with inclination < 10\u00B0",
    create: () => ({
      id: crypto.randomUUID(),
      name: "Flat roofs",
      color: "#3b82f6",
      logic: "AND",
      conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
      enabled: true,
    }),
  },
  {
    label: "South-facing",
    description: "Roofs facing 135\u2013225\u00B0 with tilt",
    create: () => ({
      id: crypto.randomUUID(),
      name: "South-facing",
      color: "#f0a800",
      logic: "AND",
      conditions: [
        { field: "azimuthDeg", operator: ">=", value: 135 },
        { field: "azimuthDeg", operator: "<=", value: 225 },
        { field: "inclinationDeg", operator: ">=", value: 10 },
      ],
      enabled: true,
    }),
  },
  {
    label: "Steep roofs",
    description: "Roofs with inclination > 45\u00B0",
    create: () => ({
      id: crypto.randomUUID(),
      name: "Steep roofs",
      color: "#f2683c",
      logic: "AND",
      conditions: [{ field: "inclinationDeg", operator: ">", value: 45 }],
      enabled: true,
    }),
  },
  {
    label: "Large roofs",
    description: "Roof surfaces > 50 m\u00B2",
    create: () => ({
      id: crypto.randomUUID(),
      name: "Large roofs",
      color: "#a7e32b",
      logic: "AND",
      conditions: [{ field: "areaSqM", operator: ">", value: 50 }],
      enabled: true,
    }),
  },
  {
    label: "Solar suitable",
    description: "South-facing, tilt 15\u201345\u00B0, area > 20 m\u00B2",
    create: () => ({
      id: crypto.randomUUID(),
      name: "Solar suitable",
      color: "#ffc530",
      logic: "AND",
      conditions: [
        { field: "azimuthDeg", operator: ">=", value: 120 },
        { field: "azimuthDeg", operator: "<=", value: 240 },
        { field: "inclinationDeg", operator: ">=", value: 15 },
        { field: "inclinationDeg", operator: "<=", value: 45 },
        { field: "areaSqM", operator: ">", value: 20 },
      ],
      enabled: true,
    }),
  },
];
