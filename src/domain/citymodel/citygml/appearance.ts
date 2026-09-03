/**
 * CityGML Appearance module (`app:` namespace, 1.0/2.0/3.0 alike) →
 * the domain's appearance vocabulary.
 *
 * CityGML keys everything by `gml:id`: an `app:ParameterizedTexture` names
 * the polygons it covers (`app:target uri="#polygonId"`) and lists one
 * `app:textureCoordinates ring="#ringId"` per linear ring, with one (u, v)
 * pair per `posList` vertex — the closing duplicate included, which is also
 * what `parseLinearRing` keeps, so the two stay paired. An `app:X3DMaterial`
 * names its targets as plain `app:target` strings; a target may be a
 * polygon or a whole surface/geometry container, so material lookups take a
 * list of candidate ids (polygon first, then its containers).
 *
 * Every appearance of one file is collected ONCE into an index (a walk of the
 * parsed tree for `app:Appearance` nodes, wherever they sit — under the
 * CityModel's `app:appearanceMember` or a feature's `app:appearance`), and
 * the tables go through core's `AppearanceMerger` so texture images
 * deduplicate and indices come out model-wide. Tolerant like the CityJSON
 * reader: a malformed entry means "untextured", never a parse error.
 */
import {
  AppearanceMerger,
  type AppearanceContext,
  type CityAppearance,
  type SurfaceTexture,
  type UV,
} from "@cityjson/navara-core";
import type { XMLNode } from "./types";
import { stripPrefix } from "./xmlHelpers";

/** One texture's coordinates for one ring, in the theme it belongs to. */
interface RingTexture {
  readonly theme: string;
  readonly localTextureIndex: number;
  readonly uvs: ReadonlyArray<UV>;
}

export interface GmlAppearanceIndex {
  /** ring gml:id -> the textures (per theme) whose coordinates name it. */
  readonly byRing: ReadonlyMap<string, ReadonlyArray<RingTexture>>;
  /** target gml:id (polygon or container) -> theme -> local material index. */
  readonly materialsByTarget: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly ctx: AppearanceContext;
  readonly merger: AppearanceMerger;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const t = (value as { "#text"?: unknown })["#text"];
    return typeof t === "string" ? t : null;
  }
  return null;
}

function attrOf(value: unknown, name: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const v = (value as Record<string, unknown>)[`@_${name}`];
  return typeof v === "string" ? v : null;
}

/** `#id` -> `id`; an external reference (another document) is dropped. */
function localRef(uri: string | null): string | null {
  if (uri === null) return null;
  return uri.startsWith("#") ? uri.slice(1) : null;
}

/** A child element by local name, ignoring the namespace prefix. */
function child(node: XMLNode, localName: string): unknown {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    if (stripPrefix(key) === localName) return value;
  }
  return undefined;
}

function parseUvList(text: string): UV[] | null {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length % 2 !== 0) return null;
  const out: UV[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const u = Number(tokens[i]);
    const v = Number(tokens[i + 1]);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    out.push([u, v]);
  }
  return out;
}

function parseColor(text: string | null): [number, number, number] | null {
  if (text === null) return null;
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) {
    return null;
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

interface Collected {
  readonly textures: Array<Record<string, unknown>>;
  readonly materials: Array<Record<string, unknown>>;
  readonly byRing: Map<string, RingTexture[]>;
  readonly materialsByTarget: Map<string, Map<string, number>>;
}

/** Surface data (`ParameterizedTexture` / `X3DMaterial`) by `gml:id`, so a
 *  theme can reuse another theme's definition through `xlink:href`. */
type SurfaceDataById = ReadonlyMap<
  string,
  { kind: "texture" | "material" | "texCoordList"; node: XMLNode }
>;

function collectAppearance(
  node: XMLNode,
  byId: SurfaceDataById,
  out: Collected,
): void {
  const theme = textOf(child(node, "theme")) ?? "default";
  for (const member of toArray(child(node, "surfaceDataMember"))) {
    if (typeof member !== "object" || member === null) continue;
    const m = member as XMLNode;
    const texture = child(m, "ParameterizedTexture");
    if (typeof texture === "object" && texture !== null) {
      collectParameterizedTexture(texture as XMLNode, theme, out, byId);
    }
    const material = child(m, "X3DMaterial");
    if (typeof material === "object" && material !== null) {
      collectMaterial(material as XMLNode, theme, out);
    }
    // `<app:surfaceDataMember xlink:href="#id"/>`: the same surface data,
    // under THIS theme (the image deduplicates in the merger).
    const ref = localRef(attrOf(m, "xlink:href"));
    const shared = ref === null ? undefined : byId.get(ref);
    if (shared?.kind === "texture") {
      collectParameterizedTexture(shared.node, theme, out, byId);
    } else if (shared?.kind === "material") {
      collectMaterial(shared.node, theme, out);
    }
  }
}

function collectParameterizedTexture(
  node: XMLNode,
  theme: string,
  out: Collected,
  byId: SurfaceDataById,
): void {
  const image = textOf(child(node, "imageURI"));
  if (!image) return;
  const mime = textOf(child(node, "mimeType")) ?? "";
  const wrapMode = textOf(child(node, "wrapMode"));
  const localTextureIndex = out.textures.length;
  out.textures.push({
    image,
    type: /png/i.test(mime) || /\.png$/i.test(image) ? "PNG" : "JPG",
    ...(wrapMode ? { wrapMode } : {}),
  });
  for (const target of toArray(child(node, "target"))) {
    if (typeof target !== "object" || target === null) continue;
    // Coordinates inline, or shared with another texture through
    // `<app:target uri="#poly" xlink:href="#texCoordListId"/>`.
    let list = child(target as XMLNode, "TexCoordList");
    if (typeof list !== "object" || list === null) {
      const ref = localRef(attrOf(target, "xlink:href"));
      const shared = ref === null ? undefined : byId.get(ref);
      list = shared?.kind === "texCoordList" ? shared.node : undefined;
    }
    if (typeof list !== "object" || list === null) continue;
    for (const coords of toArray(
      child(list as XMLNode, "textureCoordinates"),
    )) {
      const ring = localRef(attrOf(coords, "ring"));
      const text = textOf(coords);
      if (ring === null || text === null) continue;
      const uvs = parseUvList(text);
      if (!uvs) continue;
      let entries = out.byRing.get(ring);
      if (!entries) {
        entries = [];
        out.byRing.set(ring, entries);
      }
      entries.push({ theme, localTextureIndex, uvs });
    }
  }
}

function collectMaterial(node: XMLNode, theme: string, out: Collected): void {
  const diffuse = parseColor(textOf(child(node, "diffuseColor")));
  const id = attrOf(node, "gml:id");
  const localMaterialIndex = out.materials.length;
  out.materials.push({
    name: id ?? `material-${localMaterialIndex}`,
    ...(diffuse ? { diffuseColor: diffuse } : {}),
  });
  for (const target of toArray(child(node, "target"))) {
    const ref = localRef(textOf(target));
    if (ref === null) continue;
    let themes = out.materialsByTarget.get(ref);
    if (!themes) {
      themes = new Map();
      out.materialsByTarget.set(ref, themes);
    }
    themes.set(theme, localMaterialIndex);
  }
}

/** Walk the parsed tree for every `Appearance` element, wherever it sits,
 *  and for every surface-data element that carries a `gml:id`. */
function walk(
  value: unknown,
  appearances: XMLNode[],
  byId: Map<
    string,
    { kind: "texture" | "material" | "texCoordList"; node: XMLNode }
  >,
  depth: number,
): void {
  if (depth > 64 || typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, appearances, byId, depth + 1);
    return;
  }
  for (const [key, v] of Object.entries(value as XMLNode)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const local = stripPrefix(key);
    if (local === "ParameterizedTexture" || local === "X3DMaterial") {
      for (const n of toArray(v)) {
        const id = attrOf(n, "gml:id");
        if (id && typeof n === "object" && n !== null) {
          byId.set(id, {
            kind: local === "X3DMaterial" ? "material" : "texture",
            node: n as XMLNode,
          });
        }
        // A texture's coordinate lists may be shared by id too.
        walk(n, appearances, byId, depth + 1);
      }
      continue;
    }
    if (local === "TexCoordList") {
      for (const n of toArray(v)) {
        const id = attrOf(n, "gml:id");
        if (id && typeof n === "object" && n !== null) {
          byId.set(id, { kind: "texCoordList", node: n as XMLNode });
        }
      }
      continue;
    }
    if (local === "Appearance") {
      for (const app of toArray(v)) {
        if (typeof app === "object" && app !== null) {
          appearances.push(app as XMLNode);
          // Its surface data and coordinate lists are what hrefs point at.
          walk(app, appearances, byId, depth + 1);
        }
      }
      continue;
    }
    walk(v, appearances, byId, depth + 1);
  }
}

/**
 * Index every appearance in a parsed CityGML document. Returns `null` when
 * the file carries none, so the geometry walk pays nothing.
 */
export function collectGmlAppearances(
  root: XMLNode,
): GmlAppearanceIndex | null {
  const out: Collected = {
    textures: [],
    materials: [],
    byRing: new Map(),
    materialsByTarget: new Map(),
  };
  const appearances: XMLNode[] = [];
  const byId = new Map<
    string,
    { kind: "texture" | "material" | "texCoordList"; node: XMLNode }
  >();
  walk(root, appearances, byId, 0);
  for (const app of appearances) collectAppearance(app, byId, out);
  if (out.textures.length === 0 && out.materials.length === 0) return null;
  const merger = new AppearanceMerger();
  const ctx = merger.register({
    textures: out.textures,
    materials: out.materials,
  });
  return {
    byRing: out.byRing,
    materialsByTarget: out.materialsByTarget,
    ctx,
    merger,
  };
}

export interface GmlSurfaceAppearance {
  readonly texture?: Readonly<Record<string, SurfaceTexture>>;
  readonly material?: Readonly<Record<string, number>>;
}

/**
 * The appearance of one polygon: textures from its rings' coordinates (a
 * theme counts only when EVERY ring has coordinates of the ring's length,
 * so the triangulation never invents a UV), materials from the first of
 * `targetIds` (the polygon, then its containers) that a material names.
 */
export function gmlSurfaceAppearance(
  index: GmlAppearanceIndex,
  ringIds: ReadonlyArray<string | undefined>,
  ringLengths: ReadonlyArray<number>,
  targetIds: ReadonlyArray<string | undefined>,
): GmlSurfaceAppearance | null {
  let texture: Record<string, SurfaceTexture> | undefined;
  let material: Record<string, number> | undefined;

  const exteriorId = ringIds[0];
  if (exteriorId !== undefined) {
    for (const entry of index.byRing.get(exteriorId) ?? []) {
      if (texture?.[entry.theme]) continue;
      const modelIndex = index.ctx.textureRemap[entry.localTextureIndex];
      if (modelIndex === undefined || modelIndex < 0) continue;
      const uvs: UV[][] = [];
      let ok = true;
      for (let r = 0; r < ringIds.length; r++) {
        const id = ringIds[r];
        const found =
          id === undefined
            ? undefined
            : (index.byRing.get(id) ?? []).find(
                (e) =>
                  e.theme === entry.theme &&
                  e.localTextureIndex === entry.localTextureIndex,
              );
        if (!found || found.uvs.length !== ringLengths[r]) {
          ok = false;
          break;
        }
        uvs.push([...found.uvs]);
      }
      if (!ok) continue;
      (texture ??= {})[entry.theme] = { textureIndex: modelIndex, uvs };
      index.ctx.textureThemes.add(entry.theme);
    }
  }

  for (const id of targetIds) {
    if (id === undefined) continue;
    const themes = index.materialsByTarget.get(id);
    if (!themes) continue;
    for (const [theme, local] of themes) {
      if (material?.[theme] !== undefined) continue;
      const modelIndex = index.ctx.materialRemap[local];
      if (modelIndex === undefined || modelIndex < 0) continue;
      (material ??= {})[theme] = modelIndex;
      index.ctx.materialThemes.add(theme);
    }
  }

  if (!texture && !material) return null;
  return { ...(texture ? { texture } : {}), ...(material ? { material } : {}) };
}

/** The model-wide tables, once every surface has been attached. */
export function buildGmlAppearance(
  index: GmlAppearanceIndex | null,
): CityAppearance | undefined {
  return index?.merger.build();
}
