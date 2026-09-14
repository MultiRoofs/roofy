# Delft walkthrough

The approved wireframe is in `design/walkthrough-wireframe.html`.
The app opens directly in the viewer. An empty workspace offers the Delft sample;
File, URL, Catalog and Draw remain in Add layer. Saved projects are available in
the workspace menu and Manage workspaces.

Issue: https://github.com/MultiRoofs/roofy/issues/16

The first visit offers an optional guided walkthrough. Dismissing or starting it
records a versioned seen flag in local storage. The header’s ? button offers Start, Resume or Restart. Unfinished step progress
is remembered across visits; completion clears that progress. Closing the welcome
card or guide hides automatic prompts on future visits. Preferences also offers replay. Blocked storage does not prevent the guide from working.

The guide uses the real workspace. The dimmed background and spotlight do not
intercept pointer events. Back, Skip step and Close remain available; the loading
step requires a successfully loaded Delft layer before continuing. No existing
layer is removed. A previously loaded sample is reused by its source URL.

| Chapter | Exercise             | Continue becomes available                                         |
| ------- | -------------------- | ------------------------------------------------------------------ |
| 1       | Load Delft           | City model is registered; land-use overlay loads alongside it      |
| 2       | Pick and inspect     | A feature in the sample is selected; inspect its right panel       |
| 3       | Colour with rules    | Rules colour mode and an enabled rule                              |
| 4       | Filter and summarise | Applied condition, then a column statistics popover with results   |
| 5       | Measure solids       | A successful volume run for Delft, neither stale nor undone        |
| 6       | Join by location     | Successful, current join from Delft land use to the city model     |
| 7       | Sun and shade        | Date/time changes while sun shadows are enabled                    |
| 8       | Export or Share      | The user opens either dialog; review and export/copy remain theirs |

`features/walkthrough` owns steps and lifecycle state. Persistence is injected
through `WalkthroughPersistence`; the default adapter stores the seen flag and unfinished step index,
not model data or tutorial actions. `ui/walkthrough` opens existing panels using
their public store actions and observes completion without running analysis or
changing rules, filters, or solar settings itself. The popover is a nonmodal
region with keyboard-accessible actions; application dialogs retain their own
focus traps and Escape behavior. A removed example layer offers reload recovery.

The example also loads PDOK’s Delft land-use GeoJSON from
`https://pub-7aad9a74319741828dbafdbf5e2df201.r2.dev/landuse_delft.geojson`.
It contains 2,051 polygons in CRS84 and is retained as a URL-backed overlay for
processing and sharing. Existing copies are reused. The join exercise copies
`landCoverObservationClass` from that layer to the Delft buildings.

Validation: lifecycle and interaction tests cover first visit, replay, loading,
selection, applied filters, missing data, dialog dismissal, invalidated runs and
placement above the table. Browser verification exercises the actual Delft sample
and real controls. The table displays records directly; per-column statistics provide the
statistical exercise without a separate Summary tab.
