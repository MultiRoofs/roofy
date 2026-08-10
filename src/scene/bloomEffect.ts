/**
 * The theme's BLOOM pass: a custom `EffectDesc` around `postprocessing`'s
 * `BloomEffect`.
 *
 * This is an ENGINE-BINDING module — it imports `@navaramap/three` for VALUES
 * (`EffectDesc`, `Effect`) and therefore cannot be loaded under Node
 * (NODE_IMPORT_SAFE = false). Only `NavaraViewport.tsx` imports it, and only
 * `sceneThemePolicy.ts`'s plain-data `bloom` block reaches it, so the policy
 * table stays importable from a unit test while the engine work lives here.
 *
 * WHY A CUSTOM PASS AT ALL. `@navaramap/three-default-descs` ships
 * `selectiveBloom`, but it drives the MRT emissive buffer through
 * `USE_SELECTIVE_EFFECT`, which the basic-family materials our city meshes use
 * fail to compile with on 0.0.5. A full-screen threshold bloom needs no
 * per-object opt-in at all: the theme's edge lines already carry genuinely HDR
 * vertex colours (`ThemeStyle.edges.hdr`, components > 1), so a luminance
 * threshold picks them out and leaves the near-black building fills alone.
 *
 * WHY IT IS INSERTED BEFORE `toneMapping`. That is the pass that maps HDR
 * radiance to display range; downstream of it every edge line is already
 * clamped and nothing would exceed the threshold.
 */
// `ThreeView` is the package's DEFAULT export and has no named twin, so the
// descriptor's constructor signature has to reach it that way.
import ThreeView, {
  Effect as NavaraEffect,
  EffectDesc,
  type EffectConfig,
  type EffectDescConstructor,
  type EffectUpdate,
  type ViewContext,
} from "@navaramap/three";
import { BloomEffect } from "postprocessing";
import type { ThemeBloom } from "./sceneThemePolicy";

/**
 * The descriptor's registration name, its static `key` AND its config key —
 * all three must be the same string.
 *
 * `ThreeView.addEffect` picks the descriptor by looking for a registered name
 * among the config's own keys (`findTypeFromConfig`), so a mismatch is not a
 * type error but a silent "unknown effect" throw at add time. Deliberately NOT
 * `"bloom"`: the engine's own registry already owns `selectiveBloom`, and a
 * name close enough to be confused with a built-in is worse than an odd one.
 */
export const BLOOM_EFFECT_KEY = "cityBloom";

/** The engine's own `visible` flag plus our block. `Partial`, because the
 *  engine constructs a descriptor with whatever config it was handed. */
type BloomEffectConfig = EffectConfig & {
  /** Must be spelled exactly {@link BLOOM_EFFECT_KEY}. */
  cityBloom?: ThemeBloom;
};

type BloomEffectUpdate = EffectUpdate & {
  cityBloom?: Partial<ThemeBloom>;
};

/**
 * What a `BloomEffect` gets when the policy leaves a field out — the only
 * defaults in the app, since every theme states its whole block.
 */
const BLOOM_DEFAULTS: ThemeBloom = {
  intensity: 1,
  luminanceThreshold: 1,
  luminanceSmoothing: 0.2,
  radius: 0.85,
};

/**
 * The descriptor class, built ONCE and lazily.
 *
 * Lazily because `class … extends EffectDesc` evaluates the base class the
 * moment the module is evaluated, and every viewport unit test mocks
 * `@navaramap/three` — `extends undefined` would throw at import time, in
 * suites that never ask for bloom at all. Built once because the registry keys
 * on the class, and a fresh class per registration would defeat the
 * add-once-then-toggle contract further down.
 */
let cachedDescClass: EffectDescConstructor | null = null;

function bloomEffectDescClass(): EffectDescConstructor {
  if (cachedDescClass !== null) return cachedDescClass;

  class BloomEffectDesc extends EffectDesc<
    BloomEffectConfig,
    BloomEffectUpdate,
    NavaraEffect<BloomEffect>
  > {
    static key = BLOOM_EFFECT_KEY;
    /** No `insertAfter`: it WINS over `insertBefore` when it matches, and the
     *  only placement that works is immediately upstream of the tone curve
     *  (`final` is the fallback for an engine build with no tone-mapping pass
     *  in the chain — the same pair the engine's own lens flare uses). */
    static insertBefore = ["toneMapping", "final"];

    /** `EffectDesc` keeps the view, the ctx and `visible` — not the config, so
     *  a descriptor that needs its own block has to hold on to it (exactly as
     *  the engine's `VignetteEffectDesc` example does). */
    private readonly spec: ThemeBloom;

    constructor(view: ThreeView, ctx: ViewContext, config: BloomEffectConfig) {
      super(view, ctx, config);
      this.spec = { ...BLOOM_DEFAULTS, ...config.cityBloom };
    }

    /**
     * THE ONE PIECE OF THIS FILE THAT MUST NOT BE "SIMPLIFIED": the pass is
     * wrapped in the ENGINE'S `Effect` class, never in our own
     * `new EffectPass(...)`.
     *
     * `@navaramap/three` 0.0.5 INLINES its copy of `postprocessing` (6.39.3)
     * into its bundle rather than importing the peer dependency, so the app's
     * `postprocessing` (6.39.0) exports a DIFFERENT `Pass` class object. And
     * `EffectDesc.insertPass` picks the pass to hand the composer with
     * `instance instanceof Pass ? instance.rawPass : instance instanceof
     * PostprocessingPass ? instance : undefined` — against the engine's own
     * two classes. An app-built `EffectPass` matches neither: `EffectDesc.raw`
     * comes back `undefined`, `onCreate` skips `insertPass` entirely, and
     * `addEffect` SUCCEEDS while nothing is ever added to the chain.
     *
     * The engine's `Effect` wrapper (`new Effect(camera, effect)`) builds the
     * engine's own `EffectPass` around whichever effect it is given, which is
     * how a `BloomEffect` from the app's copy reaches the pipeline. The two
     * copies are the same minor version and `EffectPass` reads an effect
     * purely structurally (no `instanceof` anywhere in it, checked in the
     * 0.0.5 bundle), so the cross-copy composition is safe — but it is the
     * kind of thing a `postprocessing` bump could break, so re-verify that the
     * halo still renders when either version moves.
     *
     * `mipmapBlur` is what makes the glow DIFFUSE (a wide, cheap mip pyramid)
     * rather than a tight kernel around the line, and it is also what makes
     * `radius` mean anything.
     */
    createPass(): NavaraEffect<BloomEffect> & { visible: boolean } {
      const effect = new BloomEffect({
        intensity: this.spec.intensity,
        luminanceThreshold: this.spec.luminanceThreshold,
        luminanceSmoothing: this.spec.luminanceSmoothing,
        mipmapBlur: true,
        radius: this.spec.radius,
      });
      return new NavaraEffect(
        this.view.camera.raw,
        effect,
      ) as NavaraEffect<BloomEffect> & { visible: boolean };
    }

    /**
     * `super` first: the base class owns `visible`, which is the flag the
     * theme layer toggles the pass with instead of deleting it.
     *
     * The per-field writes below are the live-pass path. Nothing in the app
     * drives them today (a theme's block is one frozen object and only cyber
     * has one), but a descriptor that silently ignored an update would be a
     * trap the first time somebody puts these on a slider.
     */
    onUpdateConfig(updates: BloomEffectUpdate): void {
      super.onUpdateConfig(updates);
      const wanted = updates.cityBloom;
      const effect = this._instance?.rawEffect;
      if (wanted === undefined || effect === undefined) return;
      if (wanted.intensity !== undefined) effect.intensity = wanted.intensity;
      if (wanted.luminanceThreshold !== undefined) {
        effect.luminanceMaterial.threshold = wanted.luminanceThreshold;
      }
      if (wanted.luminanceSmoothing !== undefined) {
        effect.luminanceMaterial.smoothing = wanted.luminanceSmoothing;
      }
      if (wanted.radius !== undefined) {
        effect.mipmapBlurPass.radius = wanted.radius;
      }
    }
  }

  // The engine's constructor type is written in terms of the BASE config; ours
  // narrows it, which a `new (…) => …` type will not accept structurally.
  cachedDescClass = BloomEffectDesc as unknown as EffectDescConstructor;
  return cachedDescClass;
}

/**
 * Teach this view about the bloom descriptor, once.
 *
 * Called at first NEED rather than at init, which keeps a session that never
 * leaves photoreal a genuine no-op (and keeps `registerEffect` off the mocks of
 * every viewport suite that does not test themes). `registerEffect` is a plain
 * `Map.set`, so a repeat call is harmless — the caller tracks it anyway to keep
 * a failure from being reported once per theme switch.
 *
 * @returns whether the descriptor is available. `false` means "render without
 *   bloom": a browser (or an engine build) that refuses the descriptor must
 *   still get the rest of the theme, exactly as the clouds and fog lights do.
 */
export function registerBloomEffect(view: {
  registerEffect?: (name: string, cls: EffectDescConstructor) => void;
}): boolean {
  try {
    if (typeof view.registerEffect !== "function") {
      throw new TypeError("view.registerEffect is not a function");
    }
    view.registerEffect(BLOOM_EFFECT_KEY, bloomEffectDescClass());
    return true;
  } catch (error) {
    console.warn(
      "NavaraViewport: the bloom effect could not be registered; the theme " +
        "renders without its glow.",
      error,
    );
    return false;
  }
}

/** The `addEffect`/`update` payload for one theme's bloom block. */
export function bloomEffectConfig(spec: ThemeBloom): BloomEffectConfig {
  return { [BLOOM_EFFECT_KEY]: spec } as BloomEffectConfig;
}
