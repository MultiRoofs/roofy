# Task 14 (implementer side): milestone gate — verification, probes, smoke, docs

Branch `develop`, base `902b1e2`. Five commits added, nothing pushed.

| commit    | subject                                                              |
| --------- | -------------------------------------------------------------------- |
| `8ef02cd` | test: probe the computed-column write-back against real DuckDB 1.5.5 |
| `dd7560c` | docs: record the milestone 13.1 browser smoke of scenario 1          |
| `1491fc7` | docs: the processing toolbox seam and milestone 13.1's status        |
| `d65a956` | test: pin the probes' answers instead of only recording them         |
| `95256ec` | docs: label the smoke's two deviations as deviations, not passes     |

Five commits, not three: the last two came out of the final review pass.

No trailers on any of them. `.github/hooks/` and `docs/design-history/` were
left untracked and untouched. Hooks ran as configured on every commit
(`vp staged` → `vp check --fix`); none were bypassed.

---

## Part A — Full verification

Run at base `902b1e2` (before the probe file), each in the background with
output redirected.

| command                                                 | result                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npx vp check`                                          | **0 errors, 56 warnings in 508 files** (3.5 s) — the baseline, unchanged                |
| `npx tsc -b --noEmit`                                   | **exit 0**, no output                                                                   |
| `npx vitest run` (app)                                  | **232 files passed, 1 skipped (233)**; **2801 tests passed, 20 skipped (2821)**, 62.6 s |
| `cd packages/cityjson-navara-plugins && pnpm typecheck` | **exit 0** (`tsc -b`)                                                                   |
| `… && pnpm vitest run`                                  | **61 files passed (61)**; **837 tests passed, 1 skipped (838)**, 6.1 s                  |

Re-run after the probe file landed:

| command          | result                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vp check`   | formatting fixed on the new file via `vp check --fix <file>`; the commit hook then passed it clean                                                        |
| `npx vitest run` | **232 files passed, 2 skipped (234)**; **2801 passed, 29 skipped (2830)** — the new file collects and skips offline exactly as `layerTables.test.ts` does |

**Final re-verification**, run after the `npm install` described under Part C
and after `cd packages/cityjson-navara-plugins && pnpm install` (CLAUDE.md's
rule: pnpm install is required again after ANY app-side npm install). The four
`@cityjson/*` `file:` symlinks under `node_modules/` were confirmed intact
first, and both working trees stayed clean (no lockfile moved).

| command                                                        | result                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npx vp check`                                                 | **0 errors, 56 warnings in 509 files** — 509, not 508, because of the new probe file |
| `npx tsc -b --noEmit`                                          | **exit 0**                                                                           |
| `npx vitest run` (app)                                         | **232 passed, 2 skipped (234 files)**; **2801 passed, 29 skipped (2830)**            |
| `pnpm typecheck`                                               | **exit 0**                                                                           |
| `pnpm vitest run`                                              | **61 files passed**; **837 passed, 1 skipped (838)**                                 |
| `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` | **2 files, 29 tests passed**                                                         |

The only warnings are the 56 pre-existing `no-floating-promises` ones in test
files. Not touched.

---

## Part B — Three probes against real DuckDB 1.5.5

New file `tests/integration/duckdb/computedColumns.test.ts`, driving the app's
own builders (`buildAddColumnSql`, `buildBackupSql`, `buildUpdateFromValuesSql`,
`buildRestoreSql`, `buildNullifySql` from `src/insights/computedColumns.ts`;
`buildCountSql` / `buildPageSql` from `src/insights/sql.ts`) through the
`Harness` connection API, with `layerTables.test.ts`'s throwing
`vi.mock("…/insights/duckdb")` so the offline run can collect it safely.

`DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` →
**2 files passed, 29 tests passed**, 5.8 s (engine + cityjson extension ready in
~2.3 s). `layerTables.test.ts` is unchanged and still green.

**No probe forced a change to `src/`.** `writeComputedColumns` stands as
written.

### Probe 1 — DDL inside the write transaction: ACCEPTED

`BEGIN TRANSACTION` → three `ALTER TABLE … ADD COLUMN IF NOT EXISTS … DOUBLE` →
`UPDATE … FROM read_json_auto('__vals_p1.json') AS v WHERE t."id" = v."id"` →
`COMMIT` — every statement succeeded, no message. The columns describe as
`DOUBLE` and the values land (`b1` 7.5, `b2` 3.25).

Second pass with `existing` non-empty, which is the app's backup path:
`BEGIN` → `CREATE TABLE "__undo_p1b" AS SELECT "id", … FROM … WHERE "id" IN
('b1')` → the ALTERs (no-ops through `IF NOT EXISTS`) → `UPDATE` → `COMMIT`.
Also accepted. The Undo half — `buildRestoreSql` from the backup, `DROP TABLE
IF EXISTS`, then `ALTER … DROP COLUMN IF EXISTS` plus `buildNullifySql`, all
inside one transaction — is likewise accepted, and the restored values are the
first run's.

The Task 8 fallback ruling (move the ALTERs outside the transaction) therefore
does **not** apply.

### Probe 2 — `read_json_auto` inference: every case ACCEPTED

Recorded by `DESCRIBE SELECT * FROM read_json_auto(<file>)` before the write,
then by assigning the file into a `DOUBLE` column. Default sample size 20,480.

| case                                                                          | inferred type | assigning into DOUBLE                                                     |
| ----------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| all-NULL column, 2 rows                                                       | **`JSON`**    | accepted; NULLs land                                                      |
| all-NULL column, 20,481 rows                                                  | **`JSON`**    | accepted; NULLs land                                                      |
| NULL for the whole 20,480 sample, `12.5` at row 20,481                        | **`JSON`**    | accepted; the late `12.5` lands                                           |
| BigInt stringified by the replacer, 2 rows (`"12345678901234567890"`, `"42"`) | **`VARCHAR`** | accepted; stored as `12345678901234567000`                                |
| 20,480 numeric rows + one such string at row 20,481                           | **`DOUBLE`**  | accepted; in-sample `1.5`, out-of-sample stored as `12345678901234567000` |
| whole numbers (`12`, `7`)                                                     | **`BIGINT`**  | accepted; stored as `12`                                                  |

No refusal and therefore **no DuckDB error message to quote for this probe**.
The one thing that is not free: the BigInt path casts implicitly and silently
rounds to the double's precision (`…567890` → `…567000`). That value could not
be held by a `DOUBLE` column anyway, so it is a property of the column type, not
of the replacer — but it is now written down.

The sample-size straddle is the useful negative result: the all-NULL case does
**not** flip type when a value appears past the sample (`JSON` absorbs it), so
a tool whose first 20,480 features have no value is safe.

### Probe 3 — reads inside the open write transaction: ACCEPTED

`BEGIN` → `ALTER … ADD COLUMN` → `UPDATE … FROM read_json_auto(…)`, then,
**before** `COMMIT`, the table panel's own two statements on the same
connection: `SELECT COUNT(*) AS "n" FROM "layer_cc3"` returned `3`, and
`buildPageSql(…, page 0, size 50)` returned all three rows with the
transaction's own writes visible (`b1` → `1.5`). `COMMIT` then succeeded and
the committed values are intact.

Honest wording, which the architecture note repeats: the node bindings are
blocking, so this is _interleaved statements inside the open transaction on one
connection_, not isolation between two connections. That is exactly the app's
shape — one DuckDB connection, no other `BEGIN` user in `src/`, runs serialised
on the table FIFO — so the probe proves "no interference", which is the claim
the Task 8 ruling accepted for M1.

---

## Part C — Browser smoke (spec §10 scenario 1)

Full record committed at `scripts/smoke/processing-m1.md`. Chrome/151.0.7922.34
headless with SwiftShader, driven by `agent-browser` over CDP on port 9333;
dev server `npm run dev -- --port 5199 --host 127.0.0.1`, which printed
`http://127.0.0.1:5200/`. Screenshots in
`…/scratchpad/smoke/` (`01-booted.png`, `12-table.png`,
`13-details-computed.png`, `14-before-style.png`, `15-style-draft.png`,
`21-style-draft.png`, `22-after-add.png`, `23-after-save.png`,
`24-after-undo.png`, `25-escape-setup.png`, `26-collapsed-pill.png`).

**7 of the 9 checks pass as the brief words them; 2 are DEVIATIONS that cannot
hold in 13.1.** In order:

1. **Tools after Mode** — PASS. `div.map-tool-header__editing` children are
   `label.map-mode-control`, `button.tools-button`, `div.address-search`.
2. **Catalogue** — **DEVIATION** (expected for 13.1). Seven rows in `ROOF` /
   `3D MEASUREMENTS` / `CROSS-LAYER` mono groups; only Height from extent has
   `aria-disabled="false"`. The other six, cross-layer included, read
   **"Not available yet"**, not "Add a vector layer to join with", because
   `toolEligibility` puts `!tool.implemented` first (eligibility.ts:44) and
   M13.1 registers one executor. The expected string is unit-tested at
   `tests/unit/features/processing/eligibility.test.ts:77`.
3. **Run** — PASS. Card: `✓ 2 buildings measured · 7.0 s` and
   `Wrote 3 columns to two-buildings.city.json.`; the toast repeats the first
   line verbatim. Verified that the "3 of these columns exist" warning is
   **absent before** the run and appears only after it.
4. **Table** — PASS. `EXTENT_HEIGHT_M`, `EXTENT_ZMIN_M`, `EXTENT_ZMAX_M`
   appended and visible by default, each with
   `span.computed-attribute-badge[title="Height from extent · All 2 buildings ·
2026-09-11 17:06"]`. Values 8.40 / 0 / 8.40 and 12.10 / 0 / 12.10, matching
   `measuredHeight`. The app's own derived columns keep the generic
   "Computed by Roofy" tooltip, so the two kinds are distinguishable.
5. **Details COMPUTED** — PASS. Table-row click → `Selected 1` → the right
   panel gains a `Details · …AG.Pand.0001` tab _without_ leaving Tools; that tab
   shows `Attributes` (the file's five) and `COMPUTED` with
   `extent_height_m 8.4`, `extent_zmin_m 0`, `extent_zmax_m 8.4`.
6. **Style by result** — PASS, with two observations. STYLE opens with
   `Color by = Rules` and a draft on `extent_height_m > 8.4`. (a) The map
   repaints to `Unmatched 4` _immediately_, 17.5 % of the pixels over the
   buildings — the ledger's accepted eager-`colorBy` ruling; the draft rule's
   own colour still waits. (b) `Add` does nothing while the Rule name is empty;
   with the name `Tall` the rule lists as `extent_height_m > 8.4`, the legend
   becomes `Tall 1 | Unmatched 3` and another 22.5 % of those pixels change.
   The threshold reads 8.4 rather than 10.25 because `median()` runs over the
   table's three rows and the executor gives every member row its feature's
   values (`heightFromExtent.ts:12`), so the column is `[8.4, 12.1, 8.4]` —
   correct per the spec's word, confirmed from source, worth knowing.
7. **Undo** — PASS. The three columns leave the table and the COMPUTED group
   leaves Details; the run row keeps `Log` and `Edit & run` and loses `Undo`.
   The `Tall` rule survives with `Tall 0 | Unmatched 4`.
8. **Escape order** — PASS, exactly: sheet → catalogue → selection cleared
   (and the Details tab disappears with it).
9. **Collapsed pill** — PASS for the pill, **DEVIATION** for reaching it: the pills read `Tools` and
   `Details · …AG.Pand.0001`. But the collapse chevron is
   `disabled={!hasSelection}` (`WorkspaceHeader.tsx:193`), so a toolbox-only
   session with nothing selected cannot collapse the panel at all.

**Not done:** the Delft sample as a secondary check. The headless Chromium
crashed once mid-run and the remaining budget went to finishing scenario 1 on
the two-buildings fixture. Recorded as not exercised in the smoke file rather
than claimed.

**Two environment facts worth carrying forward:**

- `node_modules` lacked `@fontsource/source-sans-3` (declared in both
  `package.json` and `package-lock.json`), so the dev server already running on
  5173 answered `/src/main.tsx` with a 500 and the app never mounted. Fixed with
  `npm install --no-save --no-package-lock @fontsource/source-sans-3@5.3.0`;
  `package-lock.json` verified unchanged (`git status` clean). The 5173 server
  caches the resolution failure, so a second server was started on 5200 and
  5173 was left running untouched, as instructed.
- The page full-reloaded four times unprompted over the session under
  SwiftShader — no page error, no vite reload message, no renderer-crash entry.
  Computed columns are session state, so each reset emptied them while the layer
  was restored from the autosaved workspace. Every assertion was re-taken after a
  reset and came back identical. This is the one trap for a future reader: a
  `duckdb_tables()` query taken after such a reset shows a rebuilt table with no
  `extent_*` columns and looks like a write-back bug.

---

## Part D — Docs

- **`docs/architecture-notes.md`** — one new section,
  "Processing toolbox seam (M13.1, 2026-09-11)": the shared table FIFO
  (`runOnTableQueue`) and why the scope is frozen at Run; the write-back
  transaction with its per-run `__undo_<runId>` backup table and the Undo that
  reads it; the merge into the model (`mergeAttributes`) pushed through the
  plugin's `setModel`, with the FCB limit named; the provenance registry outside
  `Layer` and why that keeps results out of snapshots; a "What real DuckDB 1.5.5
  actually does" subsection with the three probe outcomes verbatim (including
  the BigInt precision loss and the inferred types); the accepted concurrency
  argument in its honest wording; and the `--font-mono` ruling. Ends with a
  pointer to the smoke file.
- **`docs/roadmap.md`** — Milestone 13 now records 13.1 as implemented
  2026-09-11 with what shipped, and a short list carried to 13.2/M2: the
  streaming Details/rules gap, the six unimplemented tools shadowing the
  cross-layer reason, the eager `Color by = Rules` repaint (plus the rule-name
  requirement), no palette rotation, "Run again" dismissing rather than
  re-submitting, the elapsed-timer jump and `scopeCount 0`, the missing §6.1
  re-validation and the negative-height-on-corrupt-bbox decision, and the
  collapse chevron needing a selection.
- Handoff snapshot, plan and spec were **not** touched.

---

## Concerns for the controller

1. **The catalogue does not match scenario 1's wording** and cannot in M13.1
   (item 2 above). If the gate wants the scenario read literally, that is a
   milestone-13 completion criterion, not a 13.1 one. Recorded in both the
   smoke file and the roadmap rather than "fixed".
2. **`Style by result` is two clicks from a recolour, not one** — the draft is
   inert until the user names the rule. Not in any ledger ruling; worth a
   decision in 13.2 (default the name from the column, or let an unnamed rule
   save).
3. **The collapse chevron is disabled without a selection**, so the `Tools`
   pill that spec §4.2 describes is unreachable in a toolbox-only session. One
   predicate in `WorkspaceHeader.tsx`; left as found.
4. **The Delft secondary check was not run.** If the gate needs it, it is one
   more session on a stabler browser.
5. **`node_modules` drift**: the checkout as found could not boot the app
   (missing `@fontsource/source-sans-3`). The targeted install plus
   `pnpm install` in the submodule was done here and everything re-verified
   green at 509 files, but whoever picks this up next on a fresh machine should
   run a plain `npm install` then `pnpm install` before trusting a dev server.

---

## Left running

- The Chromium launched for the smoke was killed (port 9333 is closed).
- The dev server on **5173** (not started by this session) is still running and
  is still broken — it caches the `@fontsource/source-sans-3` resolution
  failure and answers `/src/main.tsx` with a 500. It needs a restart to pick up
  the now-installed package.
- The dev server this session started on **5200** is still running and works;
  kill it with `pkill -f "port 5199"` when it is no longer wanted.

---

## Addendum (original session, written after the resume)

The session that committed `8ef02cd` was not dead: it kept running, and these
three facts belong to it rather than to the resumed one.

- **The "Chromium crashed" at port 9333 was a kill, not a crash.** At ~16:58
  the original session ran `pkill -f remote-debugging-port=9333` — it had seen
  its page load a layer, open a table and run the tool with no command of its
  own (the shared `agent-browser` daemon was being driven from two sessions at
  once) and switched to a private CDP driver (`scripts/smoke/driver.mjs`,
  Chromium on 9407, driver on 9418). That kill is what cost the Delft check.
- **The whole primary scenario was reproduced independently on that private
  driver**, and every observed result matches `dd7560c..95256ec`. Steps after
  17:41 ran against fix-wave code arriving over HMR (`?t=1789141304247` sits
  between `ea5ed1c` 17:40:44 and `28abcb4` 17:42:22), so deviation (c) is
  already closed there: the collapse chevron went from `disabled` to enabled
  mid-run and the collapsed pill read exactly `Tools`.
- **The two `ReferenceError: useProcessingStore is not defined` catches in the
  console were react-refresh artifacts of that same hot update**, not an app
  bug: a clean reload afterwards logged 0 exceptions and only the known
  `THREE.WARNING: Multiple instances of Three.js` line.
