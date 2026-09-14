/** Descriptor contracts remain available independently of result-card shortcuts. */
import { describe, expect, it } from "vitest";
import "../../../../src/features/processing/tools/register";
import { toolById } from "../../../../src/features/processing/toolRegistry";
import {
  resolveStyleOperator,
  resolveStyleValueSource,
} from "../../../../src/features/processing/types";
describe("Style descriptors", () => {
  it("reads §7.5's descriptor DIRECTLY: the first copied TEXT field, most frequent", () => {
    // Join's descriptor, without the footer. Its `pick` looks for a VARCHAR,
    // and a written column's TYPE is reproduced from `tool.outputColumns` —
    // which Join does not have until Task 15 embeds its `fieldTypes`. So the
    // columns are typed HERE, and Task 16, where Join ships, adds the footer
    // case that presses the button and reads `mode(` off the statement.
    const descriptor = toolById("join-by-location").styleByResult!;
    const text = { name: "zones_name", type: "VARCHAR" as const };
    const count = { name: "zones_matches_n", type: "DOUBLE" as const };

    expect(descriptor.pick([text, count])).toEqual(text);
    expect(resolveStyleOperator(descriptor, text)).toBe("=");
    expect(resolveStyleValueSource(descriptor, text)).toEqual({
      kind: "mostFrequent",
    });
    // §7.5's other half: "if no text field was copied, on
    // `<prefix>matches_n > 0`". The SAME descriptor, a different column —
    // which is what the operator/value FUNCTION unions exist for.
    expect(descriptor.pick([count])).toEqual(count);
    expect(resolveStyleOperator(descriptor, count)).toBe(">");
    expect(resolveStyleValueSource(descriptor, count)).toEqual({
      kind: "literal",
      value: 0,
    });
  });

  it("resolves a PLAIN descriptor's operator and value as they are", () => {
    // The five tools that need one answer pass it plainly, and the resolvers
    // must hand those straight back — `RunFooter` has no branch of its own.
    const solids = toolById("measure-solids").styleByResult!;
    const column = { name: "solid_volume_m3", type: "DOUBLE" as const };
    expect(resolveStyleOperator(solids, column)).toBe(">");
    expect(resolveStyleValueSource(solids, column)).toEqual({ kind: "median" });
  });
});
