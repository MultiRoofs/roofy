/**
 * Task B1 SPIKE — Navara MRT vertex colours + custom-mesh picking.
 *
 * This file is a throwaway measurement rig, not production code. It is deleted
 * in Task C21; the verdicts it produces live in
 * `docs/superpowers/research/2026-08-01-navara-spike-findings.md`.
 *
 * It answers, with real-browser evidence:
 *   - MRT_VERTEX_COLORS_OK  — does `MeshStandardMaterial({vertexColors:true})`
 *                             survive Navara's MRT G-buffer?
 *   - PICK_PATH             — `PickableMeshWrapper` vs our own raycast.
 *   - PROD_BUNDLE_OK        — does the same page work after `vite build`?
 *   - CAMERA_BURST_SHAPE / PROGRAMMATIC_MOVE_EMITS — measured camera cadence.
 *   - THREE instance identity (one copy or two under resolve.dedupe).
 */
import ThreeView, {
  degreeToRadian,
  eastNorthUpToFixedFrame,
  geodeticToVector3,
  getPickRay,
  MeshDesc,
  PickableMeshWrapper,
  type ViewContext,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  REVISION,
  Vector2,
  Vector3,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from "three";

const SITE = { lng: 4.3571, lat: 52.0116, height: 0 };
/** Second patch, ~300 m north of SITE, used for the per-vertex batchId probe. */
const SITE_B = { lng: 4.3571, lat: 52.0116 + 0.0027, height: 0 };

type Globals = Record<string, unknown>;
const G = globalThis as unknown as Globals;

/** Two 40 m triangles: left one pure red, right one pure green — per vertex. */
function spikeGeometry(): BufferGeometry {
  const positions = new Float32Array([
    -40, -40, 0, 0, -40, 0, -40, 40, 0, 0, -40, 0, 40, 40, 0, 0, 40, 0,
  ]);
  const normals = new Float32Array(18);
  for (let i = 2; i < 18; i += 3) normals[i] = 1;
  const colors = new Float32Array([
    1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]);
  const objectIndex = new Uint32Array([0, 0, 0, 1, 1, 1]);
  const surfaceIndex = new Uint32Array([0, 0, 0, 7, 7, 7]);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("normal", new BufferAttribute(normals, 3));
  g.setAttribute("color", new BufferAttribute(colors, 3));
  g.setAttribute("objectIndex", new BufferAttribute(objectIndex, 1));
  g.setAttribute("surfaceIndex", new BufferAttribute(surfaceIndex, 1));
  g.computeBoundingSphere();
  return g;
}

function enuFrame(site: { lng: number; lat: number; height: number }): Matrix4 {
  const origin = geodeticToVector3({
    lng: degreeToRadian(site.lng),
    lat: degreeToRadian(site.lat),
    height: site.height,
  });
  return eastNorthUpToFixedFrame(origin);
}

// ---------------------------------------------------------------------------
// PICK PATH A — Navara's sanctioned route: PickableMeshWrapper + ctx.register.
// ---------------------------------------------------------------------------

class SpikeMeshDesc extends MeshDesc {
  createMesh(): Mesh {
    const mesh = new Mesh(
      spikeGeometry(),
      new MeshStandardMaterial({ vertexColors: true, flatShading: true }),
    );
    mesh.frustumCulled = false;

    // The mapping table CityModelMesh.resolvePick would own in production.
    G.__spikeBatchMap = [
      { objectIndex: 0, surfaceIndex: 0 },
      { objectIndex: 1, surfaceIndex: 7 },
    ];
    // The brief's assumption under test: a per-triangle `batchId` attribute
    // that PickableMeshWrapper would carry into the pick pass.
    mesh.geometry.setAttribute(
      "batchId",
      new BufferAttribute(new Uint32Array([0, 0, 0, 1, 1, 1]), 1),
    );

    let wrapper: PickableMeshWrapper | undefined;
    try {
      wrapper = new PickableMeshWrapper(mesh, this.ctx);
      this.ctx.registerPickableMesh(this.id, wrapper);
      G.__spikePickable = wrapper;
      G.__spikeWrapperBatchId = wrapper.batchId;
    } catch (e) {
      G.__spikePickableError = String(e);
    }

    G.__spikeMesh = mesh;
    return mesh;
  }
}

// ---------------------------------------------------------------------------
// PICK PATH A2 (bonus probe) — our own PickableMesh with a PER-VERTEX batchId.
// Not one of the brief's two verdict values; measured because it is the only
// way a GPU pick could carry per-surface identity, and the answer changes the
// migration plan if it works.
// ---------------------------------------------------------------------------

const BATCH_ID_TO_COLOR_GLSL = `
vec3 nvr_batchIdToColor(float batchId) {
    float r = floor(batchId / 65536.0);
    float g = floor(mod(batchId / 256.0, 256.0));
    float b = floor(mod(batchId, 256.0));
    return vec3(r/255.0, g/255.0, b/255.0);
}`;

class VertexBatchPickable extends Object3D {
  readonly uPickable = { value: 0 };
  constructor(readonly target: Mesh) {
    super();
    const material = target.material as MeshStandardMaterial;
    const prev = material.onBeforeCompile.bind(material);
    const refs = this.uPickable;
    material.onBeforeCompile = (
      shader: WebGLProgramParametersWithUniforms,
      renderer,
    ) => {
      prev(shader, renderer);
      (shader.uniforms as Record<string, { value: number }>).nvr_uPickable =
        refs;
      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        `attribute float batchId;
varying float nvr_vBatchId;
void main() {
  nvr_vBatchId = batchId;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        `uniform float nvr_uPickable;
varying float nvr_vBatchId;
${BATCH_ID_TO_COLOR_GLSL}
void main() {`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
if (nvr_uPickable > 0.0) {
  gl_FragColor = vec4(nvr_batchIdToColor(nvr_vBatchId), 1.0);
}`,
      );
    };
    material.customProgramCacheKey = () => "_spike_vertex_pickable";
    material.needsUpdate = true;
  }
  onBeforePicking(): void {
    this.uPickable.value = 1;
  }
  onAfterPicking(): void {
    this.uPickable.value = 0;
  }
  getRenderable(): Object3D {
    return this.target;
  }
}

class SpikeVertexPickDesc extends MeshDesc {
  createMesh(): Mesh {
    const mesh = new Mesh(
      spikeGeometry(),
      new MeshStandardMaterial({ vertexColors: true, flatShading: true }),
    );
    mesh.frustumCulled = false;
    try {
      const ctx: ViewContext = this.ctx;
      const idA = ctx.genGlobalBatchId() ?? 0;
      const idB = ctx.genGlobalBatchId() ?? 0;
      G.__spikeVertexBatchMap = {
        [idA]: { objectIndex: 0, surfaceIndex: 0 },
        [idB]: { objectIndex: 1, surfaceIndex: 7 },
      };
      mesh.geometry.setAttribute(
        "batchId",
        new BufferAttribute(
          new Float32Array([idA, idA, idA, idB, idB, idB]),
          1,
        ),
      );
      const pickable = new VertexBatchPickable(mesh);
      ctx.registerPickableMesh(`${this.id}-vertex`, pickable);
      G.__spikeVertexPickable = pickable;
    } catch (e) {
      G.__spikeVertexPickError = String(e);
    }
    G.__spikeMeshB = mesh;
    return mesh;
  }
}

// ---------------------------------------------------------------------------

type PickInfo = {
  batchId: number;
  layerId: unknown;
  properties: unknown;
} | null;

async function main(): Promise<void> {
  const container = document.getElementById("app");
  if (!container) throw new Error("no #app");

  // --- three instance identity -------------------------------------------
  const threeBefore = (window as unknown as Globals).__THREE__;
  G.__spikeThree = {
    spikeRevision: REVISION,
    windowThreeAtSpikeImport: threeBefore,
  };

  const plugin = new DefaultPlugin();
  const view = new ThreeView({
    container,
    shadow: true,
    picking: true,
  });
  view.addPlugin(plugin);
  await view.init();
  // FINDING: `registerMesh` must run AFTER `init()` — the descriptor registries
  // are constructed inside `init()`. Calling it before throws
  // "Cannot read properties of undefined (reading 'mesh')".
  view.registerMesh(
    "spike",
    SpikeMeshDesc as unknown as Parameters<typeof view.registerMesh>[1],
  );
  view.registerMesh(
    "spikeVertexPick",
    SpikeVertexPickDesc as unknown as Parameters<typeof view.registerMesh>[1],
  );
  plugin.addDefaultPhotorealScene();
  view.atmosphere.date = new Date("2026-07-16T10:00:00Z");

  type AddMeshArg = Parameters<typeof view.addMesh>[0];
  view.addMesh({
    spike: { enabled: true },
    matrixWorld: enuFrame(SITE),
  } as unknown as AddMeshArg);
  view.addMesh({
    spikeVertexPick: { enabled: true },
    matrixWorld: enuFrame(SITE_B),
  } as unknown as AddMeshArg);

  view.setCamera({
    lng: SITE.lng,
    lat: SITE.lat - 0.0015,
    height: 400,
    heading: 0,
    pitch: -60,
    roll: 0,
  });
  view.animation = true;

  G.__spikeView = view;

  // --- three instance identity, after the engine loaded -------------------
  G.__spikeThreeCheck = () => ({
    spikeRevision: REVISION,
    windowThree: (window as unknown as Globals).__THREE__,
    cameraIsPerspectiveCamera: view.camera.raw instanceof PerspectiveCamera,
    cameraIsObject3D: view.camera.raw instanceof Object3D,
    meshIsObject3D: G.__spikeMesh instanceof Object3D,
    meshParentIsObject3D: (G.__spikeMesh as Mesh | undefined)?.parent
      ? (G.__spikeMesh as Mesh).parent instanceof Object3D
      : null,
    materialCtorName: (
      (G.__spikeMesh as Mesh | undefined)?.material as Material
    )?.constructor?.name,
  });

  // --- PICK PATH B: getPickRay + three Raycaster --------------------------
  const raycastAt = (px: number, py: number, mesh: Mesh | undefined) => {
    if (!mesh) return null;
    const size = view.screenSize;
    const ray = getPickRay(
      {
        width: size.x,
        height: size.y,
        pixelRatio: view.pixelRatio,
      } as unknown as Parameters<typeof getPickRay>[0],
      view.camera.raw,
      new Vector2(px, py),
    );
    const rc = new Raycaster(
      ray.origin.clone(),
      ray.direction.clone().normalize(),
    );
    rc.far = Number.POSITIVE_INFINITY;
    const hit = rc.intersectObject(mesh, false)[0];
    if (!hit?.face) return null;
    const oi = mesh.geometry.getAttribute("objectIndex").getX(hit.face.a);
    const si = mesh.geometry.getAttribute("surfaceIndex").getX(hit.face.a);
    return { objectIndex: oi, surfaceIndex: si, distance: hit.distance };
  };

  G.__spikeRaycast = (x: number, y: number) => {
    const dpr = view.pixelRatio;
    return {
      cssPx: raycastAt(x, y, G.__spikeMesh as Mesh | undefined),
      devicePx: raycastAt(x * dpr, y * dpr, G.__spikeMesh as Mesh | undefined),
      dpr,
    };
  };
  G.__spikeRaycastDebug = (x: number, y: number) => {
    const mesh = G.__spikeMesh as Mesh | undefined;
    if (!mesh) return { error: "no mesh" };
    const size = view.screenSize;
    const ray = getPickRay(
      {
        width: size.x,
        height: size.y,
        pixelRatio: view.pixelRatio,
      } as unknown as Parameters<typeof getPickRay>[0],
      view.camera.raw,
      new Vector2(x, y),
    );
    const rc = new Raycaster(
      ray.origin.clone(),
      ray.direction.clone().normalize(),
      0,
      Number.POSITIVE_INFINITY,
    );
    const all = rc.intersectObject(mesh, false);
    const sphere = mesh.geometry.boundingSphere;
    return {
      hits: all.length,
      first: all[0]
        ? { distance: all[0].distance, faceA: all[0].face?.a ?? null }
        : null,
      rayOriginIsVector3: ray.origin instanceof Vector3,
      raycasterRayOriginIsVector3: rc.ray.origin instanceof Vector3,
      meshVisible: mesh.visible,
      meshParent: mesh.parent?.type ?? null,
      matrixWorldAutoUpdate: mesh.matrixWorldAutoUpdate,
      matrixWorld: mesh.matrixWorld.elements.slice(12, 15),
      matrix: mesh.matrix.elements.slice(12, 15),
      boundingSphere: sphere
        ? { c: sphere.center.toArray(), r: sphere.radius }
        : null,
      side: (mesh.material as MeshStandardMaterial).side,
      geomAttrs: Object.keys(mesh.geometry.attributes),
      indexCount: mesh.geometry.index?.count ?? null,
      posCount: mesh.geometry.getAttribute("position").count,
      drawRange: mesh.geometry.drawRange,
    };
  };
  G.__spikeRayDebug = (x: number, y: number) => {
    const size = view.screenSize;
    const ray = getPickRay(
      {
        width: size.x,
        height: size.y,
        pixelRatio: view.pixelRatio,
      } as unknown as Parameters<typeof getPickRay>[0],
      view.camera.raw,
      new Vector2(x, y),
    );
    const cam = view.camera.raw;
    const mesh = G.__spikeMesh as Mesh | undefined;
    const meshOrigin = new Vector3().setFromMatrixPosition(
      mesh?.matrixWorld ?? new Matrix4(),
    );
    return {
      screenSize: { x: size.x, y: size.y },
      pixelRatio: view.pixelRatio,
      rayOrigin: ray.origin.toArray(),
      rayDirection: ray.direction.toArray(),
      cameraRawPosition: cam.position.toArray(),
      cameraECEF: view.camera.positionECEF,
      meshWorldOrigin: meshOrigin.toArray(),
      distCamToMesh: meshOrigin.distanceTo(cam.position),
    };
  };

  // --- pick events --------------------------------------------------------
  const picks: PickInfo[] = [];
  G.__spikePicks = picks;
  view.on("pick", (f) => {
    picks.push(f as PickInfo);
    console.log("SPIKE pick event:", JSON.stringify(f));
  });

  // --- camera event trace -------------------------------------------------
  const trace: Array<{ t: number; e: string }> = [];
  G.__spikeTrace = trace;
  G.__spikeTraceReset = () => {
    trace.length = 0;
  };
  const push = (e: string) => () => {
    trace.push({ t: Math.round(performance.now()), e });
  };
  // Camera events live on `view.camera` (ThreeViewCamera extends
  // EventHandler<CameraEvent>) — NOT on the view, contrary to the brief.
  view.camera.on("movestart", push("movestart"));
  view.camera.on("move", push("move"));
  view.camera.on("moveend", push("moveend"));
  view.camera.on("frustumChanged", push("frustumChanged"));
  view.on("idle", push("idle"));
  view.on("resize", push("resize"));

  console.log("SPIKE ready");
  G.__spikeReady = true;
}

void main().catch((e: unknown) => {
  G.__spikeError = String(e);
  console.error("SPIKE failed:", e);
});
