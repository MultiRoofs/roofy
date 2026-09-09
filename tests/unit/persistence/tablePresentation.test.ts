import { expect, it } from "vitest";
import { normalizeTablePresentation } from "../../../src/features/query/tablePresentation";
import { useQueryStore } from "../../../src/features/query/queryStore";
it("restores table preferences without restoring an object selection or page", () => {
  const saved = {
    columns: ["status", "id", "status"],
    sort: { column: "id", dir: "desc" },
    view: "raw",
    pageSize: 50,
    drawerTab: "summary",
  };
  useQueryStore.getState().restorePresentation("test", saved);
  expect(useQueryStore.getState().queries.test).toMatchObject({
    columns: ["status", "id"],
    sort: saved.sort,
    view: "raw",
    pageSize: 50,
    drawerTab: "summary",
    page: 0,
    rawObjectId: null,
  });
  useQueryStore.getState().resetQuery("test");
});
it("validates saved values and supports older workspaces", () => {
  expect(normalizeTablePresentation(undefined)).toBeUndefined();
  expect(
    normalizeTablePresentation({
      columns: 1,
      view: "oops",
      sort: { column: "id", dir: "DROP" },
      pageSize: -1,
    }),
  ).toMatchObject({
    columns: null,
    sort: null,
    view: "buildings",
    pageSize: 20,
    drawerTab: "records",
  });
});

it("includes table preferences in shared links", async () => {
  const { encodeShareState, readShareHash } =
    await import("../../../src/persistence/urlShare");
  const tablePresentation = {
    columns: ["status", "id"],
    sort: { column: "id", dir: "desc" as const },
    view: "raw" as const,
    pageSize: 50 as const,
    drawerTab: "summary" as const,
  };
  const decoded = readShareHash(
    encodeShareState({
      v: 3,
      cam: { lng: 4, lat: 52, height: 100, heading: 0, pitch: -45, roll: 0 },
      dt: "2026-09-09T12:00:00Z",
      pm: "object",
      layers: [
        {
          name: "city",
          modelUrl: "https://example.com/model.json",
          visible: true,
          rules: [],
          rulesEnabled: false,
          tablePresentation,
        },
      ],
    }),
  );
  expect(decoded.kind).toBe("ok");
  if (decoded.kind === "ok")
    expect(decoded.state.layers[0]!.tablePresentation).toEqual(
      tablePresentation,
    );
});
