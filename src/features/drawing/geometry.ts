import type { CityModel, Surface, Vec3 } from "../../domain/citymodel/types";
/** WGS84 footprint -> local metric geometry in Web Mercator, with vertical metres. */
export function drawnModel(points: readonly Vec3[], height: number): CityModel {
  if (
    points.some(
      (p) =>
        p.some((v) => !Number.isFinite(v)) ||
        Math.abs(p[1]) > 85 ||
        Math.abs(p[0]) > 180,
    )
  )
    throw new Error("Draw within the supported map extent.");
  if (points.length > 64)
    throw new Error("A footprint can have up to 64 corners.");
  if (points.length < 3) throw new Error("Add at least three corners.");
  if (!Number.isFinite(height) || height < 0 || height > 1000)
    throw new Error("Height must be between 0 and 1,000 metres.");
  const ring = points.map(
    ([lng, lat]) =>
      [
        (6378137 * lng * Math.PI) / 180,
        6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
        points[0]![2],
      ] as Vec3,
  );
  const cross = (a: Vec3, b: Vec3, c: Vec3) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!,
        c = ring[j]!,
        d = ring[(j + 1) % ring.length]!;
      if (
        Math.max(a[0], b[0]) >= Math.min(c[0], d[0]) &&
        Math.max(c[0], d[0]) >= Math.min(a[0], b[0]) &&
        Math.max(a[1], b[1]) >= Math.min(c[1], d[1]) &&
        Math.max(c[1], d[1]) >= Math.min(a[1], b[1]) &&
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0
      )
        throw new Error("Edges must not cross or touch.");
    }
  const area = ring.reduce(
    (sum, p, i) =>
      sum +
      p[0] * ring[(i + 1) % ring.length]![1] -
      ring[(i + 1) % ring.length]![0] * p[1],
    0,
  );
  if (Math.abs(area) < 0.02)
    throw new Error("Draw a footprint with a non-zero area.");
  if (area < 0) ring.reverse();
  const top = ring.map((p) => [p[0], p[1], p[2] + height] as Vec3);
  const surface = (r: readonly Vec3[], type: Surface["type"]): Surface => ({
    rings: [r],
    type,
    lod: "1",
    attributes: {},
  });
  const surfaces: Surface[] =
    height === 0
      ? [surface(ring, "GroundSurface")]
      : [
          surface([...ring].reverse(), "GroundSurface"),
          surface(top, "RoofSurface"),
          ...ring.map((p, i) =>
            surface(
              [
                p,
                ring[(i + 1) % ring.length]!,
                top[(i + 1) % ring.length]!,
                top[i]!,
              ],
              "WallSurface",
            ),
          ),
        ];
  const bbox = [
    Math.min(...ring.map((p) => p[0])),
    Math.min(...ring.map((p) => p[1])),
    ring[0]![2],
    Math.max(...ring.map((p) => p[0])),
    Math.max(...ring.map((p) => p[1])),
    ring[0]![2] + height,
  ] as const;
  return {
    sourceEncoding: "cityjson",
    metadata: {
      referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/3857",
      title: "Drawn model",
    },
    bbox,
    vertexCount: ring.length * (height ? 2 : 1),
    objects: {
      drawn: {
        id: "drawn",
        objectType: height ? "Building" : "LandUse",
        attributes: { createdBy: "Roofy", height },
        surfaces,
        bbox,
        children: [],
        parents: [],
        lod: "1",
      },
    },
  };
}
export function modelDataUrl(model: CityModel): string {
  const vertices: Vec3[] = [];
  const CityObjects = Object.fromEntries(
    Object.entries(model.objects).map(([id, obj]) => [
      id,
      {
        type: obj.objectType,
        attributes: obj.attributes,
        geometry: [
          {
            type: "MultiSurface",
            lod: "1",
            semantics: {
              surfaces: obj.surfaces.map((s) => ({ type: s.type })),
              values: obj.surfaces.map((_, i) => i),
            },
            boundaries: obj.surfaces.map((surface) =>
              surface.rings.map((ring) =>
                ring.map((point) => {
                  vertices.push(point);
                  return vertices.length - 1;
                }),
              ),
            ),
          },
        ],
      },
    ]),
  );
  return (
    "data:application/json," +
    encodeURIComponent(
      JSON.stringify({
        type: "CityJSON",
        version: "2.0",
        metadata: model.metadata,
        CityObjects,
        vertices,
      }),
    )
  );
}
