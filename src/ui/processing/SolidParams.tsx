/**
 * Spec §7.2's parameters: six measure checkboxes.
 *
 * A component of its own, taking `{ params, onChange }` and touching no store,
 * so §6's "PARAMETERS: tool-specific" stays one conditional in `ToolView`
 * rather than a growing branch inside the form — the same shape
 * `RoofMetricsParams` has. There is no slider and no threshold here: §7.2's
 * only parameter besides the LoD is which measures to write.
 *
 * `<prefix>valid` is not a checkbox. §7.2 writes it always, and offering a tick
 * for a column the run writes either way would be a control that does nothing.
 */
import {
  SOLID_MEASURES,
  solidParams,
  type SolidMeasure,
} from "../../features/processing/solidParams";

export function SolidParams({
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
  const current = solidParams(params);
  const ticked = new Set<SolidMeasure>(current.measures);

  const toggle = (key: SolidMeasure) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({
      ...current,
      measures: SOLID_MEASURES.map((m) => m.key).filter((k) => next.has(k)),
    });
  };

  return (
    <div className="processing-checks">
      {SOLID_MEASURES.map((measure) => (
        // §7.2's parentheticals, which the labels trim, live here: a tooltip
        // the label carries rather than a second muted line under every box.
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
  );
}
