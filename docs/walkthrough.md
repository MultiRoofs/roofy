# Delft walkthrough

The approved wireframe is in `design/walkthrough-wireframe.html`.
The app opens directly in the viewer. An empty workspace offers the Delft sample;
File, URL, Catalog and Draw remain in Add layer. Saved projects are available in
the workspace menu and Manage workspaces.

Issue: https://github.com/MultiRoofs/roofy/issues/16

The first visit offers an optional guided walkthrough. Dismissing or starting it
records a versioned seen flag in local storage. Preferences → Start walkthrough
replays it. Blocked storage does not prevent the guide from working.

The guide uses the real workspace. The dimmed background and spotlight do not
intercept pointer events. Back, Skip step and Close remain available; the loading
step requires a successfully loaded Delft layer before continuing. No existing
layer is removed. A previously loaded sample is reused by its source URL.

| Chapter | Exercise             | Continue becomes available                                         |
| ------- | -------------------- | ------------------------------------------------------------------ |
| 1       | Load Delft           | Sample layer is registered                                         |
| 2       | Pick and inspect     | A feature in the sample is selected; inspect its right panel       |
| 3       | Colour with rules    | Rules colour mode and an enabled rule                              |
| 4       | Filter and summarise | Applied condition, then Summary → Matching with results            |
| 5       | Measure solids       | A successful volume run for Delft, neither stale nor undone        |
| 6       | Join by location     | Informational for now; needs the forthcoming Delft 2D example      |
| 7       | Sun and shade        | Date/time changes while sun shadows are enabled                    |
| 8       | Export or Share      | The user opens either dialog; review and export/copy remain theirs |

`features/walkthrough` owns steps and lifecycle state. Persistence is injected
through `WalkthroughPersistence`; the default adapter stores only the seen flag,
not model data or tutorial actions. `ui/walkthrough` opens existing panels using
their public store actions and observes completion without running analysis or
changing rules, filters, or solar settings itself. The popover is a nonmodal
region with keyboard-accessible actions; application dialogs retain their own
focus traps and Escape behavior. A removed example layer offers reload recovery.

The join exercise deliberately does not fabricate a second layer. Once the Delft
2D dataset is supplied, replace that chapter's informational copy and completion
condition with sample loading, source selection, and a completed join run.

Validation: lifecycle and interaction tests cover first visit, replay, loading,
selection, applied filters, missing data, dialog dismissal, invalidated runs and
placement above the table. Browser verification exercises the actual Delft sample
and real controls. Summary grid rows retain their content height in a short drawer
so its All/Matching controls remain usable.
