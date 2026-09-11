### Task 14: Milestone gate — smoke, docs, Codex review

- [ ] **Step 1: Full verification** — `npx vp check && npx tsc -b --noEmit && npx vitest run` (app) and `cd packages/cityjson-navara-plugins && pnpm typecheck && pnpm vitest run` (plugins). All green.

- [ ] **Step 2: Browser smoke = spec §10 scenario 1** on `npm run dev` with `fixtures/two-buildings.city.json` (drop it) AND the Delft sample: Tools button after Mode; catalogue reasons (cross-layer rows disabled with "Add a vector layer to join with"); Height from extent → Run → two rows measured; three columns in the table with the badge; Details shows COMPUTED; a rule on `extent_height_m` recolours after Save; Undo removes the columns and the attributes; Escape order (sheet → form → selection); collapsed pills. Record the outcome in `scripts/smoke/processing-m1.md` (steps + observed results + date).

- [ ] **Step 3: Docs** — `docs/architecture-notes.md`: one entry on the processing seam (the shared table FIFO, the write-back transaction + backup table for Undo, computed attributes merged into the model and pushed with `setModel`, provenance registry outside `Layer`); `docs/roadmap.md` Milestone 13: mark 13.1 implemented with the date. Commit `docs:`.

- [ ] **Step 4: Codex review of the milestone diff**

```bash
S=/private/tmp/…/scratchpad   # the session scratchpad
{ echo "=== SPEC ==="; cat docs/superpowers/specs/2026-09-10-processing-toolbox-design.md; echo "=== DIFF since 0d787fb ==="; git diff 0d787fb..HEAD -- . ':!package-lock.json'; echo "=== SUBMODULE DIFF ==="; git -C packages/cityjson-navara-plugins diff <pinned-before>..HEAD; } > $S/m1-review-input.md
cd $S && codex exec -m gpt-6-astra --skip-git-repo-check -s read-only "Review the piped milestone diff against the piped spec (sections 4, 5, 6, 7 common rules, 7.4, 8 and acceptance scenario 1). Report correctness bugs, spec deviations, missing tests, and hard-rule violations from CLAUDE.md (duckdb.ts sole importer, one status writer, submodule-first). Number findings, tag CRITICAL/MAJOR/MINOR, give file:line and a concrete fix. Be terse." < m1-review-input.md > m1-review.md
```

Address every CRITICAL and MAJOR before declaring the milestone done; record MINORs left open in the roadmap entry.

- [ ] **Step 5: Push** — `git push origin develop` (and the submodule branch) after the findings are addressed.
