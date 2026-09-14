### Task 26: Palette rotation, and `Color by = Rules` at Save

**Files:**

- Create: `src/features/rules/nextRuleColor.ts`.
- Modify: `src/scene/cityColors.ts`, `src/ui/layers/RulesEditor.tsx`, `src/ui/processing/RunFooter.tsx`, `tests/unit/scene/cityColors.test.ts`.
- Test: `tests/unit/features/rules/nextRuleColor.test.ts`, additions to `tests/unit/ui/processing/styleByResult.test.tsx` (Task 9's file).

**Interfaces:** Produces `RULE_PALETTE_HEX` (beginning with `NEW_RULE_COLOR_HEX`) and `nextRuleColor(rules)`. `defaultRuleFormValues()` and the Style-by-result draft both call it; `RunFooter` STOPS calling `updateLayer(layerId, { colorBy: "rules" })`.

**Intent:** Three roadmap bullets with one owner: successive drafts get distinct colours; the map does not repaint until Save (`ensureRulesMode()` in `RulesEditor.tsx:158-165` becomes the only writer, keeping its existing "only from `surface`" behaviour); and a run that went stale or was undone while its median was in flight does not open the draft. The palette must extend `cityColors.test.ts`'s collision assertions (**[adapted copy A9]**). A reviewer rejects it for a colour that collides with a highlight, hover, base surface or preset, or for a second `colorBy` writer.

**The eight values (A9 — accepted, Decisions recorded item 3).** `#7cb518` first, unchanged, so nothing about a user's FIRST rule moves. The other seven are the `-700` rung of seven separated hues: dark enough to read as one family, and each chosen against three lists — `cityColors`' own chrome (highlight `#a7e32b`, hover `#cdf176`, the nine surface colours), the four existing presets (`#3b82f6`, `#f0a800`, `#f2683c`, `#7cb518`, `#ffc530`), and `CATEGORY_PALETTE_HEX`, because Design decision (i) is explicit that reusing the categorical eight "would make a rule and a category read as the same thing".

```
#7cb518  lime-700    (unchanged — NEW_RULE_COLOR_HEX)
#2563eb  blue-700
#c2410c  orange-700
#7e22ce  purple-700
#0f766e  teal-700
#be185d  pink-700
#b45309  amber-700
#15803d  green-700
```

- [ ] **Step 1: Write the failing test for `nextRuleColor`**

Create `tests/unit/features/rules/nextRuleColor.test.ts`:

```ts
/**
 * §6.2: a new rule's colour is "the next palette colour". Until this existed
 * every draft took `#7cb518`, so a second Style-by-result rule was invisible
 * against the first.
 */
import { describe, expect, it } from "vitest";
import type { Rule } from "../../../../src/features/rules/types";
import { nextRuleColor } from "../../../../src/features/rules/nextRuleColor";
import { RULE_PALETTE_HEX } from "../../../../src/scene/cityColors";

const rule = (color: string, enabled = true): Rule =>
  ({
    id: color,
    name: color,
    color,
    logic: "AND",
    conditions: [],
    enabled,
  }) as unknown as Rule;

describe("nextRuleColor", () => {
  it("hands the FIRST palette colour to a layer with no rules", () => {
    // Nothing about a user's first rule changes: `RULE_PALETTE_HEX[0]` IS
    // `NEW_RULE_COLOR_HEX`.
    expect(nextRuleColor([])).toBe(RULE_PALETTE_HEX[0]);
  });

  it("skips a colour an existing rule already wears", () => {
    expect(nextRuleColor([rule(RULE_PALETTE_HEX[0]!)])).toBe(
      RULE_PALETTE_HEX[1],
    );
    expect(
      nextRuleColor([rule(RULE_PALETTE_HEX[0]!), rule(RULE_PALETTE_HEX[1]!)]),
    ).toBe(RULE_PALETTE_HEX[2]);
  });

  it("ignores case, as every other colour comparison does", () => {
    expect(nextRuleColor([rule(RULE_PALETTE_HEX[0]!.toUpperCase())])).toBe(
      RULE_PALETTE_HEX[1],
    );
  });

  it("re-offers a colour only a DISABLED rule holds", () => {
    // A disabled rule paints nothing, so its colour is not taken.
    expect(nextRuleColor([rule(RULE_PALETTE_HEX[0]!, false)])).toBe(
      RULE_PALETTE_HEX[0],
    );
  });

  it("wraps by the rule COUNT once every colour is taken", () => {
    const all = RULE_PALETTE_HEX.map((hex) => rule(hex));
    expect(nextRuleColor(all)).toBe(RULE_PALETTE_HEX[0]);
    expect(nextRuleColor([...all, rule("#000000")])).toBe(RULE_PALETTE_HEX[1]);
  });

  it("ignores a colour that is not in the palette", () => {
    expect(nextRuleColor([rule("#123456")])).toBe(RULE_PALETTE_HEX[0]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/rules/nextRuleColor.test.ts
```

Expected: FAIL — neither `RULE_PALETTE_HEX` nor the module exists.

- [ ] **Step 3: Add the palette and the rotation**

In `src/scene/cityColors.ts`, directly under `NEW_RULE_COLOR_HEX`:

```ts
/**
 * The colours successive rules take (spec §6.2, "the colour is the next palette
 * colour"). **[adapted copy A9]** — §6.2 names a palette that did not exist.
 *
 * It BEGINS with {@link NEW_RULE_COLOR_HEX}, so nothing about a user's first
 * rule changes. The other seven are the `-700` rung of seven separated hues,
 * each checked against three lists by `tests/unit/scene/cityColors.test.ts`:
 * this file's own chrome (the two interaction accents and the nine surface
 * colours), because a rule equal to the highlight makes a selected surface look
 * unselected; the four `RULE_PRESETS`, because a rotation that lands on a preset
 * makes two different rules indistinguishable; and
 * {@link CATEGORY_PALETTE_HEX}, because that is the vector layers' CATEGORICAL
 * scale and a rule wearing a category's colour reads as a category (Design
 * decision (i)).
 *
 * It is a RULE palette, so — unlike the four constants below — its members may
 * and do coincide with a rule preset at index 0; what they may never coincide
 * with is the chrome.
 */
export const RULE_PALETTE_HEX: readonly string[] = [
  NEW_RULE_COLOR_HEX, // lime-700
  "#2563eb", // blue-700
  "#c2410c", // orange-700
  "#7e22ce", // purple-700
  "#0f766e", // teal-700
  "#be185d", // pink-700
  "#b45309", // amber-700
  "#15803d", // green-700
];
```

Create `src/features/rules/nextRuleColor.ts`:

```ts
/**
 * Which colour the NEXT rule on a layer opens with (spec §6.2).
 *
 * Under `features/rules/` rather than in `cityColors.ts` because it is a
 * DECISION about a layer's rules, and `cityColors` is the brand's values; and
 * not in `RulesEditor` because Style by result needs the same answer without
 * the editor being mounted — two callers, one rotation, or the second rule a
 * result card drafts is the same colour as the first.
 */
import type { Rule } from "./types";
import { RULE_PALETTE_HEX } from "../../scene/cityColors";

export function nextRuleColor(rules: ReadonlyArray<Rule>): string {
  // ENABLED rules only: a disabled rule paints nothing, so its colour is not
  // taken and re-offering it is the right answer rather than a collision.
  const taken = new Set(
    rules
      .filter((rule) => rule.enabled !== false)
      .map((rule) => rule.color.toLowerCase()),
  );
  const free = RULE_PALETTE_HEX.find((hex) => !taken.has(hex.toLowerCase()));
  // Every palette colour is in use, so the rotation restarts by COUNT — eight
  // rules in, the ninth wears the first colour again. Two rules sharing a
  // colour is a legible state (the legend names them); a ninth rule with no
  // colour at all is not.
  return free ?? RULE_PALETTE_HEX[rules.length % RULE_PALETTE_HEX.length]!;
}
```

- [ ] **Step 4: Extend the collision test**

Add to `tests/unit/scene/cityColors.test.ts`:

```ts
describe("the rule palette", () => {
  it("begins with the new-rule default, so a first rule is unchanged", () => {
    expect(RULE_PALETTE_HEX[0]).toBe(NEW_RULE_COLOR_HEX);
  });

  it("never collides with the chrome — highlight, hover or a base surface", () => {
    // The hard rule this file exists for: a rule colour equal to the highlight
    // makes a selected ruled surface look unselected.
    const reserved = new Set(CHROME.map(([, hex]) => lower(hex)));
    for (const hex of RULE_PALETTE_HEX) {
      expect([hex, reserved.has(lower(hex))]).toEqual([hex, false]);
    }
  });

  it("never collides with the categorical scale", () => {
    // Design decision (i): a rule wearing a CATEGORY's colour reads as a
    // category.
    const categories = new Set(CATEGORY_PALETTE_HEX.map(lower));
    for (const hex of RULE_PALETTE_HEX) {
      expect([hex, categories.has(lower(hex))]).toEqual([hex, false]);
    }
  });

  it("is eight DISTINCT `#rrggbb` values", () => {
    expect(RULE_PALETTE_HEX).toHaveLength(8);
    expect(new Set(RULE_PALETTE_HEX.map(lower)).size).toBe(8);
    for (const hex of RULE_PALETTE_HEX) {
      expect([hex, /^#[0-9a-f]{6}$/i.test(hex)]).toEqual([hex, true]);
    }
  });

  it("touches a preset at index 0 only — that IS the new-rule default", () => {
    // Unlike the four `colorBy` constants above, these ARE rule colours, so
    // coinciding with a preset is not a collision in the same sense. Pinned so
    // a future palette edit is a deliberate one.
    const presets = new Set(RULE_PRESETS.map((p) => lower(p.create().color)));
    const hits = RULE_PALETTE_HEX.filter((hex) => presets.has(lower(hex)));
    expect(hits).toEqual([NEW_RULE_COLOR_HEX]);
  });
});
```

with `RULE_PALETTE_HEX` added to the file's import from `cityColors`.

- [ ] **Step 5: Run them and watch them pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/rules/nextRuleColor.test.ts tests/unit/scene/cityColors.test.ts
```

Expected: PASS. A failing collision case means the proposed hex is wrong, not the rule — pick another and say which in the review note.

- [ ] **Step 6: Write the failing test for the two `RunFooter` fixes**

Add to `tests/unit/ui/processing/styleByResult.test.tsx` (Task 9's file). Its helpers are `addLayer()` (which returns the id and seeds a ready table) and `doneRun(over)` (a `measure-solids` record whose Style by result picks `solid_volume_m3` at the median), and its cases render `<RunFooter>` inline — there is no `cardFor`, so these do the same. One new local helper, because two cases need to hold the median query open:

```tsx
/**
 * Hold the median query until the case releases it.
 *
 * `runQuery` is this suite's own module-level mock, so the gate replaces its
 * implementation for the length of one case; the `afterEach` above already
 * puts the default back.
 */
function deferMedian(): { release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  runQuery.mockImplementation(async () => {
    await gate;
    return {
      ok: true as const,
      columns: ["m"],
      rows: [{ m: 4.2 } as Record<string, unknown>],
    };
  });
  return { release };
}

it("does NOT set Color by = Rules when it opens the draft (§6.2)", async () => {
  // "The map does NOT change until the user presses Save in the editor, as
  // with any rule." The eager `updateLayer(layerId, { colorBy: "rules" })`
  // repainted a layer on Surface type to the UNMATCHED colour before the user
  // had seen the draft. `ensureRulesMode()` at Save is the one writer.
  const id = addLayer();
  useLayerStore.getState().updateLayer(id, { colorBy: "surface" });
  render(
    <RunFooter
      run={seed(doneRun({ targetLayerId: id }))}
      canRun
      reason={null}
      onRunAgain={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
  await waitFor(() =>
    expect(useRuleDraftStore.getState().drafts[id]?.open).toBe(true),
  );
  expect(
    useLayerStore.getState().layers.find((l) => l.id === id)?.colorBy,
  ).toBe("surface");
});

it("gives the draft the NEXT palette colour, not always the first", async () => {
  const id = addLayer();
  useLayerStore.getState().addRule(id, {
    id: "r0",
    name: "existing",
    color: RULE_PALETTE_HEX[0]!,
    logic: "AND",
    conditions: [],
    enabled: true,
  } as unknown as Rule);
  render(
    <RunFooter
      run={seed(doneRun({ targetLayerId: id }))}
      canRun
      reason={null}
      onRunAgain={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
  await waitFor(() =>
    expect(useRuleDraftStore.getState().drafts[id]?.form.color).toBe(
      RULE_PALETTE_HEX[1],
    ),
  );
});

it("opens NOTHING for a run that went stale while the median was in flight", async () => {
  // The existing guards check the token and the layer; the RUN could still
  // be retired under them (a streaming rebuild, or an Undo).
  const id = addLayer();
  const run = doneRun({ targetLayerId: id });
  useProcessingStore.getState().upsertRun(run);
  const median = deferMedian();
  render(<RunFooter run={run} canRun reason={null} onRunAgain={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
  useProcessingStore.getState().patchRun(run.id, { stale: true });
  median.release();
  // One turn for the query's continuation and the render it would cause.
  await act(async () => {});
  expect(useRuleDraftStore.getState().drafts[id]).toBeUndefined();
});

it("opens NOTHING for a run that was undone while the median was in flight", async () => {
  const id = addLayer();
  const run = doneRun({ targetLayerId: id });
  useProcessingStore.getState().upsertRun(run);
  const median = deferMedian();
  render(<RunFooter run={run} canRun reason={null} onRunAgain={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
  useProcessingStore.getState().patchRun(run.id, {
    undoable: false,
    note: "Undone",
  });
  median.release();
  await act(async () => {});
  expect(useRuleDraftStore.getState().drafts[id]).toBeUndefined();
});
```

The suite's imports gain `act` from `@testing-library/react`, `RULE_PALETTE_HEX` from `src/scene/cityColors`, the `Rule` type from `src/features/rules/types`, and `useProcessingStore` from `src/features/processing/processingStore` (a dynamic `await import`, like its other store imports, so it resolves after the `vi.mock` factories). Its `afterEach` gains `useProcessingStore.getState().resetForTest();` — a run left in the history would leak into the two retirement cases.

- [ ] **Step 7: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/processing/styleByResult.test.tsx
```

Expected: FAIL — `colorBy` reads `"rules"`, the draft's colour is `#7cb518`, and both late-retirement cases open a draft.

- [ ] **Step 8: Fix the three in `RunFooter.tsx`**

1. The eager `colorBy` write goes. Find:

```ts
useLayerStore.getState().updateLayer(layerId, { colorBy: "rules" });
// Last, so the panel opens on a draft that is already written.
useShellStore.getState().requestSection(layerId, "style");
```

and replace with:

```ts
// §6.2: "The map does NOT change until the user presses Save in the
// editor, as with any rule." `ensureRulesMode()` inside the editor
// (`RulesEditor.tsx`) is the ONE writer of `colorBy` for a rule, and it
// runs at Save — so nothing here touches it. Setting it eagerly
// repainted a layer on Surface type to the unmatched colour before the
// user had seen the draft.
//
// Last, so the panel opens on a draft that is already written.
useShellStore.getState().requestSection(layerId, "style");
```

and drop the now-unused `useLayerStore` import only if nothing else in the file uses it — the `alive` check does, so it stays.

2. The palette. Find:

```ts
            name: column,
            color: NEW_RULE_COLOR_HEX,
```

and replace with:

```ts
            name: column,
            // §6.2's "the next palette colour": a second Style-by-result draft
            // on the same layer is invisible against the first if both take
            // `RULE_PALETTE_HEX[0]`.
            color: nextRuleColor(
              useLayerStore.getState().layers.find((l) => l.id === layerId)
                ?.rules ?? [],
            ),
```

with `import { nextRuleColor } from "../../features/rules/nextRuleColor";` replacing the `NEW_RULE_COLOR_HEX` import (which becomes unused here).

3. The late-retirement guard, beside the existing `alive` check. Find:

```ts
const alive = useLayerStore.getState().layers.some((l) => l.id === layerId);
if (!alive) return;
```

and insert under it:

```ts
// The RUN can be retired while its median is in flight: a streaming
// rebuild marks it stale (§7) and an Undo takes its values back. Both
// leave the card unable to describe the table a median would be read
// from, so the draft is not opened at all — the same silence the
// removed-layer case takes, and for the same reason.
const current = runById(run.id);
if (current === null || current.stale || current.note === "Undone") {
  return;
}
```

with `import { runById } from "../../features/processing/processingStore";` added (the module is already imported for `useProcessingStore`, so extend that import rather than adding a second line).

- [ ] **Step 9: Rotate the editor's own "+ Add rule" too**

In `src/ui/layers/RulesEditor.tsx`, find:

```ts
/** The "+ Add rule" form's starting values. */
function defaultRuleFormValues(): RuleFormValues {
  return {
    name: "",
    color: NEW_RULE_COLOR_HEX,
    logic: "AND",
    conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
  };
}
```

and replace with:

```ts
/**
 * The "+ Add rule" form's starting values.
 *
 * §6.2's "the next palette colour" is not a result-card rule: a user adding a
 * third rule by hand has exactly the same problem, and the editor and the card
 * must not disagree about which colour is next.
 */
function defaultRuleFormValues(rules: ReadonlyArray<Rule>): RuleFormValues {
  return {
    name: "",
    color: nextRuleColor(rules),
    logic: "AND",
    conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
  };
}
```

and its one call site is `openAddForm`, whose `useCallback` deps are `[layerId, setDraft]` (`RulesEditor.tsx:241-247`). It must NOT close over `layer.rules`: the callback is memoised on those two deps, so a Save followed by "+ Add rule" would hand the rotation the rule list as it was when the callback was made — and the second manual rule would take the first one's colour, which is the bug this task is fixing. Read the CURRENT rules at click time instead, exactly as `handleReorder` two callbacks above already does (`:229-239`). Find:

```ts
const openAddForm = useCallback(() => {
  setDraft(layerId, {
    editingId: null,
    open: true,
    form: defaultRuleFormValues(),
  });
}, [layerId, setDraft]);
```

and replace with:

```ts
const openAddForm = useCallback(() => {
  // The store, not `layer.rules`: this callback is memoised on
  // `[layerId, setDraft]`, and a captured rule list would be the list as it
  // was when the callback was built — so the rule added right after a Save
  // would rotate from a palette that has not heard about the saved one. The
  // same read `handleReorder` makes, for the same reason.
  const rules =
    useLayerStore.getState().layers.find((l) => l.id === layerId)?.rules ?? [];
  setDraft(layerId, {
    editingId: null,
    open: true,
    form: defaultRuleFormValues(rules),
  });
}, [layerId, setDraft]);
```

Replace the now-unused `NEW_RULE_COLOR_HEX` import with `nextRuleColor`; `useLayerStore` is already imported in this file.

Add the regression to `tests/unit/ui/layers/RulesEditor.test.tsx`, beside its existing "+ Add rule" cases:

```tsx
it("rotates the palette across consecutive Save → Add rule", () => {
  // The memoised-callback bug: the second draft must not reuse the colour the
  // rule just saved is wearing.
  renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "+ Add rule" }));
  expect(colorInput().value).toBe(RULE_PALETTE_HEX[0]);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "+ Add rule" }));
  expect(colorInput().value).toBe(RULE_PALETTE_HEX[1]);
});
```

using that suite's own render helper and its colour-input accessor (read the file for their names; it already drives the add form end to end).

- [ ] **Step 10: Run everything and commit**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/processing tests/unit/ui/layers tests/unit/features/rules tests/unit/scene
npx tsc -b --noEmit
npx vp check
npx vitest run > /tmp/m3-task26.log 2>&1 &
wait $!; echo "suite: $?"
```

Expected: PASS throughout; `suite: 0`.

```bash
git add src/features/rules/nextRuleColor.ts src/scene/cityColors.ts \
  src/ui/layers/RulesEditor.tsx src/ui/processing/RunFooter.tsx tests/
git commit -m "fix: rule drafts rotate the palette and no longer repaint before Save"
```
