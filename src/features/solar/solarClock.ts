/**
 * Clock arithmetic for the solar menu's sliders.
 *
 * The sliders move in two independent axes a `Date` does not expose directly —
 * DAY OF YEAR (where the sun sits in the seasonal arc) and TIME OF DAY (where
 * it sits in today's arc) — and moving one must never disturb the other.
 * Dragging the time slider through midnight must not roll the date forward,
 * and dragging the date slider must not shift the hour, because the whole
 * point of the control is to hold one axis still while sweeping the other.
 *
 * That is fiddly enough to be worth isolating: this module is pure and has no
 * React or engine imports, so `SolarMenu` stays a rendering concern and the
 * arithmetic is unit-tested on its own — the same split `timeAnimation.ts`
 * uses for the animation loop's clock.
 *
 * Everything here works in LOCAL time, matching the date/time inputs this
 * control replaces: the user reads the scene clock as wall time, and
 * `toISOString()` would shift the displayed day for anyone not on UTC.
 */

/** Days in `year`, honouring the Gregorian leap rule. */
export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** 1 for 1 January, 365/366 for 31 December. */
export function dayOfYear(dt: Date): number {
  const startOfYear = new Date(dt.getFullYear(), 0, 1);
  const startOfDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  // Round rather than floor: a DST boundary between January and the target day
  // makes this difference 23 or 25 hours, which would otherwise land the day
  // one short for half the year.
  return (
    Math.round((startOfDay.getTime() - startOfYear.getTime()) / 86_400_000) + 1
  );
}

/**
 * The same instant moved to `day` of its own year, keeping the time of day.
 *
 * Clamped to the year's real length, so dragging to 366 in a common year
 * stays on 31 December instead of rolling into the next year — a slider that
 * silently changes the year would take the sun with it.
 */
export function withDayOfYear(dt: Date, day: number): Date {
  const year = dt.getFullYear();
  const clamped = Math.min(Math.max(Math.round(day), 1), daysInYear(year));
  const next = new Date(dt);
  // Set BOTH fields in one call, then the day: `setDate` alone would be
  // interpreted against the current month, and a two-step month-then-day would
  // pass through an invalid date (e.g. 31 February) and roll.
  next.setMonth(0, 1);
  next.setDate(clamped);
  return next;
}

/** Time of day in fractional hours, 0 to 24 exclusive (13:30 -> 13.5). */
export function hoursOfDay(dt: Date): number {
  return dt.getHours() + dt.getMinutes() / 60 + dt.getSeconds() / 3600;
}

/**
 * The same date at `hours` (fractional), rounded to the minute.
 *
 * Clamped to 00:00–23:59 rather than wrapping: the slider's own top end is
 * 24, and letting that roll to the next day would make the date slider jump
 * while the user is dragging the time one.
 */
export function withHoursOfDay(dt: Date, hours: number): Date {
  const totalMinutes = Math.min(
    Math.max(Math.round(hours * 60), 0),
    24 * 60 - 1,
  );
  const next = new Date(dt);
  next.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
  return next;
}

/** "4 Aug" — the date slider's readout. Day and month only: the year is not on
 *  any slider, and repeating it in a 3-character column would crowd it out. */
export function formatDayLabel(dt: Date): string {
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "14:05" — the time slider's readout, zero-padded so the column does not
 *  jitter as the value changes under a drag. */
export function formatClock(hours: number): string {
  const totalMinutes = Math.min(
    Math.max(Math.round(hours * 60), 0),
    24 * 60 - 1,
  );
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const m = String(totalMinutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** Slowest and fastest the animation may run, as multiples of real time. */
export const MIN_SPEED = 1;
export const MAX_SPEED = 3600;

/**
 * Speed is slider-mapped LOGARITHMICALLY, not linearly.
 *
 * The useful range spans three and a half orders of magnitude (real time to an
 * hour a second). Linearly, everything below 100× — which is the entire range
 * where you can actually watch a shadow move — would live in the first 3% of
 * the track and be unselectable.
 */
export function speedFromSlider(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return Math.round(MIN_SPEED * (MAX_SPEED / MIN_SPEED) ** clamped);
}

/** The inverse of {@link speedFromSlider}, for positioning the thumb. */
export function sliderFromSpeed(speed: number): number {
  const clamped = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
  return Math.log(clamped / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);
}

/**
 * How much scene time passes per real second — "1 min/s" rather than "60×".
 *
 * The multiplier is the honest number but not the useful one: nobody reasons
 * about shadows in multiples of real time, they reason in "how much of the day
 * goes by while I watch". This is the same quantity, said in the unit the user
 * is actually thinking in.
 */
export function formatSpeed(speed: number): string {
  if (speed >= 3600) {
    const hours = speed / 3600;
    return `${trim(hours)} h/s`;
  }
  if (speed >= 60) {
    const minutes = speed / 60;
    return `${trim(minutes)} min/s`;
  }
  return `${trim(speed)} s/s`;
}

/** One decimal at most, and none when the value is whole — so the readout
 *  column stays narrow and does not flicker between widths mid-drag. */
function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
