import { beforeEach, describe, expect, it } from "vitest";
import {
  layerQuery,
  useQueryStore,
} from "../../../../src/features/query/queryStore";
import {
  DEFAULT_LAYER_QUERY,
  type FilterGroup,
} from "../../../../src/features/query/types";

const FILTER: FilterGroup = {
  logic: "AND",
  conditions: [{ id: "c1", column: "object_type", op: "=", value: "Building" }],
};

beforeEach(() => {
  useQueryStore.setState({ queries: {} });
});

describe("layerQuery", () => {
  it("defaults a layer nobody has touched", () => {
    expect(layerQuery(useQueryStore.getState(), "L1")).toEqual(
      DEFAULT_LAYER_QUERY,
    );
  });

  it("defaults page size to 100 and applies nothing", () => {
    expect(DEFAULT_LAYER_QUERY.pageSize).toBe(100);
    expect(DEFAULT_LAYER_QUERY.applied).toBeNull();
    expect(DEFAULT_LAYER_QUERY.syncToMap).toBe(false);
  });
});

describe("applyFilter", () => {
  it("copies the draft to applied and resets the page", () => {
    const s = useQueryStore.getState();
    s.setFilter("L1", FILTER);
    s.setPage("L1", 4);
    expect(layerQuery(useQueryStore.getState(), "L1").applied).toBeNull();

    useQueryStore.getState().applyFilter("L1");
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.applied).toEqual(FILTER);
    expect(q.page).toBe(0);
  });

  it("applies null when the draft has no conditions", () => {
    const s = useQueryStore.getState();
    s.setFilter("L1", { logic: "AND", conditions: [] });
    useQueryStore.getState().applyFilter("L1");
    expect(layerQuery(useQueryStore.getState(), "L1").applied).toBeNull();
  });

  it("does not leak into another layer", () => {
    useQueryStore.getState().setFilter("L1", FILTER);
    useQueryStore.getState().applyFilter("L1");
    expect(layerQuery(useQueryStore.getState(), "L2")).toEqual(
      DEFAULT_LAYER_QUERY,
    );
  });
});

describe("clearFilter", () => {
  it("empties both the draft and the applied filter and resets the page", () => {
    const s = useQueryStore.getState();
    s.setFilter("L1", FILTER);
    useQueryStore.getState().applyFilter("L1");
    useQueryStore.getState().setPage("L1", 3);

    useQueryStore.getState().clearFilter("L1");
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.applied).toBeNull();
    expect(q.filter.conditions).toEqual([]);
    expect(q.page).toBe(0);
  });
});

describe("toggleSort", () => {
  it("sorts ascending on the first click", () => {
    useQueryStore.getState().toggleSort("L1", "b3_h_dak_max");
    expect(layerQuery(useQueryStore.getState(), "L1").sort).toEqual({
      column: "b3_h_dak_max",
      dir: "asc",
    });
  });

  it("flips direction on the same column and resets the page", () => {
    useQueryStore.getState().setPage("L1", 5);
    useQueryStore.getState().toggleSort("L1", "id");
    useQueryStore.getState().toggleSort("L1", "id");
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.sort).toEqual({ column: "id", dir: "desc" });
    expect(q.page).toBe(0);
  });

  it("starts ascending again on a different column", () => {
    useQueryStore.getState().toggleSort("L1", "id");
    useQueryStore.getState().toggleSort("L1", "id");
    useQueryStore.getState().toggleSort("L1", "object_type");
    expect(layerQuery(useQueryStore.getState(), "L1").sort).toEqual({
      column: "object_type",
      dir: "asc",
    });
  });
});

describe("paging", () => {
  it("clamps a negative page to zero", () => {
    useQueryStore.getState().setPage("L1", -2);
    expect(layerQuery(useQueryStore.getState(), "L1").page).toBe(0);
  });

  it("resets the page when the page size changes", () => {
    useQueryStore.getState().setPage("L1", 7);
    useQueryStore.getState().setPageSize("L1", 500);
    const q = layerQuery(useQueryStore.getState(), "L1");
    expect(q.pageSize).toBe(500);
    expect(q.page).toBe(0);
  });
});

describe("syncToMap and reset", () => {
  it("records the toggle", () => {
    useQueryStore.getState().setSyncToMap("L1", true);
    expect(layerQuery(useQueryStore.getState(), "L1").syncToMap).toBe(true);
  });

  it("resetQuery drops the layer's entry entirely", () => {
    useQueryStore.getState().setSyncToMap("L1", true);
    useQueryStore.getState().resetQuery("L1");
    expect(useQueryStore.getState().queries.L1).toBeUndefined();
    expect(layerQuery(useQueryStore.getState(), "L1")).toEqual(
      DEFAULT_LAYER_QUERY,
    );
  });
});
