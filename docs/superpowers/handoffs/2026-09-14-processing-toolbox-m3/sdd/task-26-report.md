# Task 26 — Palette rotation, and `Color by = Rules` at Save

**Status:** done. Two commits on `develop`: `265c78f` (palette + rotation), `19cfad4` (Save-time mode switch, draft visibility, retirement guard).

## Implemented

1. **`RULE_PALETTE_HEX`** in `src/scene/cityColors.ts`, directly under `NEW_RULE_COLOR_HEX`, with the approved eight values (`#7cb518` first, unchanged, then `#2563eb #c2410c #7e22ce #0f766e #be185d #b45309 #15803d`).
2. **`nextRuleColor(rules)`** — new module `src/features/rules/nextRuleColor.ts`. First palette colour no ENABLED rule wears (case-insensitive), else `RULE_PALETTE_HEX[rules.length % 8]`.
3. **`RunFooter`** (`src/ui/processing/RunFooter.tsx`):
   - no longer writes `updateLayer(layerId, { colorBy: "rules" })` when the draft opens;
   - the draft's colour is `nextRuleColor(<the layer's CURRENT rules>)`, read from the store at that moment;
   - the draft carries `origin: "style-by-result"`;
   - the post-await retirement guard gains `current.note === "Undone"` beside the existing `stale` / `status !== "done"` checks.
4. **`RuleDraft.origin?: "style-by-result"`** in `src/features/rules/ruleDraftStore.ts` (session-only, like the rest of that store).
5. **`RulesEditor`** (`src/ui/layers/RulesEditor.tsx`):
   - `defaultRuleFormValues(rules)` calls `nextRuleColor`;
   - `openAddForm` reads the CURRENT rules from `useLayerStore.getState()` at click time (the `moveRule`/`handleReorder` pattern), so consecutive Save → Add rule rotates;
   - `handleFormSave`'s new-rule branch: `draft.origin === "style-by-result"` → `updateLayer(layerId, { colorBy: "rules" })` unconditionally; otherwise the unchanged `ensureRulesMode()` (surface-only).
6. **`StyleSection`** (`src/ui/layers/StyleSection.tsx`) — **deviation from the brief's file list, see below**: the `RulesEditor` gate is now `colorBy === "rules" || draftOpen`, where `draftOpen` is a subscription to `useRuleDraftStore`.

## The one deviation from the brief (requirements win)

`StyleSection.tsx:184` rendered `RulesEditor` **only** when `colorBy === "rules"`. The brief removes the eager `colorBy` write but never touches that gate, so as written the feature would be dead: "Style by result" would open the Style section of a `surface`/`single` layer on the Surface palette or the single-colour swatch, with the draft written into the store and **no way to see or save it**. Requirements 1 and 5 together (the draft must survive until a Save that flips the mode) force the editor to be reachable pre-Save, so I widened the gate on `open === true` — Cancel clears the draft and the gate closes again. The mode's own body (`SurfaceTypePalette` / the single-colour swatch) still renders above it; hiding it is a design call I did not make. Pinned by two new `StyleSection.test.tsx` cases plus one that keeps the editor hidden with no draft.

Other brief-vs-code corrections, all resolved in favour of the code:

- The editor's Save button for a NEW rule is labelled **"Add"**, not "Save" (`saveLabel="Add"`, `RulesEditor.tsx:430`). The brief's snippets say "Save".
- `styleByResult.test.tsx` already imports `useProcessingStore` and already calls `resetForTest()` in its `afterEach`; the brief says to add both.
- No `renderEditor()` / `colorInput()` helpers exist in `RulesEditor.test.tsx` (round-2 finding 7 is correct) — I defined both, plus `nameIt()`, locally in the new describe.
- The brief's Step 8.3 guard **replaces** `status !== "done"` with `note === "Undone"`. I kept both: `undoRun` patches `{ undoable: false, note: "Undone" }` and leaves `status: "done"` (`runQueue.ts:1980, 2034, 2104`), so the note is the only signal, but dropping the status check would have been a silent regression.
- The brief's palette prose names "the four existing presets" and then lists five hexes. I let the collision test rule instead of the prose; `RULE_PRESETS` has four entries and index 0 is the only palette/preset overlap.
- Round-1 finding 10 (`openAddForm` reads the rules at click time) IS carried by the brief (Step 9) — verified, and implemented that way.
- `tests/unit/ui/processing/ToolView.test.tsx` had to change: its "opens STYLE on a rule DRAFT" case asserted the eager `colorBy === "rules"` and the exact draft object. It now asserts `colorBy === "surface"` (unchanged mode) and the draft's new `origin` field. This is the only pre-existing expectation the behaviour change invalidated — a repo-wide grep for `colorBy).toBe("rules")` found no other.

## TDD evidence

**RED 1** (`npx vitest run tests/unit/features/rules/nextRuleColor.test.ts tests/unit/scene/cityColors.test.ts`):

```
Test Files  2 failed (2)
     Tests  6 failed | 7 passed (13)
AssertionError: Target cannot be null or undefined.  (RULE_PALETTE_HEX undefined)
```

**GREEN 1** after adding the palette + `nextRuleColor.ts`: `Test Files 2 passed (2) / Tests 19 passed (19)`.

**RED 2** (`npx vitest run tests/unit/ui/processing/styleByResult.test.tsx`) — 5 of the 6 new cases red:

```
× does NOT set Color by = Rules on a surface layer when it opens the draft (§6.2)
× does NOT set Color by = Rules on a single layer when it opens the draft (§6.2)
× marks the draft as a Style-by-result one, so Save knows to flip the mode
× gives the draft the NEXT palette colour, not always the first
× opens NOTHING for a run that was undone while the median was in flight
     Tests  5 failed | 13 passed (18)
```

Honest note: **the in-flight STALE case was green from the start** — Task 9's `runById` guard already covers `stale`. It is kept as a regression pin (requirement 5 says "extend rather than duplicate"), and it is the _undone_ half that was the real hole, because an Undo leaves `status: "done"`.

**GREEN 2** after the `RunFooter` + `RuleDraft.origin` changes: `Tests 18 passed (18)`.

**RED 3** (`npx vitest run tests/unit/ui/layers/RulesEditor.test.tsx`):

```
× rotates the palette across consecutive Save → Add rule
× flips a single layer to `rules` when a STYLE-BY-RESULT draft is saved
     Tests  2 failed | 36 passed (38)
```

(The `surface` cells of the matrix and the disabled-rule case were already green — they are the behaviour that must NOT change.)

**RED 4** (`npx vitest run tests/unit/ui/layers/StyleSection.test.tsx`):

```
× shows the editor over a surface layer, so the draft can be seen and saved
× shows the editor over a single layer, so the draft can be seen and saved
     Tests  2 failed | 26 passed (28)
```

**GREEN 3+4** after the `RulesEditor` + `StyleSection` changes, over all four touched areas
(`npx vitest run tests/unit/ui/layers tests/unit/ui/processing tests/unit/features/rules tests/unit/scene`):
`Test Files 66 passed (66) / Tests 1055 passed (1055)`.

## Verification

| Gate                                          | Result                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npx tsc -b --noEmit`                         | clean (exit 0)                                                                                           |
| `npx vp check`                                | **0 errors, 56 warnings in 590 files** — baseline held (formatting fixed with `--fix` on two test files) |
| Full app suite, backgrounded with `& wait $!` | `suite: 0` — `Test Files 281 passed \| 4 skipped (285)`, `Tests 3730 passed \| 97 skipped (3827)`        |

## Files changed

- `src/scene/cityColors.ts` — `RULE_PALETTE_HEX`.
- `src/features/rules/nextRuleColor.ts` — new.
- `src/features/rules/ruleDraftStore.ts` — `RuleDraft.origin`.
- `src/ui/processing/RunFooter.tsx` — no eager `colorBy`, rotation, `origin`, `note === "Undone"` guard.
- `src/ui/layers/RulesEditor.tsx` — rotation, click-time rules read, origin-aware Save.
- `src/ui/layers/StyleSection.tsx` — the editor gate also opens for an open draft.
- `tests/unit/features/rules/nextRuleColor.test.ts` — new (6 cases).
- `tests/unit/scene/cityColors.test.ts` — `describe("the rule palette")`, 6 cases.
- `tests/unit/ui/processing/styleByResult.test.tsx` — `describe("Style by result, at the moment it opens the draft")`, 6 cases + `deferMedian()`.
- `tests/unit/ui/layers/RulesEditor.test.tsx` — rotation describe (2 cases, `renderEditor`/`colorInput`/`nameIt`) + C6 describe (3 cases).
- `tests/unit/ui/layers/StyleSection.test.tsx` — draft-visibility describe (3 cases).
- `tests/unit/ui/processing/ToolView.test.tsx` — the one invalidated expectation.

## How each controller requirement was met

1. **C6 ruling.** `RuleDraft.origin?: "style-by-result"`, written by `RunFooter`, read by `handleFormSave`. Tested from BOTH modes for BOTH origins: style-by-result × {surface, single} → `rules` (`RulesEditor.test.tsx`, `it.each`); manual × surface → `rules` (pre-existing case, still green); manual × single → stays `single` (new case). `RunFooter` also pins that the flag is written.
2. **Round-1 C10.** `openAddForm` reads `useLayerStore.getState()` at click time; `[layerId, setDraft]` deps unchanged. Regression: "rotates the palette across consecutive Save → Add rule" — Add → `#7cb518`, name, Add(save), + Add rule → `#2563eb`, and the saved pair's colours are asserted.
3. **C7.** Every new test is runnable as committed: `renderEditor()`, `colorInput()` and `nameIt()` are defined; the rule is named before every Save; `act` is imported in `styleByResult.test.tsx`, `useRuleDraftStore` and `NEW_RULE_COLOR_HEX` in `StyleSection.test.tsx`; `deferMedian` reuses the suite's own `MEDIAN_ROWS` so the `afterEach` restore still applies. All four suites were executed, not just written.
4. **Palette values + collision rule.** The approved eight, in order. `cityColors.test.ts` now pins: begins with `NEW_RULE_COLOR_HEX`; no member equals the highlight, hover or any of the nine base surface colours; none equals `DEFAULT_GEO_LAYER_STYLE.color`; none equals a `CATEGORY_PALETTE_HEX` entry or `CATEGORY_OTHER_HEX`; eight distinct `#rrggbb`; index 0 is the ONLY preset overlap.
5. **The map does not change before Save.** `it.each(["surface","single"])` in `styleByResult.test.tsx` asserts `colorBy` is untouched at draft open; `ToolView.test.tsx` asserts the same end to end; the Save flip is asserted in `RulesEditor.test.tsx`. Stale/undone-in-flight: extended Task 9's `runById` guard rather than duplicating it — `deferMedian()` holds the median open, the run is retired mid-flight, and no draft appears.
6. **Mocks and the suite.** No `vi.mock(".../insights/duckdb")` factory needed a new export (the modules under test import nothing new from it); `styleByResult.test.tsx`'s factory was left untouched. The full suite ran backgrounded with `& wait $!; echo "suite: $?"` → `suite: 0`.

## Self-review / concerns

- **StyleSection is the deviation to look at first.** It is outside the brief's file list, and a reviewer should confirm the widened gate is the right shape (vs., say, hiding the mode's own body while a draft is open, or auto-clearing a draft when the user changes mode by hand). A draft left open on a `surface` layer keeps the editor on screen until the user saves or cancels it — intended, but visible.
- **`styleGeoLayerByAttribute`'s guard was left alone.** It still tests `stale` / `status !== "done"` and not `note === "Undone"`. That path has no await, so there is no in-flight window, but a card sitting on an undone Aggregate run can still colour the vector layer. Out of this task's scope; flagged.
- **`nextRuleColor` ignores the synthetic catch-all/unmatched rules** because those are derived (`effectiveRules`) and never live in `layer.rules`; if that ever changes, the unmatched grey could be "taken".
- **Wrap-by-count is by total rule count, not enabled count** — exactly as the plan specifies; with 8 enabled rules plus disabled ones the ninth colour is `RULE_PALETTE_HEX[n % 8]`, which can repeat a colour that is only skipped-because-disabled. Deliberate (that state is already "two rules share a colour"), pinned by the wrap test.
- Nothing persisted: `origin` lives in the session-only draft store; snapshot v4 is untouched.

## Addendum

Third commit `ca4cb79` (`docs:`) corrects `useStyleByResult`'s header comment, which still claimed the hook opens the section "with Color by = Rules" — it now names the editor's Save as the one `colorBy` writer. `npx vp check` re-run after it: 0 errors / 56 warnings. Working tree clean apart from the pre-existing untracked `.github/hooks/` and `docs/design-history/`.
