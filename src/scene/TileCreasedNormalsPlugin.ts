import { Mesh, type BufferGeometry, type Object3D } from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

export interface TileCreasedNormalsPluginOptions {
  readonly creaseAngle?: number;
}

/**
 * Applies creased normals to loaded tile meshes so building edges read more
 * clearly under the atmospheric lighting pipeline.
 */
export class TileCreasedNormalsPlugin {
  readonly options: TileCreasedNormalsPluginOptions;

  constructor(options: TileCreasedNormalsPluginOptions = {}) {
    this.options = options;
  }

  async processTileModel(scene: Object3D): Promise<void> {
    const creaseAngle = this.options.creaseAngle;

    scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const geometry = child.geometry;
      if (!geometry) return;

      child.geometry = toCreasedNormals(
        geometry as BufferGeometry,
        creaseAngle,
      );
    });
  }
}
