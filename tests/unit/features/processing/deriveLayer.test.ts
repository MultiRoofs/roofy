/**
 * §6's derived-layer NAMES: the seven prefills, and the uniqueness rule the
 * form checks at Run and the publication re-checks (§6, "The name is
 * re-checked at publication").
 *
 * Pure — no store, no engine. `nameTaken`/`disambiguate` are typed against
 * `Layer` and `GeoLayer` because that is what their two callers hold, but they
 * read exactly ONE field, so the fixtures below are name-only stand-ins rather
 * than two full literals per case. A test that built real records here would be
 * asserting `addLayer`'s defaults, which is another suite's job.
 */
import { describe, expect, it } from "vitest";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import {
  derivedLayerName,
  disambiguate,
  nameTaken,
} from "../../../../src/features/processing/deriveLayer";

const city = (name: string): Layer => ({ name }) as unknown as Layer;
const geo = (name: string): GeoLayer => ({ name }) as unknown as GeoLayer;

describe("derivedLayerName", () => {
  it("is spec §6's prefill for each of the seven tools", () => {
    expect(derivedLayerName("Delft", "roof-metrics", null)).toBe(
      "Delft · roof metrics",
    );
    expect(derivedLayerName("Delft", "measure-solids", null)).toBe(
      "Delft · solids",
    );
    expect(derivedLayerName("Delft", "validate-solids", null)).toBe(
      "Delft · validation",
    );
    expect(derivedLayerName("Delft", "height-from-extent", null)).toBe(
      "Delft · extent",
    );
    expect(derivedLayerName("Delft", "join-by-location", "Zones")).toBe(
      "Delft + Zones",
    );
    expect(derivedLayerName("Zones", "aggregate-per-area", "Delft")).toBe(
      "Zones · buildings",
    );
    expect(derivedLayerName("Delft", "distance-to-nearest", "Roads")).toBe(
      "Delft · nearest Roads",
    );
  });

  it("drops the source segment when no source is chosen yet", () => {
    // The form prefills on every render, including before the SOURCE select
    // has an answer. Run is already refused then (Task 11's source reason), so
    // the name only has to be printable and stable — not runnable.
    expect(derivedLayerName("Delft", "join-by-location", null)).toBe("Delft");
    expect(derivedLayerName("Delft", "distance-to-nearest", null)).toBe(
      "Delft · nearest",
    );
  });
});

describe("nameTaken", () => {
  it("compares trimmed and case-insensitively, across BOTH stores", () => {
    const layers = [city("Delft")];
    const geoLayers = [geo("Zones")];
    expect(nameTaken("Delft", layers, geoLayers)).toBe(true);
    expect(nameTaken("  delft ", layers, geoLayers)).toBe(true);
    expect(nameTaken("ZONES", layers, geoLayers)).toBe(true);
    expect(nameTaken("Delft · solids", layers, geoLayers)).toBe(false);
  });

  it("does not call an EMPTY name taken — that is the other error", () => {
    // Two messages, two causes: an empty name is A13, a duplicate is A14, and
    // a blank string matching a blank layer name would report the wrong one.
    expect(nameTaken("", [city("Delft")], [])).toBe(false);
    expect(nameTaken("   ", [city("Delft")], [])).toBe(false);
  });
});

describe("disambiguate", () => {
  it("leaves a free name alone and says it did not rename", () => {
    expect(disambiguate("Delft · solids", [city("Delft")], [])).toEqual({
      name: "Delft · solids",
      renamed: false,
    });
  });

  it("appends ' (2)' and reports the rename (§6, §10.12)", () => {
    expect(
      disambiguate("Delft · solids", [city("Delft · solids")], []),
    ).toEqual({ name: "Delft · solids (2)", renamed: true });
  });

  it("walks past a taken ' (2)' rather than colliding again", () => {
    expect(
      disambiguate(
        "Delft · solids",
        [city("Delft · solids"), city("Delft · solids (2)")],
        [],
      ),
    ).toEqual({ name: "Delft · solids (3)", renamed: true });
  });

  it("counts a GEO layer's name as taken, and trims before appending", () => {
    expect(
      disambiguate("  Zones · buildings  ", [], [geo("Zones · buildings")]),
    ).toEqual({ name: "Zones · buildings (2)", renamed: true });
  });
});
