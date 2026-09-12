1. MAJOR — `src/insights/layerTables.ts:1001,1043`: Boot/build awaits never race engine death; a dropped worker request strands the shared FIFO despite table invalidation. Fix: race build and cleanup awaits against death, abandon without further SQL, and verify with a never-settling request.
2. MAJOR — `src/ui/processing/CatalogueView.tsx:125`: Retry requires `failed`, but offline boot leaves lazy extensions `unloaded`; scenario 6 never exposes its download reason or Retry. Fix: publish unavailable extension states from the boot connectivity check while preserving extension-free tools.
3. MAJOR — `src/ui/processing/RunFooter.tsx:53`: Median still includes part rows, contradicting the ledger’s explicit root-only ruling and biasing Roof metrics’ style threshold. Fix: add `WHERE "feature_id" IS NULL OR "feature_id" = "id"` and verify unequal part counts.

Not yet — offline Retry, engine-death queue containment, and the binding median fix remain incomplete.
