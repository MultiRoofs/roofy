/**
 * `colorBy`, `singleColor` and `unmatchedColor` across the two round trips a
 * workspace can take: the saved snapshot (v4) and the share hash (v3).
 *
 * Two rules shape every case below.
 *
 * 1. SYNTHETIC RULES ARE NEVER SERIALISED. The catch-alls that carry the
 *    single colour and the unmatched colour are derived from the mode, so
 *    writing them down would save the same fact twice and hand a future build
 *    a rule the editor must then learn to hide.
 * 2. NEITHER SCHEMA VERSION MOVES. All three fields are optional and derived
 *    when absent, so a document written before "Color by" existed restores as
 *    the rendering it was saved from — `rulesEnabled && rules.length > 0`
 *    meant "the rules are painting", which is exactly `colorBy: "rules"`.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeLayers,
  type RawLayersDocument,
} from "../../../src/persistence/types";
import { captureColorBy } from "../../../src/persistence/captureSnapshot";
import {
  encodeShareState,
  readShareHash,
  type ShareableViewState,
} from "../../../src/persistence/urlShare";
import {
  effectiveRules,
  isSyntheticRule,
} from "../../../src/features/rules/colorBy";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../src/scene/cityColors";
import type { Rule } from "../../../src/features/rules/types";

const RULE: Rule = {
  id: "r1",
  name: "Flat roofs",
  color: "#3b82f6",
  logic: "AND",
  conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
  enabled: true,
};

const CAMERA = {
  lng: 4.36,
  lat: 52.01,
  height: 800,
  heading: 0,
  pitch: -45,
  roll: 0,
};

function doc(layer: Record<string, unknown>): RawLayersDocument {
  return { version: 4, layers: [{ name: "L", modelRef: {}, ...layer }] };
}

describe("normalizeLayers — the snapshot restore path", () => {
  it("derives the mode of an OLD v4 layer from rules + rulesEnabled", () => {
    // The three shapes a pre-12.3 snapshot can have. `rulesEnabled` is read
    // ONLY here, when no mode was written.
    expect(
      normalizeLayers(doc({ rules: [RULE], rulesEnabled: true }))[0]!.colorBy,
    ).toBe("rules");
    expect(
      normalizeLayers(doc({ rules: [RULE], rulesEnabled: false }))[0]!.colorBy,
    ).toBe("surface");
    expect(
      normalizeLayers(doc({ rules: [], rulesEnabled: true }))[0]!.colorBy,
    ).toBe("surface");
  });

  it("gives an old layer the default colours, so nothing is undefined downstream", () => {
    const l = normalizeLayers(doc({ rules: [RULE], rulesEnabled: true }))[0]!;
    expect(l.singleColor).toBe(SINGLE_COLOR_HEX);
    expect(l.unmatchedColor).toBe(UNMATCHED_COLOR_HEX);
  });

  it("reads a written mode instead of deriving one", () => {
    const l = normalizeLayers(
      doc({
        rules: [RULE],
        // A v4+ document states the mode; the stale `rulesEnabled` beside it
        // must NOT win.
        rulesEnabled: true,
        colorBy: "single",
        singleColor: "#0a0b0c",
        unmatchedColor: "#010203",
      }),
    )[0]!;
    expect(l).toMatchObject({
      colorBy: "single",
      singleColor: "#0a0b0c",
      unmatchedColor: "#010203",
    });
  });

  it("validates each field on its own, so one bad value costs only itself", () => {
    const l = normalizeLayers(
      doc({
        rules: [RULE],
        rulesEnabled: true,
        colorBy: "gradient",
        singleColor: "#abc",
        unmatchedColor: "#00FF00",
      }),
    )[0]!;
    // An unknown mode reads as an absent one — hence the derived "rules".
    expect(l.colorBy).toBe("rules");
    expect(l.singleColor).toBe(SINGLE_COLOR_HEX);
    expect(l.unmatchedColor).toBe("#00FF00");
  });

  it("leaves the fields it already defaulted alone", () => {
    const l = normalizeLayers(doc({ rules: [], lodMode: "manual" }))[0]!;
    expect(l.lodMode).toBe("manual");
    expect(l.hiddenTypes).toEqual([]);
    expect(l.colorBy).toBe("surface");
  });
});

describe("captureColorBy — the snapshot capture path", () => {
  it("writes the mode and BOTH colours, pinning them against a future default", () => {
    expect(
      captureColorBy({
        colorBy: "single",
        singleColor: "#0a0b0c",
        unmatchedColor: "#010203",
      }),
    ).toEqual({
      rulesEnabled: false,
      colorBy: "single",
      singleColor: "#0a0b0c",
      unmatchedColor: "#010203",
    });
  });

  it("derives `rulesEnabled` from the mode — the toggle is gone", () => {
    const of = (colorBy: "surface" | "rules" | "single") =>
      captureColorBy({
        colorBy,
        singleColor: SINGLE_COLOR_HEX,
        unmatchedColor: UNMATCHED_COLOR_HEX,
      }).rulesEnabled;
    expect(of("rules")).toBe(true);
    expect(of("surface")).toBe(false);
    expect(of("single")).toBe(false);
  });

  it("round-trips every mode back through normalizeLayers", () => {
    for (const colorBy of ["surface", "rules", "single"] as const) {
      const written = {
        name: "L",
        modelRef: {},
        rules: [RULE],
        ...captureColorBy({
          colorBy,
          singleColor: "#0a0b0c",
          unmatchedColor: "#010203",
        }),
      };
      const back = normalizeLayers({ version: 4, layers: [written] })[0]!;
      expect(back).toMatchObject({
        colorBy,
        singleColor: "#0a0b0c",
        unmatchedColor: "#010203",
      });
    }
  });
});

describe("the share hash", () => {
  function share(layer: Record<string, unknown>): ShareableViewState {
    return {
      v: 3,
      layers: [
        {
          name: "L",
          modelUrl: "https://x/a.city.json",
          rules: [RULE],
          visible: true,
          ...layer,
        },
      ] as unknown as ShareableViewState["layers"],
      cam: CAMERA,
      dt: "2026-09-07T12:00:00.000Z",
      pm: "object",
    };
  }

  it("carries the user's rules plus the three fields, and NO synthetic rule", () => {
    const state = share({
      ...captureColorBy({
        colorBy: "rules",
        singleColor: "#0a0b0c",
        unmatchedColor: "#010203",
      }),
    });
    const result = readShareHash("#" + encodeShareState(state));
    expect(result.kind).toBe("ok");
    const layer = result.kind === "ok" ? result.state.layers[0]! : null;
    expect(layer).toMatchObject({
      colorBy: "rules",
      singleColor: "#0a0b0c",
      unmatchedColor: "#010203",
    });
    expect(layer!.rules).toEqual([RULE]);
    expect(layer!.rules.some(isSyntheticRule)).toBe(false);
    // The list the renderer will build from it is a different thing entirely,
    // and it is built on the other side, not sent.
    expect(
      effectiveRules({
        rules: layer!.rules,
        rulesEnabled: layer!.rulesEnabled,
        colorBy: layer!.colorBy!,
        singleColor: layer!.singleColor!,
        unmatchedColor: layer!.unmatchedColor!,
      }).some(isSyntheticRule),
    ).toBe(true);
  });

  it("restores the same mode for each of the three", () => {
    for (const colorBy of ["surface", "rules", "single"] as const) {
      const result = readShareHash(
        "#" +
          encodeShareState(
            share({
              ...captureColorBy({
                colorBy,
                singleColor: "#0a0b0c",
                unmatchedColor: "#010203",
              }),
            }),
          ),
      );
      expect(result.kind === "ok" && result.state.layers[0]!.colorBy).toBe(
        colorBy,
      );
    }
  });

  it("derives the mode of a link minted before Color by existed", () => {
    // Older builds wrote `rulesEnabled` and nothing else, and every link they
    // ever minted still has to open.
    const legacy = { ...share({ rulesEnabled: true }) };
    const result = readShareHash("#" + encodeShareState(legacy));
    expect(result.kind === "ok" && result.state.layers[0]!).toMatchObject({
      colorBy: "rules",
      singleColor: SINGLE_COLOR_HEX,
      unmatchedColor: UNMATCHED_COLOR_HEX,
    });
  });

  it("stays schema v3 — nothing about a hash's older meaning changed", () => {
    const result = readShareHash(
      "#" + encodeShareState(share({ colorBy: "single" })),
    );
    expect(result.kind === "ok" && result.state.v).toBe(3);
  });

  it("validates a hand-edited hash the way the snapshot path does", () => {
    const result = readShareHash(
      "#" +
        encodeShareState(
          share({
            colorBy: "rainbow",
            singleColor: "nope",
            rulesEnabled: true,
          }),
        ),
    );
    expect(result.kind === "ok" && result.state.layers[0]!).toMatchObject({
      colorBy: "rules",
      singleColor: SINGLE_COLOR_HEX,
    });
  });
});
