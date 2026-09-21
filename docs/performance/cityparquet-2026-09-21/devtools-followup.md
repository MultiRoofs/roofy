# Chrome DevTools MCP follow-up

The newly connected Chrome DevTools MCP successfully recorded a fresh Nishitokyo load. This follow-up measures the existing development viewer; no optimization or application-source change was made.

## Conditions

- Chrome 153, 960 × 906 CSS-pixel viewport; no CPU or network throttling.
- Original baseline used Chromium 147 and a different viewport. These are corroborating runs, not a controlled before/after comparison.
- Invoked the existing URL loader and add-layer function; scene and database lifecycles ran normally.
- Dataset resource duration was 1.25 s this time, compared with 5.83 s in the earlier trace. Resource Timing body/transfer sizes were unavailable cross-origin; DevTools' ThirdParties insight independently reported 30.7 MB for open3d.city.

## Load measurements

| Observation                    |              Result |
| ------------------------------ | ------------------: |
| Normalized model returned      |  4.90 s after start |
| Database-ready status observed | 12.04 s after start |
| Longest main-thread task       |              7.20 s |
| Later loading task             |              2.87 s |
| Heap reading at ready          |             2.03 GB |

The later loading task is consistent with the earlier geoid-rebuild finding, but this new trace summary did not independently expose its call tree. Table-ready time includes concurrent rendering work and event-loop delay, not just database execution. This run confirms severe main-thread blocking despite a faster download.

## LoD interaction measurements

After loading settled, temporary wrappers around the existing `CityModelMesh` methods measured synchronous work. They were restored afterward; the original selection was also restored. Each elapsed measurement ends after two animation callbacks, not a verified presentation timestamp. Inclusive method durations overlap and must not be summed.

| Change                    | Rebuild duration | Elapsed to two animation callbacks | Resulting triangles |
| ------------------------- | ---------------: | ---------------------------------: | ------------------: |
| All checked → LoD 2 only  |          0.107 s |                            0.279 s |              36,968 |
| LoD 2 only → LoDs 2, 1, 0 |          2.758 s |                            3.049 s |           1,913,792 |
| LoDs 2, 1, 0 → LoDs 2, 1  |          2.651 s |                            2.840 s |           1,913,792 |

The final transition changed **zero objects' effective LoD**, verified against every one of the 84,862 loaded objects: 84,394 remained at LoD 1 and 468 at LoD 2. Nevertheless, the entire mesh was rebuilt. This provides a concrete, smaller optimization opportunity: distinguish checkbox state changes from changes to the geometry actually selected for each object. Preserve the user's selection state, but reuse the mesh when its effective geometry is unchanged. This does not solve full-Yokohama ingestion memory failure.

## Memory and scene traffic

Heap readings during these sequential changes rose to 3.20 GB, then a later reading fell to 1.45 GB without an explicit GC request. That is consistent with collectible allocation churn, but neither proves nor disproves a leak. No heap snapshot was captured.

The DevTools ThirdParties insight reported scene traffic during the trace: open3d.city 30.7 MB, reearth.land 14.8 MB, googleapis.com 5.3 MB, and Esri ArcGIS 1.2 MB. This includes context terrain/imagery, not just building data. The insight reported no estimated savings, so these transfers alone are not evidence to disable those layers.

## Tool limits and evidence

DevTools accepted and stopped the performance trace, but its file-export workspace policy rejected both `/tmp` and the actual repository directory. The no-file stop call returned the trace analysis successfully: no navigation during capture, CLS 0.00, and ThirdParties/CLSCulprits insights. Generic navigation vitals such as LCP would not measure city-layer readiness here.

The same export limitation prevented pursuing a file-based heap snapshot. No export restrictions were changed. Raw measurements returned by the tool are retained in `devtools-followup.json`; a downloadable new raw trace and heap snapshot are not available. The earlier agent-browser raw trace remains documented in the main report.

Next priorities remain bounded reader/resident memory, eliminating geoid-triggered retriangulation, and avoiding redundant coordinate transforms. Skipping rebuilds when effective per-object LoDs are unchanged is now an additional measured improvement candidate. This follow-up does not add a precise GPU timer, camera-motion benchmark, or production-build baseline.
