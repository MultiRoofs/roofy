import { describe, it, expect } from "vitest";
import { NAVARA_CORE_VERSION } from "@cityjson/navara-core";
import {
  CITY_MODEL_MESH_KEY,
  CITYJSON_PLUGIN_PLACEHOLDER,
} from "@cityjson/navara-cityjson";
import { FLATCITYBUF_PLUGIN_PLACEHOLDER } from "@cityjson/navara-flatcitybuf";
import { assembleCityParquetModel } from "@cityjson/navara-cityparquet";
// Type-only on purpose: it pins the "@cityjson/navara-cityjson/plugin" tsconfig
// path (Task B8's import) without evaluating the engine at test time — a
// type-only import is erased before this file ever runs.
import type { CityJSONPlugin } from "@cityjson/navara-cityjson/plugin";

// The submodule packages are aliased to their `src/` entry points (see
// vite.config.ts). This test is the tripwire for that wiring: if the alias,
// the tsconfig paths, or the submodule checkout regress, every later Navara
// import in the app breaks, and this is the cheapest place to notice.
describe("@cityjson/navara-* package wiring", () => {
  it("resolves navara-core to the submodule source", () => {
    expect(NAVARA_CORE_VERSION).toBe("0.0.0");
  });

  it("keeps @cityjson/navara-cityjson's main barrel engine-free, so it loads under Node", () => {
    // If anything reachable from the barrel starts importing @navaramap/*, this
    // file fails to even load ("os.cpus is not a function" — Task B1's
    // NODE_IMPORT_SAFE = false). The engine-bound half is published separately
    // as "@cityjson/navara-cityjson/plugin", which only browser code imports.
    expect(CITY_MODEL_MESH_KEY).toBe("cityModel");
    // Keeps the type-only subpath import above load-bearing.
    const plugin: CityJSONPlugin | null = null;
    expect(plugin).toBeNull();
  });

  it("resolves the three plugin packages to the submodule source", () => {
    expect(CITYJSON_PLUGIN_PLACEHOLDER).toContain("@cityjson/navara-cityjson");
    expect(FLATCITYBUF_PLUGIN_PLACEHOLDER).toContain(
      "@cityjson/navara-flatcitybuf",
    );
    // navara-cityparquet has a real barrel now, so its wiring is pinned by the
    // reader the app actually calls rather than by a placeholder string.
    expect(typeof assembleCityParquetModel).toBe("function");
  });
});
