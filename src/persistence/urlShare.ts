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

function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

export function encodeShareState(state: ShareableViewState): string {
  const json = JSON.stringify(state);
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

    // Basic validation. A pre-v3 link (cp/ct tuples, no `cam`) fails here.
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
