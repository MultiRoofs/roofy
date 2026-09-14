import { mergeConfig } from "vite-plus";
import { defineConfig } from "vite-plus";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./vitest.setup.ts"],
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
      // This host runs `vm.overcommit_memory=2` (strict overcommit): the
      // default worker count (~one per CPU) makes every forks worker reserve
      // a large V8 zone, and 100+ of them together exceed the commit limit —
      // each worker dies with "Zone Allocation failed - process out of
      // memory". Eight workers keeps the reservation well inside the limit
      // while still running the suite in about a minute.
      maxWorkers: 8,
    },
  }),
);
