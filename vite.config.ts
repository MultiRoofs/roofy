import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    plugins: ["oxc", "typescript", "unicorn", "react"],
    categories: {
      correctness: "warn",
    },
    env: {
      builtin: true,
    },
    ignorePatterns: ["coverage", "dist", "node_modules", "packages"],
    overrides: [
      {
        files: ["**/*.{ts,tsx}"],
        rules: {
          "constructor-super": "off",
          "for-direction": "error",
          "getter-return": "off",
          "no-async-promise-executor": "error",
          "no-case-declarations": "error",
          "no-class-assign": "off",
          "no-compare-neg-zero": "error",
          "no-cond-assign": "error",
          "no-const-assign": "off",
          "no-constant-binary-expression": "error",
          "no-constant-condition": "error",
          "no-control-regex": "error",
          "no-debugger": "error",
          "no-delete-var": "error",
          "no-dupe-class-members": "off",
          "no-dupe-else-if": "error",
          "no-dupe-keys": "off",
          "no-duplicate-case": "error",
          "no-empty": "error",
          "no-empty-character-class": "error",
          "no-empty-pattern": "error",
          "no-empty-static-block": "error",
          "no-ex-assign": "error",
          "no-extra-boolean-cast": "error",
          "no-fallthrough": "error",
          "no-func-assign": "off",
          "no-global-assign": "error",
          "no-import-assign": "off",
          "no-invalid-regexp": "error",
          "no-irregular-whitespace": "error",
          "no-loss-of-precision": "error",
          "no-misleading-character-class": "error",
          "no-new-native-nonconstructor": "off",
          "no-nonoctal-decimal-escape": "error",
          "no-obj-calls": "off",
          "no-prototype-builtins": "error",
          "no-redeclare": "off",
          "no-regex-spaces": "error",
          "no-self-assign": "error",
          "no-setter-return": "off",
          "no-shadow-restricted-names": "error",
          "no-sparse-arrays": "error",
          "no-this-before-super": "off",
          "no-unassigned-vars": "error",
          "no-undef": "off",
          "no-unexpected-multiline": "error",
          "no-unreachable": "off",
          "no-unsafe-finally": "error",
          "no-unsafe-negation": "off",
          "no-unsafe-optional-chaining": "error",
          "no-unused-labels": "error",
          "no-unused-private-class-members": "error",
          "no-unused-vars": "error",
          "no-useless-backreference": "error",
          "no-useless-catch": "error",
          "no-useless-escape": "error",
          "no-with": "off",
          "preserve-caught-error": "error",
          "require-yield": "error",
          "use-isnan": "error",
          "valid-typeof": "error",
          "no-var": "error",
          "prefer-const": "error",
          "prefer-rest-params": "error",
          "prefer-spread": "error",
          "no-array-constructor": "error",
          "no-unused-expressions": "error",
          "typescript/ban-ts-comment": "error",
          "typescript/no-duplicate-enum-values": "error",
          "typescript/no-empty-object-type": "error",
          "typescript/no-explicit-any": "error",
          "typescript/no-extra-non-null-assertion": "error",
          "typescript/no-misused-new": "error",
          "typescript/no-namespace": "error",
          "typescript/no-non-null-asserted-optional-chain": "error",
          "typescript/no-require-imports": "error",
          "typescript/no-this-alias": "error",
          "typescript/no-unnecessary-type-constraint": "error",
          "typescript/no-unsafe-declaration-merging": "error",
          "typescript/no-unsafe-function-type": "error",
          "typescript/no-wrapper-object-types": "error",
          "typescript/prefer-as-const": "error",
          "typescript/prefer-namespace-keyword": "error",
          "typescript/triple-slash-reference": "error",
          "react/rules-of-hooks": "error",
          "react/exhaustive-deps": "warn",
          "react/only-export-components": [
            "warn",
            {
              allowConstantExport: true,
            },
          ],
        },
        env: {
          es2026: true,
          browser: true,
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    printWidth: 80,
    sortPackageJson: false,
    ignorePatterns: ["dist", "coverage", "node_modules", "packages"],
  },
  plugins: [
    react(),
    // Suppress missing source map warnings from node_modules (e.g. @duckdb/duckdb-wasm
    // ships a worker.js referencing a .map file that doesn't exist in the package)
    {
      name: "suppress-node-modules-sourcemap-warnings",
      configResolved(config) {
        const origWarn = config.logger.warn.bind(config.logger);
        config.logger.warn = (msg, options) => {
          if (
            typeof msg === "string" &&
            msg.includes("Failed to load source map") &&
            msg.includes("node_modules")
          ) {
            return;
          }
          origWarn(msg, options);
        };
      },
    },
  ],
  optimizeDeps: {
    exclude: ["@cityjson/flatcitybuf", "@duckdb/duckdb-wasm"],
  },
  resolve: {
    // The aliases below pull the submodule packages in as *source*, so their
    // own `import proj4 from "proj4"` / `import … from "three"` would
    // otherwise resolve against the submodule's pnpm store and load a SECOND
    // copy of each library. proj4 keeps its EPSG definitions in module-level
    // state, so two copies mean `ensureProjDef` registers RD New in a
    // registry the app never reads. Both are declared `peerDependencies` of
    // the packages precisely so the host supplies one instance; deduping here
    // is what makes that true for the aliased-source path.
    dedupe: ["proj4", "three"],
    alias: {
      // Dev HMR: resolve the submodule packages to their TypeScript sources so
      // editing a plugin file hot-reloads the app instead of requiring a
      // `pnpm -r build` round trip. Production builds go through the same
      // alias; the packages' own `dist/` output is what external consumers use.
      "@cityjson/navara-core": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-core/src/index.ts",
      ),
      "@cityjson/navara-cityjson": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-cityjson/src/index.ts",
      ),
      "@cityjson/navara-flatcitybuf": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/index.ts",
      ),
      "@cityjson/navara-cityparquet": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-cityparquet/src/index.ts",
      ),
    },
  },
});
