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
    },
  }),
);
