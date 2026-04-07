/**
 * URL hash-based share state codec.
 *
 * Encodes a lightweight view state (camera, datetime, model URL, rules)
 * into a URL hash fragment for sharing. Only works fully when the model
 * was loaded from a URL — local file models can encode the state but
 * the model won't auto-load on another device.
 *
 * Format: #share=<base64url-encoded JSON>
 */

import type { Rule } from "../features/rules/types";
import type { PickMode } from "../domain/selection/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShareableViewState {
  /** Model source URL, or null for local files. */
  readonly modelUrl: string | null;
  /** Camera position [x, y, z]. */
  readonly cp: readonly [number, number, number];
  /** Camera target [x, y, z]. */
  readonly ct: readonly [number, number, number];
  /** ISO 8601 datetime. */
  readonly dt: string;
  /** Active rules (compact). */
  readonly rules: ReadonlyArray<Rule>;
  /** Rules enabled toggle. */
  readonly re: boolean;
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

export function decodeShareState(hash: string): ShareableViewState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(SHARE_PREFIX)) return null;

  try {
    const b64 = raw.slice(SHARE_PREFIX.length);
    const json = fromBase64Url(b64);
    const parsed = JSON.parse(json) as ShareableViewState;

    // Basic validation
    if (!Array.isArray(parsed.cp) || parsed.cp.length !== 3) return null;
    if (!Array.isArray(parsed.ct) || parsed.ct.length !== 3) return null;
    if (typeof parsed.dt !== "string") return null;

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
