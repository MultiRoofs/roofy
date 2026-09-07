/**
 * URL hash-based share state codec.
 *
 * Encodes a lightweight view state (camera, datetime, layers with rules)
 * into a URL hash fragment for sharing. Only URL-based layers can be shared.
 *
 * Format: #share=<base64url-encoded JSON>
 */

import type { Rule } from "../features/rules/types";
import { normalizeColorBy, type ColorBy } from "../features/rules/colorBy";
import type { PickMode } from "../domain/selection/types";
import type { GeographicCamera } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShareableLayerState {
  readonly name: string;
  readonly modelUrl: string;
  /** The USER's rules. A shared link never carries the synthetic catch-alls
   *  the modes below are drawn with: they are derived on the other side, from
   *  the three fields under them. */
  readonly rules: ReadonlyArray<Rule>;
  /** Written as `colorBy === "rules"`, and the only thing a link minted before
   *  "Color by" existed said about the styling — which is why
   *  {@link readShareHash} can still derive a mode for one. */
  readonly rulesEnabled: boolean;
  /**
   * The layer's "Color by" mode and the two colours it may need.
   *
   * OPTIONAL, because a link minted before they existed carries none of them
   * and every link ever minted still has to open. {@link readShareHash} fills
   * all three in — validated, and with the mode derived from `rulesEnabled`
   * when it is absent — before anything downstream sees the state, the same
   * repair it already performs for a camera-only link's missing `layers`, so
   * in practice a decoded layer always has them. The hash schema therefore
   * stays v3: nothing about an existing link's meaning changed, and a build
   * that predates these fields ignores them.
   */
  readonly colorBy?: ColorBy;
  readonly singleColor?: string;
  readonly unmatchedColor?: string;
  readonly visible: boolean;
}

/**
 * The share hash tracks the snapshot schema: since v3 the camera is the same
 * six geographic scalars `ViewState.camera` holds, not the two scene-space
 * 3-tuples (`cp`/`ct`) links minted before v3 carried. Those links no longer
 * open — `readShareHash` reports them as {@link UnsupportedShareLinkError},
 * which the app turns into a message — for the reason `restoreSnapshot`
 * rejects old snapshots: the old numbers are meaningless in the current
 * frame, and flying the camera somewhere arbitrary is worse than declining
 * the link.
 */
export interface ShareableViewState {
  /**
   * Schema version. Declared explicitly so a hash states which frame its
   * numbers live in rather than leaving that to be inferred from shape:
   * a future share v4 that reused the `cam` key with different semantics
   * would otherwise sail past the structural check below.
   *
   * This number is the SHARE schema's, not the snapshot's, and the two have
   * been allowed to diverge: snapshot v4 added `activeLayer`, and a hash
   * carries no such field — it is a lightweight subset (camera, datetime,
   * URL-backed city layers) and stays one. Nothing about a v3 hash's meaning
   * changed, so every link ever minted still opens, and this stays `3` until
   * something in the HASH changes.
   */
  readonly v: 3;
  /** Per-layer state. */
  readonly layers: ReadonlyArray<ShareableLayerState>;
  /** Geographic camera (v3). */
  readonly cam: GeographicCamera;
  /** ISO 8601 datetime. */
  readonly dt: string;
  /** Pick mode. */
  readonly pm: PickMode;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const SHARE_PREFIX = "share=";

/** The only schema version this build mints and the only one it accepts. */
const SHARE_VERSION = 3;

function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

export function encodeShareState(state: ShareableViewState): string {
  // The version is stamped here rather than taken from the caller so that
  // every hash this build mints is tagged, whatever the caller passed.
  const json = JSON.stringify({ ...state, v: SHARE_VERSION });
  return SHARE_PREFIX + toBase64Url(json);
}

const CAMERA_FIELDS = [
  "lng",
  "lat",
  "height",
  "heading",
  "pitch",
  "roll",
] as const;

/**
 * True only for an object carrying all six camera scalars as finite numbers.
 * A NaN/undefined component would reach `setCamera` and wedge the engine's
 * camera, so a malformed hash is treated as no hash at all.
 */
function isGeographicCamera(value: unknown): value is GeographicCamera {
  if (typeof value !== "object" || value === null) return false;
  const cam = value as Record<string, unknown>;
  return CAMERA_FIELDS.every((f) => Number.isFinite(cam[f]));
}

/**
 * A share hash that IS one but speaks a schema this build cannot read — the
 * URL counterpart of {@link UnsupportedSnapshotVersionError}, and for the same
 * reason: a pre-v3 link's `cp`/`ct` are scene coordinates measured from an
 * origin-offset mesh frame the Navara viewport no longer has, so opening it
 * could only fly the camera somewhere arbitrary.
 *
 * It exists so the app can TELL the user that, rather than dropping the link
 * on the floor: "nothing happened" is indistinguishable from a broken app.
 */
export class UnsupportedShareLinkError extends Error {
  /**
   * The `v` the link declared, or `null` for a link that declared none —
   * which is exactly what a pre-v3 link looks like, since the discriminator
   * was only introduced with v3.
   */
  constructor(readonly found: number | null) {
    super(
      found !== null && found > SHARE_VERSION
        ? `This share link was created by a newer version of Roofy (v${found}) than this one, so it cannot be opened here.`
        : "This share link was created by an older version of Roofy and can no longer be opened. Shared cameras changed from scene coordinates to geographic coordinates; please ask for a new link.",
    );
    this.name = "UnsupportedShareLinkError";
  }
}

/**
 * What a URL hash turned out to be.
 *
 * Three outcomes, not two, because "there is no share link here" and "there is
 * one and it is from another version" call for different behaviour: the first
 * is the ordinary case of any URL without a hash, the second is a message the
 * user needs to see (Task C20 / ledger C18).
 *
 * A hash that carries the share prefix but whose payload is unreadable
 * (truncated base64, non-JSON) is reported as `"none"`: nothing can be said
 * about it beyond "not a link this build can use", and a damaged link is not
 * evidence of a version change.
 */
export type ShareHashResult =
  | { readonly kind: "none" }
  | { readonly kind: "unsupported"; readonly error: UnsupportedShareLinkError }
  | { readonly kind: "ok"; readonly state: ShareableViewState };

const NO_SHARE_HASH: ShareHashResult = { kind: "none" };

export function readShareHash(hash: string): ShareHashResult {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(SHARE_PREFIX)) return NO_SHARE_HASH;

  let parsed: ShareableViewState;
  try {
    parsed = JSON.parse(
      fromBase64Url(raw.slice(SHARE_PREFIX.length)),
    ) as ShareableViewState;
  } catch {
    return NO_SHARE_HASH;
  }
  if (typeof parsed !== "object" || parsed === null) return NO_SHARE_HASH;

  // Two independent guards, deliberately redundant. The version rejects a
  // hash that declares a schema this build does not speak (v1/v2's
  // scene-space cp/ct, or some later v4); the structural check rejects a
  // hash that claims v3 but cannot produce a camera. A payload that is
  // merely cam-shaped, with no version, fails the first.
  if (parsed.v !== SHARE_VERSION) {
    return {
      kind: "unsupported",
      error: new UnsupportedShareLinkError(
        typeof parsed.v === "number" ? parsed.v : null,
      ),
    };
  }
  if (!isGeographicCamera(parsed.cam)) return NO_SHARE_HASH;
  if (typeof parsed.dt !== "string") return NO_SHARE_HASH;

  // Normalize: a camera-only link (no layers at all) is still valid, and every
  // layer gets its three styling fields validated and defaulted here — through
  // the SAME function the snapshot path uses, so one workspace cannot come back
  // differently depending on which door it arrived by.
  const layers = Array.isArray(parsed.layers)
    ? parsed.layers.map((l) => ({ ...l, ...normalizeColorBy(l) }))
    : [];
  return { kind: "ok", state: { ...parsed, layers } };
}

/**
 * Build a full shareable URL from the current location and view state.
 */
export function buildShareUrl(state: ShareableViewState): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#${encodeShareState(state)}`;
}
