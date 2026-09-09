import { expect, it } from "vitest";
import {
  orderedColumns,
  moveColumn,
} from "../../../../src/ui/table/columnOrder";
const columns = ["id", "height", "type"].map((name) => ({
  name,
  type: "VARCHAR",
  kind: "scalar" as const,
}));
it("honors chosen order without resurrecting hidden id or stale columns", () => {
  expect(
    orderedColumns(columns, ["height", "missing", "type", "height"]).map(
      (c) => c.name,
    ),
  ).toEqual(["height", "type"]);
});
it("moves a column to another position without dropping others", () => {
  expect(moveColumn(["id", "height", "type"], "type", "id")).toEqual([
    "type",
    "id",
    "height",
  ]);
  expect(moveColumn(["id", "height", "type"], "id", "type")).toEqual([
    "height",
    "type",
    "id",
  ]);
});
