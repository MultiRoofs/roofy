### Task 13: Toast, Open table and Style by result wiring

**Files:**

- Modify: `src/app/App.tsx` (subscribe to `noticeSeq`), `src/ui/processing/RunFooter.tsx` (Style by result prefill), `src/features/layers/layerStore.ts` only if no draft-rule mechanism exists (see below)
- Test: `tests/unit/app/appProcessingToast.test.tsx`, extend `tests/unit/ui/processing/ToolView.test.tsx`

- [ ] **Step 1: Toast** — in `App.tsx`, inside the effect that installs listeners:

```ts
const unsubNotice = useProcessingStore.subscribe((s, prev) => {
  if (s.noticeSeq !== prev.noticeSeq && s.notice) showToast(s.notice);
});
```

where `showToast` is the existing function that sets the toast state and (re)arms `toastTimerRef` (find it by searching `setToast(` in App.tsx; if the logic is inline, extract `showToast(text)` first). Test: render `App` with the existing mocks (copy `appViewerShell.test.tsx`'s setup), call `useProcessingStore.getState().pushNotice("2 buildings measured · 0.3 s")` inside `act`, expect the text in the document.

- [ ] **Step 2: Style by result** — spec §6.2: open STYLE with Color by = Rules and the rule editor open on a DRAFT whose attribute is the first column the run wrote, operator `>`, value the column's median, next palette colour. Read how `RulesEditor` opens its inline editor and keeps per-layer drafts (spec §12.x "Drafts are kept per layer"; search `draft` in `RulesEditor.tsx`/`StyleSection.tsx`). If a store-level draft exists (e.g. `ruleDraftStore` or a `draft` field in `shellStore`), write `{ attribute, op: ">", value: median, color }` there and call `updateLayer(id, { colorBy: "rules" })` + `requestSection(id, "style")`. If no store-level draft exists, add `pendingRuleDraft: { layerId; attribute; op; value; color } | null` with `setPendingRuleDraft` to `shellStore` and make `RulesEditor` consume-and-clear it on mount/update (one `useEffect`). The median: `SELECT median("<col>") AS m FROM "<table>"` via `runQuery` at click time (a small async before navigating). Palette colour: the next unused entry of the rule preset palette (find the palette array `RulesEditor`/`presets.ts` use). The button is disabled with "All values are empty" when the run's `summary.measured === 0`.

Test: click **Style by result** on a done run → `layerStore` has `colorBy: "rules"`, `shellStore.requestedSection` is `{ layerId, section: "style" }`, and the pending draft (or the editor) holds `attribute: "extent_height_m"`, `op: ">"`.

- [ ] **Step 3: Run, tsc, browser** — the toast appears after a run; Style by result lands on STYLE with the editor open; Save recolours the map. **Step 4: Commit** `git commit -am "feat(processing): result toast and Style by result draft"`.

---
