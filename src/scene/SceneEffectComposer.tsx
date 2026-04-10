import { forwardRef, useCallback, useLayoutEffect, useRef } from "react";
import {
  EffectComposer as WrappedEffectComposer,
  type EffectComposerProps,
} from "@react-three/postprocessing";
import {
  EffectMaterial,
  NormalPass,
  type EffectComposer as EffectComposerImpl,
} from "postprocessing";
import { HalfFloatType, type Camera, type WebGLRenderTarget } from "three";

type ComposerLike = {
  readonly passes: ReadonlyArray<{
    readonly fullscreenMaterial?: unknown;
  }>;
};

type NormalPassWithRenderTarget = NormalPass & {
  readonly renderTarget: WebGLRenderTarget;
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

/**
 * Wraps the R3F EffectComposer so its normal buffer uses half-float precision.
 * Takram notes that the default normal target can cause visible banding.
 */
export const SceneEffectComposer = forwardRef<
  EffectComposerImpl,
  EffectComposerProps
>(function SceneEffectComposer(
  { enableNormalPass = true, ...props },
  forwardedRef,
) {
  const composerRef = useRef<EffectComposerImpl | null>(null);

  const setComposerRef = useCallback(
    (composer: EffectComposerImpl | null) => {
      composerRef.current = composer;

      if (typeof forwardedRef === "function") {
        forwardedRef(composer);
      } else if (forwardedRef) {
        forwardedRef.current = composer;
      }
    },
    [forwardedRef],
  );

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const normalPass = composer.passes.find(
      (pass): pass is NormalPassWithRenderTarget => pass instanceof NormalPass,
    );
    if (!normalPass) return;

    normalPass.renderTarget.texture.type = HalfFloatType;
  }, []);

  return (
    <WrappedEffectComposer
      ref={setComposerRef}
      {...props}
      enableNormalPass={enableNormalPass}
    />
  );
});
