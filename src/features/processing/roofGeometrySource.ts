/**
 * Where a layer's geometry is, for BOTH kinds of city layer — and how much of
 * it any one question is allowed to touch.
 *
 * A static layer's geometry is parsed into `layer.model.objects[id].surfaces`,
 * each surface carrying its semantic type and the LoD it came from. A STREAMING
 * layer's `model` is a stub with no objects (`openStreamingLayer.ts`); its
 * geometry is the resident set, whose records carry roof metrics the worker
 * already computed (LoD-tagged) plus `geometryLods`, the LoDs of ALL their
 * surfaces.
 *
 * THE CPU CONTRACT, and the reason the halves are separate functions:
 *
 *  - `roofLodOptions` fills a dropdown. It reads TAGS ONLY and never calls
 *    `computeRoofMetrics`. Opening a select must not triangulate a city.
 *  - `RoofGeometrySource.roofSurfacesAt` measures, on demand, memoised per
 *    (object, LoD) — so a run touches only its scoped features' contributors at
 *    the one LoD it was given, once each.
 *  - `RoofGeometrySource.hasGeometryAt` is §7's contributor question, about
 *    surfaces of EVERY semantic type, and is also tags only.
 */
import { computeRoofMetrics } from "@cityjson/navara-core";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import {
  parentsIndexOf,
  rootFeatureId,
} from "../../domain/citymodel/featureId";
import type { Surface } from "../../domain/citymodel/types";
import type { RoofSurfaceMetric } from "../../domain/roofMetrics/roofRollUp";
import type { Layer } from "../layers/layerStore";
import { getResidentModel } from "../streaming/residentModel";

/** Whatever the layer's objects are, reduced to what the feature index needs. */
interface ObjectLike {
  readonly parents?: ReadonlyArray<string>;
}

/**
 * The resident objects, or the model's.
 *
 * The `0` is not a version we are pinning: `getResidentModel`'s second
 * parameter is a SUBSCRIPTION MARKER for React callers and the function itself
 * ignores it (`residentModel.ts`). This reads whatever is resident when it is
 * called, which is what every caller here wants.
 */
function objectsOf(layer: Layer): Readonly<Record<string, ObjectLike>> {
  return layer.isStreaming
    ? getResidentModel(layer.id, 0).objects
    : layer.model.objects;
}

export interface RoofGeometrySource {
  /** Is this object in the layer at all? (Distinct from "has nothing here".) */
  has(objectId: string): boolean;
  /** Spec §7's contributor question: ANY surface, of any type, tagged `lod`. */
  hasGeometryAt(objectId: string, lod: string): boolean;
  /** This object's ROOF surfaces at `lod`, measured on first ask. */
  roofSurfacesAt(
    objectId: string,
    lod: string,
  ): ReadonlyArray<RoofSurfaceMetric>;
}

export function roofGeometrySource(layer: Layer): RoofGeometrySource {
  const cache = new Map<string, ReadonlyArray<RoofSurfaceMetric>>();

  if (layer.isStreaming) {
    const objects: Readonly<Record<string, ResidentObjectRecord>> =
      getResidentModel(layer.id, 0).objects;
    return {
      has: (id) => objects[id] !== undefined,
      hasGeometryAt: (id, lod) =>
        objects[id]?.geometryLods.includes(lod) ?? false,
      roofSurfacesAt: (id, lod) => {
        const key = `${id} ${lod}`;
        const hit = cache.get(key);
        if (hit) return hit;
        // Nothing is MEASURED here: the worker computed these when the cell
        // landed. This is a filter, and the memo only saves the allocation.
        const out = (objects[id]?.roofMetrics ?? [])
          .filter((m) => m.lod === lod)
          .map((m) => ({
            lod: m.lod,
            areaSqM: m.areaSqM,
            inclinationDeg: m.inclinationDeg,
            azimuthDeg: m.azimuthDeg,
          }));
        cache.set(key, out);
        return out;
      },
    };
  }

  const objects = layer.model.objects;
  const surfacesOf = (id: string): ReadonlyArray<Surface> =>
    objects[id]?.surfaces ?? [];
  return {
    has: (id) => objects[id] !== undefined,
    hasGeometryAt: (id, lod) => surfacesOf(id).some((s) => s.lod === lod),
    roofSurfacesAt: (id, lod) => {
      const key = `${id} ${lod}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const out = surfacesOf(id)
        .filter((s) => s.type === "RoofSurface" && s.lod === lod)
        .map((s) => {
          const metrics = computeRoofMetrics(s);
          return {
            lod: s.lod,
            areaSqM: metrics.areaSqM,
            inclinationDeg: metrics.inclinationDeg,
            azimuthDeg: metrics.azimuthDeg,
          };
        });
      cache.set(key, out);
      return out;
    },
  };
}

/** Every object of the layer to the id of the FEATURE it belongs to. */
export function featureIdsByObject(layer: Layer): ReadonlyMap<string, string> {
  const objects = objectsOf(layer);
  const parents = parentsIndexOf(objects);
  const out = new Map<string, string>();
  for (const id of Object.keys(objects))
    out.set(id, rootFeatureId(id, parents));
  return out;
}

/** One row of the LoD select (spec §6). */
export interface LodOption {
  readonly lod: string;
  /** FEATURES with at least one ROOF surface at this LoD, parts folded in. */
  readonly features: number;
}

/** Per object: the LoDs it has ANY geometry at, and the LoDs it has a ROOF at. */
interface LodTags {
  readonly geometry: ReadonlySet<string>;
  readonly roof: ReadonlySet<string>;
}

/** TAGS ONLY: `Surface.type`/`Surface.lod`, or the record's two LoD lists. */
function lodTagsByObject(layer: Layer): ReadonlyMap<string, LodTags> {
  const out = new Map<string, LodTags>();
  if (layer.isStreaming) {
    const objects: Readonly<Record<string, ResidentObjectRecord>> =
      getResidentModel(layer.id, 0).objects;
    for (const [id, record] of Object.entries(objects)) {
      const roof = new Set<string>();
      for (const metric of record.roofMetrics) {
        if (metric.lod !== null) roof.add(metric.lod);
      }
      out.set(id, { geometry: new Set(record.geometryLods), roof });
    }
    return out;
  }
  for (const [id, object] of Object.entries(layer.model.objects)) {
    const geometry = new Set<string>();
    const roof = new Set<string>();
    for (const s of object.surfaces) {
      if (s.lod === null) continue;
      geometry.add(s.lod);
      if (s.type === "RoofSurface") roof.add(s.lod);
    }
    out.set(id, { geometry, roof });
  }
  return out;
}

/**
 * Spec §6: "a select of the LoDs at which the target has geometry of the kind
 * the tool needs, each with the count of FEATURES that have it, parts folded
 * into their building".
 *
 * TAGS ONLY. A static layer's answer is `surface.type` and `surface.lod`; a
 * streaming layer's is `geometryLods` plus the LoD already on each pre-computed
 * roof metric. No geometry is measured, because this fills a dropdown.
 *
 * THE SAME CONTRIBUTOR RULE AS THE RUN (§7). At each LoD, a feature whose PART
 * has geometry there is answered from its parts alone — a root roof displaced
 * by a wall-only part does not make the feature count, exactly as it will not
 * make it measurable. A select that promised "2 buildings with roof surfaces"
 * over a run that then measured one would be the same bug printed twice, in the
 * two places the user compares.
 *
 * Sorted highest detail first, matching `computeAvailableLods` and the
 * streaming ladder so no two LoD lists in the app read in opposite directions.
 * A surface with a null LoD contributes to no option: there is no rung to
 * offer the user for it.
 */
export function roofLodOptions(layer: Layer): ReadonlyArray<LodOption> {
  const tags = lodTagsByObject(layer);
  const featureOf = featureIdsByObject(layer);

  // Every rung anyone mentions, and the members of every feature.
  const rungs = new Set<string>();
  const members = new Map<string, string[]>();
  for (const [id, tag] of tags) {
    for (const lod of tag.geometry) rungs.add(lod);
    const feature = featureOf.get(id) ?? id;
    const list = members.get(feature);
    if (list) list.push(id);
    else members.set(feature, [id]);
  }

  const options: LodOption[] = [];
  for (const lod of rungs) {
    let count = 0;
    for (const [featureId, ids] of members) {
      const parts = ids.filter((id) => id !== featureId);
      const partContributors = parts.filter((id) =>
        tags.get(id)?.geometry.has(lod),
      );
      const contributors =
        partContributors.length > 0
          ? partContributors
          : ids.filter(
              (id) => id === featureId && tags.get(id)?.geometry.has(lod),
            );
      if (contributors.some((id) => tags.get(id)?.roof.has(lod))) count += 1;
    }
    if (count > 0) options.push({ lod, features: count });
  }

  return options.sort(
    (a, b) => Number.parseFloat(b.lod) - Number.parseFloat(a.lod),
  );
}
