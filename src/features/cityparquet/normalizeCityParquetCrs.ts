import proj4 from "proj4";
import { mergeBBox, parseEpsgCode } from "@cityjson/navara-core";
import type {
  BBox3,
  CityModel,
  CityObject,
  Vec3,
} from "../../domain/citymodel/types";

/**
 * PLATEAU CityParquet uses EPSG:6697: JGD2011 geographic coordinates and
 * gravity-related heights in metres. Its WKB uses x=longitude, y=latitude
 * (not the EPSG authority's axis order). The viewer and its analysis require
 * metric horizontal coordinates, so normalize into the centroid's UTM zone.
 *
 * Only this known compound CRS is handled: guessing the vertical units/datum
 * of other geographic sources would make their heights untrustworthy. Keep z
 * unchanged; the renderer applies its existing EGM2008 geoid approximation.
 * JGD2011 to WGS84 uses the metre-level null horizontal datum approximation.
 * Source bytes/URLs remain untouched for reloads; the returned model's CRS
 * describes its converted geometry. No global definition is overwritten.
 */
export function normalizeCityParquetCrs(model: CityModel): CityModel {
  if (parseEpsgCode(model.metadata.referenceSystem) !== 6697 || !model.bbox) {
    return model;
  }
  const lon = (model.bbox[0] + model.bbox[3]) / 2;
  const lat = (model.bbox[1] + model.bbox[4]) / 2;
  validate([lon, lat, 0]);
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
  const epsg = (lat >= 0 ? 32600 : 32700) + zone;
  // WGS84 UTM definitions are built into proj4; no remote CRS fetch required.
  const projection = proj4(
    "+proj=longlat +ellps=GRS80 +no_defs",
    `EPSG:${epsg}`,
  );
  const project = (point: Vec3): Vec3 => {
    validate(point);
    const [x, y] = projection.forward([point[0], point[1]]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(
        "Cannot project this CityParquet geometry into a metric coordinate system.",
      );
    }
    return [x!, y!, point[2]];
  };
  const extend = (bbox: BBox3 | null, point: Vec3): BBox3 =>
    mergeBBox(bbox, [...point, ...point] as BBox3)!;
  const projectBounds = (bbox: BBox3 | null): BBox3 | null => {
    if (!bbox) return null;
    let result: BBox3 | null = null;
    for (const x of [bbox[0], bbox[3]]) {
      for (const y of [bbox[1], bbox[4]]) {
        result = extend(result, project([x, y, bbox[2]]));
        result = extend(result, project([x, y, bbox[5]]));
      }
    }
    return result;
  };

  const objects: Record<string, CityObject> = Object.create(null);
  let bbox: BBox3 | null = null;
  for (const [id, object] of Object.entries(model.objects)) {
    // Retain bounds for geometryless parents and include every transformed
    // vertex, since a projected bounding rectangle is not axis-aligned.
    let objectBounds = projectBounds(object.bbox);
    const surfaces = object.surfaces.map((surface) => ({
      ...surface,
      rings: surface.rings.map((ring) =>
        ring.map((point) => {
          const converted = project(point);
          objectBounds = extend(objectBounds, converted);
          return converted;
        }),
      ),
    }));
    objects[id] = { ...object, surfaces, bbox: objectBounds };
    bbox = mergeBBox(bbox, objectBounds);
  }
  return {
    ...model,
    metadata: {
      ...model.metadata,
      referenceSystem: `https://www.opengis.net/def/crs/EPSG/0/${epsg}`,
    },
    objects,
    bbox: bbox ?? projectBounds(model.bbox),
  };
}

function validate([lon, lat, height]: Vec3): void {
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(height) ||
    lon < -180 ||
    lon > 180 ||
    lat < -80 ||
    lat > 84
  ) {
    throw new Error(
      "Cannot project EPSG:6697 CityParquet coordinates: expected longitude/latitude within the UTM latitude range and a finite height in metres.",
    );
  }
}
