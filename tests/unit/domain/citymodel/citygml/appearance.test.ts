/**
 * CityGML appearance on the official 2.0 "Appearance" example: textures keyed
 * by ring id (one UV per posList vertex, closing duplicate included), a
 * material that targets a whole solid's composite surface, a procedural
 * (`app:TexCoordGen`) target that stays untextured, and dedupe through the
 * shared merger.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCityGML } from "../../../../../src/domain/citymodel/citygml/parseCityGML";
import { collectGmlAppearances } from "../../../../../src/domain/citymodel/citygml/appearance";

const xml = fs.readFileSync(
  path.resolve(
    import.meta.dirname!,
    "../../../../../fixtures/citygml-appearance.gml",
  ),
  "utf-8",
);

describe("parseCityGML appearance", () => {
  const model = parseCityGML(xml);
  const building = Object.values(model.objects).find(
    (o) => o.objectType === "Building",
  )!;

  it("collects both themes, the images and the material", () => {
    const appearance = model.appearance!;
    expect(appearance).toBeDefined();
    expect(appearance.textureThemes).toEqual(["Summer", "Winter"]);
    // Winter reuses Summer's material through an xlink:href member.
    expect(appearance.materialThemes).toEqual(["Summer", "Winter"]);
    expect(appearance.textures.map((t) => t.image)).toContain(
      "front_back_summer.png",
    );
    expect(appearance.textures.every((t) => t.type === "PNG")).toBe(true);
    expect(appearance.materials[0]!.diffuseColor).toEqual([1, 0.6, 0]);
  });

  it("textures the front wall with one UV per posList vertex", () => {
    // The lod2 front wall: a pentagon written with its closing vertex.
    const front = building.surfaces.find(
      (s) => s.lod === "2" && s.rings[0]!.length === 6 && s.texture?.Summer,
    )!;
    expect(front).toBeDefined();
    const tex = front.texture!.Summer!;
    expect(model.appearance!.textures[tex.textureIndex]!.image).toBe(
      "front_back_summer.png",
    );
    expect(tex.uvs).toHaveLength(1);
    expect(tex.uvs[0]).toHaveLength(6);
    expect(tex.uvs[0]![0]).toEqual([0, 0]);
    expect(tex.uvs[0]![3]).toEqual([0.25, 1]);
  });

  it("colours every lod1 face through the material that targets the solid's surface", () => {
    const lod1 = building.surfaces.filter((s) => s.lod === "1");
    expect(lod1.length).toBeGreaterThan(0);
    for (const s of lod1) {
      expect(s.material?.Summer).toBe(0);
      // The href reuse lands the SAME (deduplicated) material under Winter.
      expect(s.material?.Winter).toBe(0);
    }
  });

  it("gives the Winter theme the front wall through a shared TexCoordList", () => {
    const front = building.surfaces.find(
      (s) => s.lod === "2" && s.rings[0]!.length === 6 && s.texture?.Winter,
    )!;
    expect(front).toBeDefined();
    expect(
      model.appearance!.textures[front.texture!.Winter!.textureIndex]!.image,
    ).toBe("front_back_winter.png");
  });

  it("leaves a face whose only coordinates are procedural untextured", () => {
    // `#fRight` uses app:TexCoordGen (worldToTexture), not a coordinate list.
    const textured = building.surfaces.filter((s) => s.texture?.Summer);
    const lod2 = building.surfaces.filter((s) => s.lod === "2");
    expect(textured.length).toBeGreaterThan(0);
    expect(textured.length).toBeLessThan(lod2.length);
  });
});

describe("collectGmlAppearances", () => {
  it("returns null for a document without appearance", () => {
    expect(collectGmlAppearances({ "core:CityModel": {} })).toBeNull();
  });
});
