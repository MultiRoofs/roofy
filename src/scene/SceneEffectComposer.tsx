import { forwardRef, useCallback, useRef } from "react";
import {
  EffectComposer as WrappedEffectComposer,
  type EffectComposerProps,
} from "@react-three/postprocessing";
import { type EffectComposer as EffectComposerImpl } from "postprocessing";

/** Wraps the R3F EffectComposer to keep a stable ref for camera-setting sync. */
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

  return (
    <WrappedEffectComposer
      ref={setComposerRef}
      {...props}
      enableNormalPass={enableNormalPass}
    />
  );
});
