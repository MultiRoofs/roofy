// A CityJSON file of trees placed from geometry templates, for measuring how
// implicit geometry is drawn.
//
//   node scripts/performance/make-template-forest.mjs <count> <out.city.json>
//
// Two templates (a broadleaf with a round crown, a conifer with a cone), each
// a trunk and a crown of single-ring surfaces, in local metres. `count`
// SolitaryVegetationObjects stand on a 12 m grid centred on Delft (EPSG:7415),
// each a GeometryInstance with a rotation about Z and a uniform scale from a
// seeded generator, so the same count always writes the same bytes.

import fs from "node:fs";

const count = Number(process.argv[2]);
const out = process.argv[3];
if (!Number.isInteger(count) || count <= 0 || !out) {
  console.error("usage: make-template-forest.mjs <count> <out.city.json>");
  process.exit(2);
}

/** mulberry32: a small seeded generator. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const templateVertices = [];
const vertex = (x, y, z) =>
  templateVertices.push([
    Math.round(x * 1000) / 1000,
    Math.round(y * 1000) / 1000,
    Math.round(z * 1000) / 1000,
  ]) - 1;

/** Rings of `segments` vertices at each [radius, height], joined by quads and
 *  closed with a fan at a pole of radius 0. */
function revolve(profile, segments) {
  const surfaces = [];
  const rings = profile.map(([radius, height]) =>
    radius === 0
      ? [vertex(0, 0, height)]
      : Array.from({ length: segments }, (_, i) => {
          const a = (2 * Math.PI * i) / segments;
          return vertex(radius * Math.cos(a), radius * Math.sin(a), height);
        }),
  );
  for (let r = 0; r + 1 < rings.length; r++) {
    const lower = rings[r];
    const upper = rings[r + 1];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      if (lower.length === 1) {
        surfaces.push([[lower[0], upper[j], upper[i]]]);
      } else if (upper.length === 1) {
        surfaces.push([[lower[i], lower[j], upper[0]]]);
      } else {
        surfaces.push([[lower[i], lower[j], upper[j], upper[i]]]);
      }
    }
  }
  return surfaces;
}

const trunk = () =>
  revolve(
    [
      [0, 0],
      [0.25, 0],
      [0.2, 3],
    ],
    8,
  );
const broadleaf = [
  ...trunk(),
  ...revolve(
    Array.from({ length: 9 }, (_, i) => {
      const t = (Math.PI * i) / 8;
      const radius = i === 0 || i === 8 ? 0 : 2.5 * Math.sin(t);
      return [radius, 5.5 - 2.5 * Math.cos(t)];
    }),
    12,
  ),
];
const conifer = [
  ...trunk(),
  ...revolve(
    [
      [0, 2],
      [2, 2],
      [1.2, 5],
      [1.5, 5],
      [0.7, 8],
      [0.9, 8],
      [0, 11],
    ],
    12,
  ),
];
const templates = [broadleaf, conifer].map((boundaries) => ({
  type: "MultiSurface",
  lod: "2",
  boundaries,
}));

const SPACING = 12;
const side = Math.ceil(Math.sqrt(count));
const centre = [84_500, 447_500, 0];
const scale = [0.001, 0.001, 0.001];
const translate = [
  centre[0] - (side * SPACING) / 2,
  centre[1] - (side * SPACING) / 2,
  0,
];
const next = random(20261123);
const vertices = [];
const objects = {};
for (let i = 0; i < count; i++) {
  const x = (i % side) * SPACING + (next() - 0.5) * 6;
  const y = Math.floor(i / side) * SPACING + (next() - 0.5) * 6;
  vertices.push([Math.round(x * 1000), Math.round(y * 1000), 0]);
  const angle = next() * 2 * Math.PI;
  const size = 0.7 + next() * 0.7;
  const c = Math.round(Math.cos(angle) * size * 1e6) / 1e6;
  const s = Math.round(Math.sin(angle) * size * 1e6) / 1e6;
  const template = next() < 0.6 ? 0 : 1;
  objects[`tree-${i}`] = {
    type: "SolitaryVegetationObject",
    attributes: {
      species: template === 0 ? "Tilia" : "Picea",
      height: Math.round((template === 0 ? 8 : 11) * size * 100) / 100,
    },
    geometry: [
      {
        type: "GeometryInstance",
        template,
        boundaries: [i],
        transformationMatrix: [
          c,
          -s,
          0,
          0,
          s,
          c,
          0,
          0,
          0,
          0,
          Math.round(size * 1e6) / 1e6,
          0,
          0,
          0,
          0,
          1,
        ],
      },
    ],
  };
}

fs.writeFileSync(
  out,
  JSON.stringify({
    type: "CityJSON",
    version: "2.0",
    transform: { scale, translate },
    metadata: {
      referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415",
    },
    CityObjects: objects,
    vertices,
    "geometry-templates": {
      templates,
      "vertices-templates": templateVertices,
    },
  }),
);
console.log(
  `${out}: ${count} trees, templates of ${templates.map((t) => t.boundaries.length).join(" and ")} surfaces, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`,
);
