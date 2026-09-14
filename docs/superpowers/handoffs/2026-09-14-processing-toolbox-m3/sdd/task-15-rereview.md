### Findings

1. **Resolved — Parameters reset on retarget.** The diff restricts clearing to `crossLayer && (retarget || resource)`, preserving the separate LoD reset. Added tests cover nondefault Roof metrics and Measure solids parameters and Join’s continued reset.

2. **Resolved — Centre-within forces centre.** The resolver now forces `proxy: "centre"` for Join and Aggregate; radios reflect it, largest overlap is refused, and submitted parameters retain centre. Added tests cover both tools and Join’s workload-note removal. Proxy restoration has a regression below.

3. **Resolved — Unimplemented tools’ columns/verdict.** The diff guards columns and cross-layer PARAMETERS with `tool.implemented`. Real-registry tests distinguish unimplemented Distance from implemented Join.

4. **Resolved — Aggregate’s default target.** The diff prioritizes eligible targets with areas while retaining disabled point rows. Added coverage checks points first, polygons second.

5. **Partly resolved — Join collision on the second field.** `joinFieldErrors` identifies the second field, and its checkbox receives an associated error. However, searching can hide that error while suppression removes the section fallback.

### Regressions

- **Important — Predicate switching loses the chosen proxy.** [ToolView.tsx:305](/data2/hideba/multiroof-viewer/src/ui/processing/ToolView.tsx:305) passes resolved parameters; [CrossLayerParams.tsx:293](/data2/hideba/multiroof-viewer/src/ui/processing/CrossLayerParams.tsx:293) spreads them back into the draft. Choose footprint → centre within → within: the final change stores `proxy: "centre"`, losing footprint and changing subsequent Join behavior. The added restoration test supplies a fresh footprint bag, so it does not exercise this sequence. Preserve the raw proxy preference and test the actual form transition.

- **Important — Field search can leave Run disabled without an explanation.** With more than twelve fields, select `Zone Name` and `zone_name`, then search for `Zone Name`. The offending checkbox disappears, but [CrossLayerParams.tsx:148](/data2/hideba/multiroof-viewer/src/ui/processing/CrossLayerParams.tsx:148) suppresses the section error using **all** field errors, including hidden ones. [ToolView.tsx:56](/data2/hideba/multiroof-viewer/src/ui/processing/ToolView.tsx:56) also suppresses the footer explanation. Suppress only errors actually rendered, or keep offending fields visible.

### Assessment — Task quality: Needs fixes

The original Important findings are addressed, but proxy-preference loss and hidden collision feedback regress the implemented Join form; this assessment is read-only, with no suite rerun.
