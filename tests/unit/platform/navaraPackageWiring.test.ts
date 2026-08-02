import { describe, it, expect, vi } from "vitest";
import { NAVARA_CORE_VERSION } from "@cityjson/navara-core";
import { CITYJSON_PLUGIN_PLACEHOLDER } from "@cityjson/navara-cityjson";
import { FLATCITYBUF_PLUGIN_PLACEHOLDER } from "@cityjson/navara-flatcitybuf";
import { CITYPARQUET_PLUGIN_PLACEHOLDER } from "@cityjson/navara-cityparquet";

// `@cityjson/navara-cityjson`'s barrel re-exports its three engine-binding
// modules (CityJSONPlugin, CityModelMeshDesc, CityMeshArraysDesc), so importing
// it evaluates `@navaramap/three` — which crashes at module scope under Node
// (`os.cpus is not a function`; Task B1's NODE_IMPORT_SAFE = false). Stubbing
// the four engine symbols those modules use keeps this tripwire meaningful: the
// alias still resolves and every plugin source file is still evaluated, only the
// engine itself is replaced. Browser code (and the browser smokes) load the real
// engine; nothing else in the app's jsdom suite may import it.
vi.mock("@navaramap/three", () => ({
  MeshDesc: class {},
  Plugin: class {},
  PickableMeshWrapper: class {},
  getPickRay: () => null,
}));

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
