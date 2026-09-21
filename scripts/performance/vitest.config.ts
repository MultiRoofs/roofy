import { defineConfig } from "vite-plus";
import rootConfig from "../../vitest.config";

// Replace (do not merge/concatenate) test.include: this expensive benchmark
// must remain separate from the ordinary unit tests. Shared setup is retained,
// but the benchmark runs in Node rather than jsdom.
export default defineConfig({
  ...rootConfig,
  test: {
    ...rootConfig.test,
    include: [
      "scripts/performance/cityparquet-profile.test.ts",
      "scripts/performance/lod-switch.test.ts",
    ],
    environment: "node",
    maxWorkers: 1,
  },
});
