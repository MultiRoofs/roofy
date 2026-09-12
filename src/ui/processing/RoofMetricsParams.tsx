/**
 * Spec §7.1's parameters: six measure checkboxes and the flat-threshold slider.
 *
 * A component of its own, taking `{ params, onChange }` and touching no store,
 * so §6's "PARAMETERS: tool-specific" stays one conditional in `ToolView`
 * rather than a growing branch inside the form. The next parameterised tool is
 * a sibling file and one more line there.
 *
 * The slider is a bare `input[type="range"]`: `flatControls.css` styles every
 * range input in the app (3 px track, 12 px lime thumb, focus ring), so adding
 * any here would put this one control off the tokens. Its layout follows the
 * Sun & shade sheet's "Time of day" slider — caption, input, a muted value.
 */
import {
  FLAT_THRESHOLD_MAX,
  FLAT_THRESHOLD_MIN,
  ROOF_MEASURES,
  roofParams,
  type RoofMeasure,
} from "../../features/processing/roofMetricsParams";

export function RoofMetricsParams({
  params,
  onChange,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
}) {
  // Normalised on the way in, so an untouched draft (`params: {}`) renders the
  // defaults, and written back WHOLE on every change — the draft then holds an
  // explicit list, which is what makes "untick everything" a state the form can
  // reach at all.
  const current = roofParams(params);
  const ticked = new Set<RoofMeasure>(current.measures);

  const toggle = (key: RoofMeasure) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({
      ...current,
      measures: ROOF_MEASURES.map((m) => m.key).filter((k) => next.has(k)),
    });
  };

  return (
    <>
      <div className="processing-checks">
        {ROOF_MEASURES.map((measure) => (
          // §7.1's parenthetical explanations, which the labels trim, live
          // here: a tooltip the label carries rather than a second muted line
          // under every checkbox.
          <label key={measure.key} title={measure.hint ?? undefined}>
            <input
              type="checkbox"
              checked={ticked.has(measure.key)}
              onChange={() => toggle(measure.key)}
            />
            {measure.label}
          </label>
        ))}
      </div>
      <label className="processing-slider">
        <span>Flat threshold</span>
        <input
          aria-label="Flat threshold"
          type="range"
          min={FLAT_THRESHOLD_MIN}
          max={FLAT_THRESHOLD_MAX}
          step="1"
          value={current.flatThresholdDeg}
          onChange={(e) =>
            onChange({ ...current, flatThresholdDeg: Number(e.target.value) })
          }
        />
        <span className="processing-slider__value">
          {current.flatThresholdDeg}°
        </span>
      </label>
    </>
  );
}
