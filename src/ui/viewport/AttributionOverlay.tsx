/**
 * Data attributions. These are LICENCE OBLIGATIONS, not credits.
 *
 * Three of them, and only one is unconditional:
 *
 *  - the geoid service (Re:Earth Terrain, EGM2008) is CC BY 4.0 Mapterhorn +
 *    ODbL OpenStreetMap, and is sampled for EVERY georeferenced layer (Global
 *    Constraints -> Vertical datum), so its lines are unconditional;
 *  - Google's photorealistic tiles are only fetched when an API key is
 *    configured (`googleTiles.ts`), so that credit follows the layer;
 *  - the raster basemap (`basemaps.ts`) is user-selectable, so its credit
 *    follows whichever option is actually draped on the globe — ODbL for OSM,
 *    the service credit for Esri, CARTO's own plus OSM's for Positron.
 *
 * Replaces `TilesAttributionOverlay` from 3d-tiles-renderer, which is deleted
 * with the R3F stack in Task C21.
 *
 * The geoid lines are RENDERED FROM `GEOID_ATTRIBUTION` rather than retyped
 * here, so the text the user sees is by construction the text the library says
 * the licence requires — a prose copy would silently drift the day the service
 * (or its upstream credit line) changes. `linkify` only decorates that text:
 * the licence names stay in the string, and each one additionally becomes a
 * link, because "CC BY 4.0" and "ODbL" are obligations to point AT a licence,
 * not just to name one.
 */
import type { ReactElement, ReactNode } from "react";
import { GEOID_ATTRIBUTION } from "@cityjson/navara-core";

/** Phrases that must reach the licence they name. Longest-first is not needed:
 *  none of these is a substring of another. */
const LICENCE_LINKS: readonly (readonly [phrase: string, href: string])[] = [
  ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
  ["ODbL", "https://opendatacommons.org/licenses/odbl/1-0/"],
];

/** Splits one attribution line into text runs and anchors, preserving the line
 *  exactly — `element.textContent` still equals the original string. */
function linkify(line: string): readonly ReactNode[] {
  const parts: ReactNode[] = [];
  let rest = line;
  let key = 0;
  while (rest.length > 0) {
    let hit: { index: number; phrase: string; href: string } | null = null;
    for (const [phrase, href] of LICENCE_LINKS) {
      const index = rest.indexOf(phrase);
      if (index === -1) continue;
      if (hit === null || index < hit.index) hit = { index, phrase, href };
    }
    if (hit === null) {
      parts.push(rest);
      break;
    }
    if (hit.index > 0) parts.push(rest.slice(0, hit.index));
    parts.push(
      <a key={key++} href={hit.href} target="_blank" rel="noreferrer noopener">
        {hit.phrase}
      </a>,
    );
    rest = rest.slice(hit.index + hit.phrase.length);
  }
  return parts;
}

export interface AttributionOverlayProps {
  /** Whether the Google Photorealistic 3D Tiles layer is actually in the
   *  scene. False with no API key configured — and then Google must NOT be
   *  credited for imagery nobody is looking at. */
  readonly googleTiles: boolean;
  /**
   * The active basemap's credit lines (`BasemapOption.attribution`), or empty
   * when no raster basemap is in the scene.
   *
   * Passed in rather than read from the store here, for the same reason
   * `googleTiles` is: the obligation follows what the ENGINE actually has, not
   * what the user asked for. A basemap the engine refused must not be credited.
   */
  readonly basemapAttribution?: readonly string[];
  /**
   * The terrain service's credit (`TERRAIN_ATTRIBUTION`), or empty when the
   * engine has no terrain layer.
   *
   * Deliberately separate from the geoid lines even though both come from
   * Re:Earth Terrain: the geoid is sampled unconditionally, the relief is a
   * layer that can fail to load, and only what is actually on screen may be
   * credited.
   */
  readonly terrainAttribution?: readonly string[];
}

export function AttributionOverlay({
  googleTiles,
  basemapAttribution = [],
  terrainAttribution = [],
}: AttributionOverlayProps): ReactElement {
  // DEDUPED, in source order. The geoid line already credits OpenStreetMap
  // (the undulation tiles are OSM-derived), so an OSM or CARTO basemap would
  // otherwise print "© OpenStreetMap contributors" twice — which reads as a
  // bug, not as a stronger credit. A Set preserves insertion order, so the
  // first occurrence of each obligation wins its position.
  const lines = [
    ...(googleTiles ? ["Imagery © Google"] : []),
    ...basemapAttribution,
    ...terrainAttribution,
    ...GEOID_ATTRIBUTION,
  ];
  return (
    <div className="attribution-overlay">
      {[...new Set(lines)].map((line) => (
        <span key={line}>{linkify(line)}</span>
      ))}
    </div>
  );
}
