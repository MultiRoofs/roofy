import { describe, it, expect } from "vitest";
import { parseCityGML } from "../../../../../src/domain/citymodel/citygml/parseCityGML";

// ---------------------------------------------------------------------------
// CityGML 2.0 fixture — one Building with RoofSurface + WallSurface at LoD2
// ---------------------------------------------------------------------------

const CITYGML_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel
  xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:xlink="http://www.w3.org/1999/xlink">
  <gml:boundedBy>
    <gml:Envelope srsName="urn:ogc:def:crs:EPSG::28992" srsDimension="3">
      <gml:lowerCorner>0 0 0</gml:lowerCorner>
      <gml:upperCorner>10 10 5</gml:upperCorner>
    </gml:Envelope>
  </gml:boundedBy>
  <core:cityObjectMember>
    <bldg:Building gml:id="building_1">
      <bldg:function>residential</bldg:function>
      <bldg:measuredHeight>5.0</bldg:measuredHeight>
      <bldg:boundedBy>
        <bldg:RoofSurface gml:id="roof_1">
          <bldg:lod2MultiSurface>
            <gml:MultiSurface>
              <gml:surfaceMember>
                <gml:Polygon gml:id="poly_roof_1">
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 5 10 0 5 10 10 5 0 10 5 0 0 5</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </bldg:lod2MultiSurface>
        </bldg:RoofSurface>
      </bldg:boundedBy>
      <bldg:boundedBy>
        <bldg:WallSurface gml:id="wall_1">
          <bldg:lod2MultiSurface>
            <gml:MultiSurface>
              <gml:surfaceMember>
                <gml:Polygon gml:id="poly_wall_1">
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 0 10 0 0 10 0 5 0 0 5 0 0 0</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </bldg:lod2MultiSurface>
        </bldg:WallSurface>
      </bldg:boundedBy>
      <bldg:boundedBy>
        <bldg:GroundSurface gml:id="ground_1">
          <bldg:lod2MultiSurface>
            <gml:MultiSurface>
              <gml:surfaceMember>
                <gml:Polygon gml:id="poly_ground_1">
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 0 10 0 0 10 10 0 0 10 0 0 0 0</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </bldg:lod2MultiSurface>
        </bldg:GroundSurface>
      </bldg:boundedBy>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>`;

// ---------------------------------------------------------------------------
// CityGML 3.0 fixture — one Building with boundary > con:RoofSurface
// ---------------------------------------------------------------------------

const CITYGML_V3 = `<?xml version="1.0" encoding="UTF-8"?>
<CityModel
  xmlns="http://www.opengis.net/citygml/3.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/3.0"
  xmlns:con="http://www.opengis.net/citygml/construction/3.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:xlink="http://www.w3.org/1999/xlink">
  <gml:boundedBy>
    <gml:Envelope srsName="EPSG:25832" srsDimension="3">
      <gml:lowerCorner>0 0 0</gml:lowerCorner>
      <gml:upperCorner>10 10 5</gml:upperCorner>
    </gml:Envelope>
  </gml:boundedBy>
  <cityObjectMember>
    <bldg:Building gml:id="building_v3">
      <boundary>
        <con:RoofSurface gml:id="roof_v3">
          <lod2MultiSurface>
            <gml:MultiSurface>
              <gml:surfaceMember>
                <gml:Polygon gml:id="poly_roof_v3">
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 5 10 0 5 10 10 5 0 10 5 0 0 5</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </lod2MultiSurface>
        </con:RoofSurface>
      </boundary>
      <boundary>
        <con:WallSurface gml:id="wall_v3">
          <lod2MultiSurface>
            <gml:MultiSurface>
              <gml:surfaceMember>
                <gml:Polygon gml:id="poly_wall_v3">
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 0 10 0 0 10 0 5 0 0 5 0 0 0</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </lod2MultiSurface>
        </con:WallSurface>
      </boundary>
    </bldg:Building>
  </cityObjectMember>
</CityModel>`;

// ---------------------------------------------------------------------------
// LoD1 fallback fixture — Building with only lod1Solid, no semantic surfaces
// ---------------------------------------------------------------------------

const CITYGML_LOD1_FALLBACK = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel
  xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:gml="http://www.opengis.net/gml">
  <core:cityObjectMember>
    <bldg:Building gml:id="lod1_building">
      <bldg:lod1Solid>
        <gml:Solid>
          <gml:exterior>
            <gml:CompositeSurface>
              <gml:surfaceMember>
                <gml:Polygon gml:id="s1">
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 0 10 0 0 10 10 0 0 10 0 0 0 0</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon gml:id="s2">
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 5 10 0 5 10 10 5 0 10 5 0 0 5</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:CompositeSurface>
          </gml:exterior>
        </gml:Solid>
      </bldg:lod1Solid>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseCityGML", () => {
  describe("CityGML 2.0", () => {
    it("parses a v2 document into a CityModel", () => {
      const model = parseCityGML(CITYGML_V2);
      expect(model.sourceEncoding).toBe("citygml");
    });

    it("extracts CRS from gml:Envelope", () => {
      const model = parseCityGML(CITYGML_V2);
      expect(model.metadata.referenceSystem).toBe(
        "https://www.opengis.net/def/crs/EPSG/0/28992",
      );
    });

    it("extracts the building object", () => {
      const model = parseCityGML(CITYGML_V2);
      expect(Object.keys(model.objects).length).toBe(1);
      const building = model.objects["building_1"];
      expect(building).toBeDefined();
      expect(building!.objectType).toBe("Building");
    });

    it("extracts semantic surfaces with correct types", () => {
      const model = parseCityGML(CITYGML_V2);
      const building = model.objects["building_1"]!;
      const types = building.surfaces.map((s) => s.type);
      expect(types).toContain("RoofSurface");
      expect(types).toContain("WallSurface");
      expect(types).toContain("GroundSurface");
    });

    it("assigns correct LoD to surfaces", () => {
      const model = parseCityGML(CITYGML_V2);
      const building = model.objects["building_1"]!;
      for (const s of building.surfaces) {
        expect(s.lod).toBe("2");
      }
      expect(building.lod).toBe("2");
    });

    it("computes a bounding box", () => {
      const model = parseCityGML(CITYGML_V2);
      expect(model.bbox).not.toBeNull();
      const building = model.objects["building_1"]!;
      expect(building.bbox).not.toBeNull();
    });

    it("counts vertices", () => {
      const model = parseCityGML(CITYGML_V2);
      expect(model.vertexCount).toBeGreaterThan(0);
    });

    it("extracts building attributes", () => {
      const model = parseCityGML(CITYGML_V2);
      const building = model.objects["building_1"]!;
      expect(building.attributes["function"]).toBe("residential");
      expect(building.attributes["measuredHeight"]).toBe("5.0");
    });
  });

  describe("CityGML 3.0", () => {
    it("parses a v3 document into a CityModel", () => {
      const model = parseCityGML(CITYGML_V3);
      expect(model.sourceEncoding).toBe("citygml");
    });

    it("extracts CRS (bare EPSG format)", () => {
      const model = parseCityGML(CITYGML_V3);
      expect(model.metadata.referenceSystem).toBe(
        "https://www.opengis.net/def/crs/EPSG/0/25832",
      );
    });

    it("extracts the building object", () => {
      const model = parseCityGML(CITYGML_V3);
      expect(Object.keys(model.objects).length).toBe(1);
      const building = model.objects["building_v3"];
      expect(building).toBeDefined();
      expect(building!.objectType).toBe("Building");
    });

    it("extracts semantic surfaces with correct types", () => {
      const model = parseCityGML(CITYGML_V3);
      const building = model.objects["building_v3"]!;
      const types = building.surfaces.map((s) => s.type);
      expect(types).toContain("RoofSurface");
      expect(types).toContain("WallSurface");
    });

    it("assigns LoD 2 to surfaces", () => {
      const model = parseCityGML(CITYGML_V3);
      const building = model.objects["building_v3"]!;
      for (const s of building.surfaces) {
        expect(s.lod).toBe("2");
      }
    });
  });

  describe("LoD1 fallback (no semantic surfaces)", () => {
    it("extracts geometry from lod1Solid", () => {
      const model = parseCityGML(CITYGML_LOD1_FALLBACK);
      const building = model.objects["lod1_building"]!;
      expect(building).toBeDefined();
      expect(building.surfaces.length).toBe(2);
    });

    it("assigns type 'unknown' to fallback surfaces", () => {
      const model = parseCityGML(CITYGML_LOD1_FALLBACK);
      const building = model.objects["lod1_building"]!;
      for (const s of building.surfaces) {
        expect(s.type).toBe("unknown");
      }
    });

    it("assigns LoD 1 to fallback surfaces", () => {
      const model = parseCityGML(CITYGML_LOD1_FALLBACK);
      const building = model.objects["lod1_building"]!;
      for (const s of building.surfaces) {
        expect(s.lod).toBe("1");
      }
      expect(building.lod).toBe("1");
    });
  });

  describe("BuildingPart parent-child", () => {
    const CITYGML_WITH_PART = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel
  xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:gml="http://www.opengis.net/gml">
  <core:cityObjectMember>
    <bldg:Building gml:id="parent_bldg">
      <bldg:boundedBy>
        <bldg:RoofSurface gml:id="parent_roof">
          <bldg:lod2MultiSurface>
            <gml:MultiSurface>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>0 0 5 10 0 5 10 10 5 0 10 5 0 0 5</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </bldg:lod2MultiSurface>
        </bldg:RoofSurface>
      </bldg:boundedBy>
      <bldg:consistsOfBuildingPart>
        <bldg:BuildingPart gml:id="child_part">
          <bldg:boundedBy>
            <bldg:WallSurface gml:id="part_wall">
              <bldg:lod2MultiSurface>
                <gml:MultiSurface>
                  <gml:surfaceMember>
                    <gml:Polygon>
                      <gml:exterior>
                        <gml:LinearRing>
                          <gml:posList>0 0 0 5 0 0 5 0 3 0 0 3 0 0 0</gml:posList>
                        </gml:LinearRing>
                      </gml:exterior>
                    </gml:Polygon>
                  </gml:surfaceMember>
                </gml:MultiSurface>
              </bldg:lod2MultiSurface>
            </bldg:WallSurface>
          </bldg:boundedBy>
        </bldg:BuildingPart>
      </bldg:consistsOfBuildingPart>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>`;

    it("creates separate objects for parent and part", () => {
      const model = parseCityGML(CITYGML_WITH_PART);
      expect(Object.keys(model.objects).length).toBe(2);
      expect(model.objects["parent_bldg"]).toBeDefined();
      expect(model.objects["child_part"]).toBeDefined();
    });

    it("sets children on parent and parents on child", () => {
      const model = parseCityGML(CITYGML_WITH_PART);
      const parent = model.objects["parent_bldg"]!;
      const child = model.objects["child_part"]!;
      expect(parent.children).toContain("child_part");
      expect(child.parents).toContain("parent_bldg");
    });

    it("assigns correct object types", () => {
      const model = parseCityGML(CITYGML_WITH_PART);
      expect(model.objects["parent_bldg"]!.objectType).toBe("Building");
      expect(model.objects["child_part"]!.objectType).toBe("BuildingPart");
    });
  });

  describe("error handling", () => {
    it("throws for non-XML input", () => {
      expect(() => parseCityGML("not xml at all")).toThrow();
    });

    it("throws for XML without CityModel root", () => {
      expect(() =>
        parseCityGML('<?xml version="1.0"?><root><child/></root>'),
      ).toThrow("CityModel");
    });

    it("returns empty objects for CityModel with no members", () => {
      const model = parseCityGML(
        `<?xml version="1.0"?>
         <core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0"
                         xmlns:gml="http://www.opengis.net/gml">
         </core:CityModel>`,
      );
      expect(Object.keys(model.objects).length).toBe(0);
    });
  });
});
