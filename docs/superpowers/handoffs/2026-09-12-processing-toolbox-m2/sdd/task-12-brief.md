### Task 12: The PARAMETERS section — six checkboxes, a threshold slider, one validation

**Files:**

- Create: `src/ui/processing/RoofMetricsParams.tsx`
- Modify: `src/ui/processing/ToolView.tsx` (the import, a new fieldset between TARGET ending `:181` and OUTPUT starting `:182`, the extension note, and `run()`'s frozen params), `src/ui/processing/useToolForm.ts` (`paramsError`, `extensionNote`, `runReason`), `src/ui/processing/processing.css`
- Modify (comment only): `tests/unit/ui/processing/useToolForm.test.tsx:53-55`
- Test: `tests/unit/ui/processing/RoofMetricsParams.test.tsx`

**Interfaces:**

- Consumes: `ROOF_MEASURES`, `roofParams`, `FLAT_THRESHOLD_MIN`, `FLAT_THRESHOLD_MAX` (Task 8); `ToolDefinition.validateParams`/`normaliseParams` (Task 8); `addRoofLayer` (Task 11).
- Produces: `useToolForm` gains `paramsError: string | null` and `extensionNote: string | null`; `RoofMetricsParams` is a `{ params, onChange }` component, so a second parameterised tool in M3 is a sibling file and one more line in `ToolView`.

**The slider's peer.** `src/app/flatControls.css:237-284` styles **every** `input[type="range"]` in the app, so the control is already on the tokens — no thumb or track CSS may be added here. The layout peer is the Sun & shade sheet's "Time of day" slider (`src/ui/viewport/SunShadeSheet.tsx:142-165`): a `<label>` wrapping the caption, the input with an `aria-label`, and a small muted row under it. Verify the two side by side in the browser at Task 15.

**The `measure-solids` registry mock in `useToolForm.test.tsx` STAYS.** M1 deferred "delete it once a second real tool exists", but Roof metrics is not that tool: it has `needsReader: false` and `extension: null` and is eligible on streaming targets too, so among the ready-table `candidates` (`useToolForm.ts:53-56`) it can no more discriminate one layer from another than Height from extent can. Only a reader-needing or extension-needing tool can, and the first of those is M3's.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/processing/RoofMetricsParams.test.tsx`. Copy `lodSelect.test.tsx`'s ENTIRE header verbatim — the three `vi.mock` blocks (duckdb with Task 1's two keys, `runQueue`, `useLayerCounts` with the mutable `counts` object at `all: 4`), the `toolRegistry` mock that enables `roof-metrics`, every dynamic import including `addRoofLayer` from `./roofLayerFixture`, and its `beforeEach`/`afterEach` reset pair. Then:

```tsx
describe("Roof metrics PARAMETERS (spec §6, §7.1)", () => {
  it("opens with all six measures ticked and the threshold at 5", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    for (const label of [
      "Total roof area (m²)",
      "Flat roof area (m²)",
      "Flat share",
      "Mean slope (deg)",
      "Dominant azimuth (deg)",
      "Roof surface count",
    ]) {
      expect(screen.getByLabelText(label)).toBeChecked();
    }
    expect(
      (screen.getByLabelText("Flat threshold") as HTMLInputElement).value,
    ).toBe("5");
  });

  it("prints the columns of the ticked measures, in the spec's order", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Flat share"));
    fireEvent.click(screen.getByLabelText("Mean slope (deg)"));
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
  });

  it("blocks Run with 'Pick at least one measure' when nothing is ticked", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    for (const label of [
      "Total roof area (m²)",
      "Flat roof area (m²)",
      "Flat share",
      "Mean slope (deg)",
      "Dominant azimuth (deg)",
      "Roof surface count",
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(
      screen.getAllByText("Pick at least one measure").length,
    ).toBeGreaterThan(0);
  });

  it("carries the measures and the threshold into the run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.click(screen.getByLabelText("Flat share"));
    fireEvent.change(screen.getByLabelText("Flat threshold"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const request = vi.mocked(submitRun).mock.calls[0]![0]!;
    expect(request.params).toEqual({
      measures: ["area", "flatArea", "slope", "azimuth", "surfaces"],
      flatThresholdDeg: 12,
    });
    expect(request.columns.map((c) => c.name)).toEqual([
      "roof_area_m2",
      "roof_flat_m2",
      "roof_slope_deg",
      "roof_azimuth_deg",
      "roof_surfaces_n",
    ]);
  });

  it("freezes the NORMALISED parameters even when the user changed nothing", () => {
    // §6.4: the log is "the reproducible record of the run". An untouched
    // draft is `{}`, and a log reading "Parameters: —" for a run that used six
    // measures and a 5° threshold is not a record of anything.
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(vi.mocked(submitRun).mock.calls[0]![0]!.params).toEqual({
      measures: [
        "area",
        "flatArea",
        "flatShare",
        "slope",
        "azimuth",
        "surfaces",
      ],
      flatThresholdDeg: 5,
    });
  });

  it("shows the threshold's current value beside the slider", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByLabelText("Flat threshold"), {
      target: { value: "0" },
    });
    expect(screen.getByText("0°")).toBeInTheDocument();
  });

  it("explains each measure where the user can read it", () => {
    // §7.1 carries explanations the labels trim ("0-1", "area-weighted", "of
    // the largest non-flat surface"); they land as the label's tooltip.
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByLabelText("Flat share").closest("label"),
    ).toHaveAttribute("title", "0-1: the flat area over the total roof area");
    expect(
      screen.getByLabelText("Mean slope (deg)").closest("label"),
    ).toHaveAttribute("title", "Area-weighted over every roof surface");
    expect(
      screen.getByLabelText("Dominant azimuth (deg)").closest("label"),
    ).toHaveAttribute("title", "Of the largest non-flat surface");
  });

  it("offers no PARAMETERS section for a tool that has none", () => {
    addRoofLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByText("PARAMETERS")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/RoofMetricsParams.test.tsx
```

Expected: FAIL — no checkbox with any of those labels.

- [ ] **Step 3: Write the section**

Create `src/ui/processing/RoofMetricsParams.tsx`:

```tsx
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
```

- [ ] **Step 4: Validate, and note the extension, in the form**

In `src/ui/processing/useToolForm.ts`, after `prefixError` (`:131-135`):

```ts
// Spec §6: "Validation is inline and blocks Run" — the message comes from the
// tool's own definition, so the rule and the columns it governs live together.
const paramsError = tool.validateParams?.(draft.params) ?? null;
// §6: "Extension note when the tool's extension is not yet loaded."
const ext = tool.extension;
const extensionNote =
  ext !== null && targetCtx.extensionState[ext] !== "loaded"
    ? `Loads the ${ext} extension on first run (about ${ext === "spatial" ? "24 MB" : "1 MB"}, once per session).`
    : null;
```

Put `paramsError` into the precedence chain from Task 11:

```ts
const runReason = !eligibility.ok
  ? eligibility.reason
  : (lods.emptyReason ?? prefixError ?? paramsError ?? scopeReason);
```

and return both new values beside `prefixError`.

(§6's example sentence ends with a full stop; §5's chip tooltip does not. Each is verbatim to its own section.)

- [ ] **Step 5: Render the fieldset, the note, and freeze the normalised params**

In `src/ui/processing/ToolView.tsx`:

Add the import beside the others at the top:

```tsx
import { RoofMetricsParams } from "./RoofMetricsParams";
```

Between `</fieldset>` (`:181`) and the OUTPUT `<fieldset>` (`:182`):

Again, insert the fragment's CONTENTS, not the `<>` wrapper:

```tsx
<>
  {toolId === "roof-metrics" && (
    <fieldset className="processing-section" disabled={locked}>
      <legend className="processing-group__label">PARAMETERS</legend>
      <RoofMetricsParams
        params={f.draft.params}
        onChange={(params) => f.setDraft({ params })}
      />
      {f.paramsError !== null && (
        <p className="processing-error" role="alert">
          {f.paramsError}
        </p>
      )}
    </fieldset>
  )}
</>
```

At the end of the OUTPUT fieldset, after the replace warning (`:227`):

```tsx
<>
  {/* §6: "Extension note when the tool's extension is not yet loaded" — the
      same sentence the catalogue's chip shows as its tooltip, here as a line
      the user does not have to hover to read. */}
  {f.extensionNote !== null && (
    <p className="processing-note">{f.extensionNote}</p>
  )}
</>
```

And in `run()` (`:74-85`), freeze the NORMALISED bag:

```tsx
      params: f.tool.normaliseParams?.(f.draft.params) ?? f.draft.params,
```

- [ ] **Step 6: Style the two new blocks**

Append to `src/ui/processing/processing.css` after `.processing-radios label` (`:236-241`):

```css
/* §6's two-column checkbox grid. It drops to one column in a narrow panel
   rather than clipping a label — the panel is resizable. */
.processing-checks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px 12px;
  margin-bottom: 10px;
}
.processing-checks label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
/* Caption, slider, value — the Sun & shade sheet's shape. The input itself is
   styled once for the whole app in flatControls.css; nothing here touches it. */
.processing-slider {
  display: grid;
  grid-template-columns: 84px 1fr 28px;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.processing-slider > span:first-child {
  color: var(--fg-muted);
}
.processing-slider__value {
  text-align: right;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 7: Record why the `measure-solids` mock survived**

In `tests/unit/ui/processing/useToolForm.test.tsx`, replace the comment at `:53-55` with:

```ts
/** Measure solids is still M3's, and it is still the only tool whose
 *  eligibility can fail on one ready layer and pass on another (it needs a
 *  reader). M2's Roof metrics needs neither a reader nor an extension and runs
 *  on streaming targets too, so it cannot discriminate the ready-table
 *  `candidates` any more than Height from extent can — this mock stays until a
 *  reader- or extension-needing tool ships. */
```

- [ ] **Step 8: Run the tests**

```bash
npx vitest run tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/processing/RoofMetricsParams.tsx src/ui/processing/ToolView.tsx \
  src/ui/processing/useToolForm.ts src/ui/processing/processing.css \
  tests/unit/ui/processing/RoofMetricsParams.test.tsx \
  tests/unit/ui/processing/useToolForm.test.tsx
git commit -m "feat(processing): Roof metrics' measures and flat threshold in the tool form"
```

---
