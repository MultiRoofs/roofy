/**
 * `tools/register.ts` is the WIRE: `runQueue.ts` imports it and nothing else
 * imports the tool modules, so a tool that is missing from it is unreachable
 * from a run even though its own test suite passes.
 *
 * This file therefore imports the side-effect module ONLY — never
 * `heightFromExtent` directly, which would register the executor by itself and
 * make the assertion pass for the wrong reason. Vitest isolates modules per
 * file, so the other suite's static import cannot leak in here.
 */
import { describe, expect, it } from "vitest";

import "../../../../src/features/processing/tools/register";
import { EXECUTORS } from "../../../../src/features/processing/tools";

describe("tools/register", () => {
  it("registers every shipped executor, in `register.ts`'s import order", () => {
    expect(Object.keys(EXECUTORS)).toEqual([
      "height-from-extent",
      "roof-metrics",
      "measure-solids",
      "validate-solids",
      "join-by-location",
      "distance-to-nearest",
    ]);
  });
});
