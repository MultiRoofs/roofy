/**
 * URL hash-based share state codec.
 *
 * Encodes a lightweight view state (camera, datetime, layers with rules)
 * into a URL hash fragment for sharing. Only URL-based layers can be shared.
 *
 * Format: #share=<base64url-encoded JSON>
 */

import type { Rule } from "../features/rules/types";
import type { PickMode } from "../domain/selection/types";
import type { GeographicCamera } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShareableLayerState {
  readonly name: string;
  readonly modelUrl: string;
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
  readonly visible: boolean;
}

/**
 * The share hash tracks the snapshot schema: since v3 the camera is the same
 * six geographic scalars `ViewState.camera` holds, not the two scene-space
 * 3-tuples (`cp`/`ct`) links minted before v3 carried. Those links no longer
 * decode — `decodeShareState` returns `null`, the same as for any other hash
 * it cannot make a camera out of — for the reason `restoreSnapshot` rejects
 * old snapshots: the old numbers are meaningless in the current frame, and
 * flying the camera somewhere arbitrary is worse than ignoring the link.
 */
export interface ShareableViewState {
  /**
   * Schema version. Declared explicitly so a hash states which frame its
   * numbers live in rather than leaving that to be inferred from shape:
   * a future v4 that reuses the `cam` key with different semantics would
   * otherwise sail past the structural check below.
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

export function decodeShareState(hash: string): ShareableViewState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(SHARE_PREFIX)) return null;

  try {
    const b64 = raw.slice(SHARE_PREFIX.length);
    const json = fromBase64Url(b64);
    const parsed = JSON.parse(json) as ShareableViewState;

    // Two independent guards, deliberately redundant. The version rejects a
    // hash that declares a schema this build does not speak (v1/v2's
    // scene-space cp/ct, or some later v4); the structural check rejects a
    // hash that claims v3 but cannot produce a camera. A payload that is
    // merely cam-shaped, with no version, fails the first.
    if (parsed.v !== SHARE_VERSION) return null;
    if (!isGeographicCamera(parsed.cam)) return null;
    if (typeof parsed.dt !== "string") return null;

    // Normalize: a camera-only link (no layers at all) is still valid.
    if (!Array.isArray(parsed.layers)) {
      return { ...parsed, layers: [] };
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build a full shareable URL from the current location and view state.
 */
export function buildShareUrl(state: ShareableViewState): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#${encodeShareState(state)}`;
}
