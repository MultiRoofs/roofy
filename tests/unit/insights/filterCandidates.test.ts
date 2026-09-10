import { expect, it, vi } from "vitest";
import {
  createCandidateLoader,
  columnTypeLabel,
} from "../../../src/insights/filterCandidates";
it("bounds distinct work, caches text values, and skips numbers", async () => {
  const query = vi
    .fn()
    .mockResolvedValue({ ok: true, rows: [{ value: "Building" }] });
  const load = createCandidateLoader(
    "t",
    [
      { name: "type", type: "VARCHAR", kind: "scalar" },
      { name: "height", type: "DOUBLE", kind: "scalar" },
    ],
    query,
  );
  expect(await load("height")).toEqual([]);
  expect(query).not.toHaveBeenCalled();
  expect(await load("type")).toEqual(["Building"]);
  await load("type");
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[0]).toContain("SELECT DISTINCT");
  expect(query.mock.calls[0]?.[0]).toContain("LIMIT 10000");
  expect(query.mock.calls[0]?.[0]).toContain("LIMIT 20");
  expect(
    columnTypeLabel({ name: "n", type: "DECIMAL(18,3)", kind: "castText" }),
  ).toBe("Number");
});
it("labels intervals as date/time", () => {
  expect(
    columnTypeLabel({ name: "duration", type: "INTERVAL", kind: "castText" }),
  ).toBe("Date / time");
});
