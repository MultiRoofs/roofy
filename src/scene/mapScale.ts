/**
 * The map scale bar's maths.
 *
 * Pure and ENGINE-FREE, like `geographicCamera.ts` and `cameraControls.ts`
 * beside it: the only input is the camera's latitude and the engine's own
 * fractional Web-Mercator `zoom`, so the whole thing is unit-testable without
 * WebGL (`@navaramap/three` crashes at module scope under Node —
 * `NODE_IMPORT_SAFE = false`).
 *
 * WHY ZOOM AND NOT HEIGHT. The camera's ellipsoid height is not a scale: the
 * ground distance a pixel covers also depends on the field of view and on the
 * viewport's size, and the engine has already folded all three into
 * `camera.zoom`. Reading that keeps this module honest about the one thing it
 * cannot know from six scalars alone.
 *
 * WHY THE SCALE IS AN APPROXIMATION, always. A tilted 3D view has no single
 * scale — the ground near the top of the frame is further away and therefore
 * more compressed than the ground at the bottom — and even in plan view Web
 * Mercator stretches with latitude. What is drawn is the scale at the CENTRE of
 * the screen, which is what every web map's bar has ever meant; the component
 * says so in its tooltip.
 */

/**
 * Metres per pixel at the equator at zoom 0 — the equator's circumference
 * (40075016.686 m) over the 256-pixel world tile. The constant every Web
 * Mercator scale is derived from.
 */
export const EQUATOR_METRES_PER_PIXEL_Z0 = 156543.03392;

const DEG_TO_RAD = Math.PI / 180;

/**
 * How much ground one pixel covers at `lat` (degrees) and fractional `zoom`.
 *
 * `dpr` is device pixels per CSS pixel, and MULTIPLIES the result: it is only
 * to be passed when the caller's `zoom` was computed against device pixels
 * while the bar is drawn in CSS pixels. The viewport does not pass it (the
 * engine's zoom and the overlay's layout are in the same units); it exists so
 * that assumption is expressible rather than baked in.
 *
 * NaN for a non-finite input, deliberately: a zero or a made-up number here
 * would draw a scale bar that is confidently wrong, where NaN makes
 * {@link pickScaleBar} return `null` and the bar disappear.
 */
export function metresPerPixel(lat: number, zoom: number, dpr = 1): number {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(zoom) ||
    !Number.isFinite(dpr)
  ) {
    return Number.NaN;
  }
  return (
    (EQUATOR_METRES_PER_PIXEL_Z0 * Math.cos(lat * DEG_TO_RAD) * dpr) / 2 ** zoom
  );
}

/** A bar to draw: how wide, and what to write under it. */
export interface ScaleBarChoice {
  /** The bar's width in pixels — never more than the `maxWidthPx` asked for. */
  readonly widthPx: number;
  /** The ground distance the bar spans, formatted with its unit. */
  readonly label: string;
}

/** The 1-2-5 ladder, as the multipliers of a power of ten. */
const LADDER = [1, 2, 5] as const;

/**
 * The largest round distance whose bar fits in `maxWidthPx`, as a width and a
 * label.
 *
 * Round means the 1-2-5 ladder (100 m, 200 m, 500 m, 1 km, ...) — the same
 * progression every map uses, because a bar labelled "137 m" is unreadable at a
 * glance even though it would use every available pixel. The worst case still
 * fills two fifths of the room, so the bar never shrinks to a stub.
 *
 * `null` when there is nothing honest to draw: no scale yet (the engine reports
 * `zoom` only once it has rendered), a degenerate one, or no room.
 */
export function pickScaleBar(
  metresPerPixel: number,
  maxWidthPx: number,
): ScaleBarChoice | null {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return null;
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) return null;

  const maxMetres = metresPerPixel * maxWidthPx;
  if (!Number.isFinite(maxMetres) || maxMetres <= 0) return null;

  let exponent = Math.floor(Math.log10(maxMetres));
  let mantissa = maxMetres / 10 ** exponent;
  // Float drift can push the mantissa to 10 (or just under 1) at exact powers
  // of ten; renormalise rather than emit a "10 x 10^n" rung the ladder has no
  // entry for.
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent += 1;
  } else if (mantissa < 1) {
    mantissa *= 10;
    exponent -= 1;
  }

  let multiplier: number = LADDER[0];
  for (const rung of LADDER) {
    if (mantissa >= rung) multiplier = rung;
  }
  const metres = multiplier * 10 ** exponent;
  return { widthPx: metres / metresPerPixel, label: formatDistance(metres) };
}

/** Metres below a kilometre, kilometres at or above it — the ladder only ever
 *  produces whole numbers of either, so no rounding rule is needed. */
function formatDistance(metres: number): string {
  if (metres >= 1000) {
    const km = metres / 1000;
    return `${Number.isInteger(km) ? km : Number(km.toFixed(1))} km`;
  }
  return `${Number.isInteger(metres) ? metres : Number(metres.toFixed(2))} m`;
}
