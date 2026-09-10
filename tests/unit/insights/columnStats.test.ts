import { expect, it, vi } from "vitest";
import { createColumnStatsLoader } from "../../../src/insights/columnStats";
it("is lazy, bounds native aggregation, caches and rejects unknown columns", async () => {
  const query = vi.fn().mockResolvedValue({
    ok: true,
    rows: [{ n: 3n, present: 2n, cardinality: 2n, min: "2", max: "10" }],
  });
  const load = createColumnStatsLoader(
    "layer_1",
    [{ name: "height", type: "DECIMAL", kind: "castText" }],
    '"id" IS NOT NULL',
    query,
  );
  expect(query).not.toHaveBeenCalled();
  expect(await load("height")).toEqual({
    count: 3,
    missing: 1,
    distinct: 2,
    min: "2",
    max: "10",
  });
  await load("height");
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[0]).toContain("LIMIT 10000");
  expect(query.mock.calls[0]?.[0]).toContain("CAST(MIN(value) AS VARCHAR)");
  expect(query.mock.calls[0]?.[0]).toContain('WHERE "id" IS NOT NULL');
  await expect(load("fake")).rejects.toThrow();
});
it("evicts failed queries so a later hover can retry", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, message: "busy" })
    .mockResolvedValue({
      ok: true,
      rows: [{ n: 0, present: 0, cardinality: 0, min: null, max: null }],
    });
  const load = createColumnStatsLoader(
    "t",
    [{ name: "id", kind: "scalar", type: "VARCHAR" }],
    null,
    query,
  );
  await expect(load("id")).rejects.toThrow("busy");
  expect(await load("id")).toEqual({
    count: 0,
    missing: 0,
    distinct: 0,
    min: null,
    max: null,
  });
  expect(query).toHaveBeenCalledTimes(2);
});
