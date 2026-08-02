import { describe, it, expect } from "vitest";
import { NAVARA_CORE_VERSION } from "@cityjson/navara-core";
import { CITYJSON_PLUGIN_PLACEHOLDER } from "@cityjson/navara-cityjson";
import { FLATCITYBUF_PLUGIN_PLACEHOLDER } from "@cityjson/navara-flatcitybuf";
import { CITYPARQUET_PLUGIN_PLACEHOLDER } from "@cityjson/navara-cityparquet";

// The submodule packages are aliased to their `src/` entry points (see
// vite.config.ts). This test is the tripwire for that wiring: if the alias,
// the tsconfig paths, or the submodule checkout regress, every later Navara
// import in the app breaks, and this is the cheapest place to notice.
describe("@cityjson/navara-* package wiring", () => {
  it("resolves navara-core to the submodule source", () => {
    expect(NAVARA_CORE_VERSION).toBe("0.0.0");
  });

  it("resolves the three plugin packages to the submodule source", () => {
    expect(CITYJSON_PLUGIN_PLACEHOLDER).toContain("@cityjson/navara-cityjson");
    expect(FLATCITYBUF_PLUGIN_PLACEHOLDER).toContain(
      "@cityjson/navara-flatcitybuf",
    );
    expect(CITYPARQUET_PLUGIN_PLACEHOLDER).toContain(
      "@cityjson/navara-cityparquet",
    );
  });
});
