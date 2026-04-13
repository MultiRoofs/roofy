import { EffectMaterial } from "postprocessing";
import { type Camera } from "three";

type ComposerLike = {
  readonly passes: ReadonlyArray<{
    readonly fullscreenMaterial?: unknown;
  }>;
};

/**
 * Postprocessing materials cache camera near/far settings internally.
 * Keep them synced when the scene camera is mutated outside the composer.
 */
export function syncEffectComposerCameraSettings(
  composer: ComposerLike | null | undefined,
  camera: Camera,
): void {
  if (!composer) return;

  for (const pass of composer.passes) {
    if (pass.fullscreenMaterial instanceof EffectMaterial) {
      pass.fullscreenMaterial.adoptCameraSettings(camera);
    }
  }
}
