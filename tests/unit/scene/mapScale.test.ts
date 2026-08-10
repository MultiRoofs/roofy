/**
 * The scale bar's maths, which is the whole of the feature that can be wrong
 * silently: the bar itself is a `<div>` of a given width, so if these numbers
 * are off nothing looks broken — it just LIES about how far apart things are.
 *
 * Engine-free by construction (`src/scene/mapScale.ts` imports nothing), so the
 * table below is the specification: Web-Mercator metres-per-pixel at the
 * equator and at 60°N, and the 1-2-5 ladder the bar length is snapped to.
 */
import { describe, expect, it } from "vitest";
import {
  EQUATOR_METRES_PER_PIXEL_Z0,
  metresPerPixel,
  pickScaleBar,
} from "../../../src/scene/mapScale";

describe("metresPerPixel", () => {
  it("is the Web-Mercator constant at the equator, zoom 0", () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(EQUATOR_METRES_PER_PIXEL_Z0, 6);
  });

  it("halves with every zoom level", () => {
    const z10 = metresPerPixel(0, 10);
    expect(metresPerPixel(0, 11)).toBeCloseTo(z10 / 2, 9);
    // Fractional zooms are the engine's own currency, so they must work too.
    expect(metresPerPixel(0, 10.5)).toBeCloseTo(z10 / Math.SQRT2, 9);
  });

  it("shrinks by cos(latitude) away from the equator", () => {
    // 60°N: cos 60° = 0.5 exactly, so a pixel covers half the ground it does
    // at the equator. This is the term a scale bar that ignores latitude gets
    // wrong by a factor of two over northern Europe.
    expect(metresPerPixel(60, 12)).toBeCloseTo(metresPerPixel(0, 12) / 2, 9);
    // Symmetric about the equator.
    expect(metresPerPixel(-60, 12)).toBeCloseTo(metresPerPixel(60, 12), 12);
  });

  it("scales by the device pixel ratio when one is given", () => {
    expect(metresPerPixel(0, 12, 2)).toBeCloseTo(metresPerPixel(0, 12) * 2, 9);
  });

  it("answers NaN rather than a plausible-looking number for junk input", () => {
    expect(metresPerPixel(Number.NaN, 12)).toBeNaN();
    expect(metresPerPixel(52, Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

describe("pickScaleBar", () => {
  /** The bar for `metres` on the ground is `metres / mpp` pixels wide. */
  function widthFor(metres: number, mpp: number): number {
    return metres / mpp;
  }

  it("picks the largest 1-2-5 length that still fits", () => {
    // 1 m per pixel, 120 px of room: 100 m fits (100 px), 200 m does not.
    const bar = pickScaleBar(1, 120);
    expect(bar).not.toBeNull();
    expect(bar!.label).toBe("100 m");
    expect(bar!.widthPx).toBeCloseTo(widthFor(100, 1), 6);
  });

  it("walks the whole 1-2-5 ladder as the room grows", () => {
    const labels = [100, 150, 250, 500, 1000, 2500].map(
      (maxPx) => pickScaleBar(1, maxPx)!.label,
    );
    expect(labels).toEqual([
      "100 m",
      "100 m",
      "200 m",
      "500 m",
      "1 km",
      "2 km",
    ]);
  });

  it("labels a kilometre and above in km", () => {
    expect(pickScaleBar(10, 120)!.label).toBe("1 km");
    expect(pickScaleBar(100, 120)!.label).toBe("10 km");
    expect(pickScaleBar(2000, 120)!.label).toBe("200 km");
  });

  it("never returns a bar wider than the room it was given", () => {
    for (const mpp of [0.05, 0.7, 3, 17, 400, 9000]) {
      const bar = pickScaleBar(mpp, 120);
      expect(bar).not.toBeNull();
      expect(bar!.widthPx).toBeLessThanOrEqual(120);
      // ...and not a stub either: a bar under a fifth of the room reads as a
      // rendering bug rather than as a scale.
      expect(bar!.widthPx).toBeGreaterThan(120 / 5.1);
    }
  });

  it("refuses to draw a bar it cannot compute", () => {
    expect(pickScaleBar(Number.NaN, 120)).toBeNull();
    expect(pickScaleBar(0, 120)).toBeNull();
    expect(pickScaleBar(-2, 120)).toBeNull();
    expect(pickScaleBar(10, 0)).toBeNull();
  });
});
