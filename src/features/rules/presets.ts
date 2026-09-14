/**
 * Built-in rule presets for common roof classification scenarios.
 *
 * Each preset is a function that returns a Rule with a fresh UUID.
 * Presets provide one-click access to frequently used analysis patterns.
 *
 * Colours are the brand's rooftop-function hues (`--layer-*` in brand.css):
 * flat roofs take the water blue, the two sun-facing presets the energy
 * ambers, steep roofs the social orange and large roofs lime-700 — lime-500
 * itself is the SELECTION colour (`scene/cityColors.ts`), and a preset
 * equal to it would make a selected surface look unselected.
 *
 * The colour is also a FIELD, not only something `create()` bakes in: the
 * Style section draws each preset as a chip with its swatch, and a chip that
 * had to mint a throwaway rule (and a throwaway UUID) on every render just to
 * learn its own colour would be two sources for one fact.
 */

import type { Condition, LogicMode, Rule } from "./types";

export interface RulePreset {
  readonly label: string;
  readonly description: string;
  /** The colour the created rule wears, and the chip's swatch. */
  readonly color: string;
  readonly create: () => Rule;
}

function preset(
  label: string,
  description: string,
  color: string,
  logic: LogicMode,
  conditions: ReadonlyArray<Condition>,
): RulePreset {
  return {
    label,
    description,
    color,
    create: () => ({
      id: crypto.randomUUID(),
      name: label,
      color,
      logic,
      conditions: [...conditions],
      enabled: true,
    }),
  };
}

export const RULE_PRESETS: ReadonlyArray<RulePreset> = [
  preset("Flat roofs", "Roofs with inclination < 10°", "#3b82f6", "AND", [
    { field: "inclinationDeg", operator: "<", value: 10 },
  ]),
  preset("South-facing", "Roofs facing 135–225° with tilt", "#f0a800", "AND", [
    { field: "azimuthDeg", operator: ">=", value: 135 },
    { field: "azimuthDeg", operator: "<=", value: 225 },
    { field: "inclinationDeg", operator: ">=", value: 10 },
  ]),
  preset("Steep roofs", "Roofs with inclination > 45°", "#f2683c", "AND", [
    { field: "inclinationDeg", operator: ">", value: 45 },
  ]),
  preset("Large roofs", "Roof surfaces > 50 m²", "#7cb518", "AND", [
    { field: "areaSqM", operator: ">", value: 50 },
  ]),
  preset(
    "Solar suitable",
    "South-facing, tilt 15–45°, area > 20 m²",
    "#ffc530",
    "AND",
    [
      { field: "azimuthDeg", operator: ">=", value: 120 },
      { field: "azimuthDeg", operator: "<=", value: 240 },
      { field: "inclinationDeg", operator: ">=", value: 15 },
      { field: "inclinationDeg", operator: "<=", value: 45 },
      { field: "areaSqM", operator: ">", value: 20 },
    ],
  ),
];
