import type { Vec3 } from "../../domain/citymodel/types";
import { drawnModel } from "./geometry";
/** Picked depth uses ellipsoid height. City-model placement adds geoid undulation. */
export async function prepareDrawing(
  points: readonly Vec3[],
  height: number,
  sampleGeoid: (lng: number, lat: number) => Promise<number>,
) {
  const draft = drawnModel(points, height);
  const box = draft.bbox!;
  const lng = (((box[0] + box[3]) / 2 / 6378137) * 180) / Math.PI;
  const lat =
    ((2 * Math.atan(Math.exp((box[1] + box[4]) / 2 / 6378137)) - Math.PI / 2) *
      180) /
    Math.PI;
  const offset = await sampleGeoid(lng, lat);
  return drawnModel(
    points.map((p) => [p[0], p[1], p[2] - offset] as Vec3),
    height,
  );
}
